import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { DefaultEventsMap, RemoteSocket, Server, Socket } from "socket.io";
import { z } from "zod";
import {
  Action,
  BookAck,
  BookPage,
  BookServing,
  MAX_PAGE_BYTES,
  canInCampaign,
  refused,
  type ActionResult,
  type BookAvailable,
  type BookSource,
  type Ctx,
} from "@inconsistable/core-schema";
import { logAdminKey } from "../admin/admin.service.ts";
import { resolveSocketCtx, sessionOf } from "../auth/auth.service.ts";
import { db } from "../core/db.ts";
import { ActionError } from "../core/errors.ts";
import { clientIp, limiter } from "../core/rate-limit.ts";
import { applyAction, kicks, kicksSender, touches, type Kick } from "./table.dispatch.ts";
import { seatView } from "../view/view.ts";
import { loadSnapshot } from "./table.state.ts";
import { SizedWebSocketServer } from "./ws-engine.ts";

const room = (campaignId: string) => `c:${campaignId}`;
// One room per signed-in session, so ending a session disconnects exactly its sockets (§7.7).
const sessionRoom = (tokenHash: string) => `s:${tokenHash}`;

// Per IP for connects (a whole table shares one NAT, and all of it reconnects after an api restart), per seat for
// actions (reconnecting or opening more sockets doesn't reset it): a GM tapping fast stays far below 2/s over a minute.
const allowConnect = limiter({ max: 60, windowMs: 60_000 });
const allowAction = limiter({ max: 120, windowMs: 60_000 });
// A player flipping through cited pages; each one costs the GM's tablet a render. Per seat, like actions.
const allowPage = limiter({ max: 30, windowMs: 60_000 });
const PAGE_TIMEOUT_MS = 15_000;
// Page requests waiting on a GM tablet at once, per campaign; each holds an ack for up to PAGE_TIMEOUT_MS.
// ponytail: in-process counter, one api instance and one flat cap for the whole table; per-seat caps or a queue if a table needs more
const MAX_PAGES_IN_FLIGHT = 8;
const KICK_GRACE_MS = 200;

// What a socket carries: who it is, the key of its seat (the rate limits' key), whether it's the admin-key script
// (exempt from the action limit), the signed-in session it came through (its room, and when it ends), and the book
// sources a GM tablet serves from its own PDFs (presence only, so it dies with the socket).
type SocketData = {
  ctx: Ctx;
  seatKey: string;
  script: boolean;
  session?: { tokenHash: string; endsAt: number };
  books?: BookSource[];
};
type TableServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type TableSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type Loaded = NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>;
type Touches = { state: boolean; codex: boolean };

// WEB_ORIGIN may list several origins (localhost and the LAN address), comma separated.
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN?.split(",").map((o) => o.trim()) ?? false, credentials: true },
  maxHttpBufferSize: MAX_PAGE_BYTES + 100_000, // a relayed book page (book:request), plus the ack envelope
  wsEngine: SizedWebSocketServer,
})
export class TableGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: TableServer;
  private readonly log = new Logger(TableGateway.name);
  // ponytail: in-process per-campaign queue, assumes one api instance; pg_advisory_xact_lock per campaign when we scale
  // out (docs/design.md §5.6)
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pagesInFlight = new Map<string, number>();

  // Authenticate in middleware, before the connection is accepted, so no event can arrive without a seat.
  afterInit(server: TableServer) {
    server.use(async (socket, next) => {
      // Anything but "unauthorized" makes the client retry later (use-table), so a limited socket backs off.
      if (!allowConnect(clientIp(socket.handshake.headers, socket.handshake.address))) {
        return next(new Error("rate limited"));
      }
      try {
        const r = await resolveSocketCtx({ auth: socket.handshake.auth, headers: socket.handshake.headers });
        if (!r) return next(new Error("unauthorized"));
        socket.data = { ctx: r.ctx, seatKey: r.seatKey, script: r.script };
        // The seat came through the session cookie only if its user is the session's (not a guest token or the key).
        const session = r.script ? null : await sessionOf(socket.handshake.headers);
        if (session && session.user.userId === r.ctx.userId) {
          socket.data.session = { tokenHash: session.tokenHash, endsAt: session.endsAt.getTime() };
        }
        if (r.script) await logAdminKey({ action: "room.open", campaignId: r.ctx.campaignId });
      } catch (e) {
        // DB down: the client retries (use-table), unlike "unauthorized" which it treats as a dead token.
        this.log.error(e);
        return next(new Error("unavailable"));
      }
      next();
    });
  }

  async handleConnection(socket: TableSocket) {
    const { ctx, session } = socket.data;
    try {
      await socket.join(session ? [room(ctx.campaignId), sessionRoom(session.tokenHash)] : room(ctx.campaignId));
      // In the campaign's queue, so this first snapshot can't land after (and overwrite) a newer broadcast.
      await this.serial(ctx.campaignId, async () => {
        const loaded = await loadSnapshot(ctx.campaignId);
        if (loaded) this.emitView(socket, loaded, { state: true, codex: true });
      });
      this.announceBooks(ctx.campaignId, socket);
    } catch (e) {
      // No snapshot to show (DB down): drop the socket so the client reconnects instead of waiting on an empty table.
      this.log.error(e);
      socket.disconnect(true);
    }
  }

  // A serving GM left (closed the tab, lost signal): the players' page links go back to plain text.
  handleDisconnect(socket: TableSocket) {
    if (socket.data?.books?.length) this.announceBooks(socket.data.ctx.campaignId);
  }

  // A GM tablet serves these sources from PDFs picked on that device; an empty list stops serving.
  @SubscribeMessage("book:serving")
  onBookServing(@ConnectedSocket() socket: TableSocket, @MessageBody() body: unknown) {
    const data = socket.data;
    if (this.sessionEnded(socket)) return;
    const parsed = BookServing.safeParse(body);
    if (!canInCampaign({ ctx: data.ctx, perm: "codex:write" }) || !parsed.success) return;
    data.books = parsed.data.sources;
    this.announceBooks(data.ctx.campaignId);
  }

  // A reading seat asks for one page; a GM socket serving that source renders it and the image comes back in this ack
  // only. Nothing is stored (CLAUDE.md, "Books never reach the server").
  // ponytail: any page of a served book, allow-list the cited pages if the table ever needs it
  @SubscribeMessage("book:request")
  async onBookRequest(@ConnectedSocket() socket: TableSocket, @MessageBody() body: unknown) {
    const { ctx, seatKey } = socket.data;
    if (this.sessionEnded(socket)) return refused("unauthorized");
    if (ctx.seat.kind === "token" && ctx.seat.role === "screen") return refused("bookScreenNone");
    if (!allowPage(seatKey)) return refused("tooManyPages");
    const parsed = BookPage.safeParse(body);
    if (!parsed.success) return refused("badRequest", { detail: z.prettifyError(parsed.error) });
    const server = this.bookServers(ctx.campaignId).find((s) => s.data.books?.includes(parsed.data.source));
    if (!server) return refused("bookNotServed");
    if ((this.pagesInFlight.get(ctx.campaignId) ?? 0) >= MAX_PAGES_IN_FLIGHT) return refused("bookBusy");
    this.pagesInFlight.set(ctx.campaignId, (this.pagesInFlight.get(ctx.campaignId) ?? 0) + 1);
    let reply: unknown;
    try {
      reply = await server.timeout(PAGE_TIMEOUT_MS).emitWithAck("book:request", parsed.data);
    } catch {
      return refused("bookNoReply");
    } finally {
      const left = (this.pagesInFlight.get(ctx.campaignId) ?? 1) - 1;
      if (left > 0) this.pagesInFlight.set(ctx.campaignId, left);
      else this.pagesInFlight.delete(ctx.campaignId);
    }
    // Only a GM socket answers, but its reply is still parsed before it's passed on.
    const ack = BookAck.safeParse(reply);
    return ack.success ? ack.data : refused("bookRenderFailed");
  }

  @SubscribeMessage("action")
  async onAction(@ConnectedSocket() socket: TableSocket, @MessageBody() body: unknown): Promise<ActionResult> {
    const { ctx, seatKey, script } = socket.data;
    if (this.sessionEnded(socket)) return refused("unauthorized");
    if (!script && !allowAction(seatKey)) return refused("tooManyActions");
    const parsed = Action.safeParse(body);
    if (!parsed.success) return refused("badRequest", { detail: z.prettifyError(parsed.error) });
    if (script) {
      try {
        await logAdminKey({ action: "key.action", campaignId: ctx.campaignId, detail: parsed.data.type });
      } catch (e) {
        this.log.error(e);
        return refused("serverError"); // an admin-key action that can't be logged doesn't run
      }
    }
    const result = await this.run({ ctx, action: parsed.data });
    return result;
  }

  // One action, as the socket handler and the admin REST route both apply it: queued per campaign, in a transaction,
  // then the kicks and the rebroadcast. Refusals come back as { ok: false }.
  run({ ctx, action }: { ctx: Ctx; action: Action }): Promise<ActionResult> {
    return this.serial(ctx.campaignId, async () => {
      let result: ActionResult;
      try {
        result = await db.transaction((tx) => applyAction(tx, { ctx, action }));
      } catch (e) {
        if (e instanceof ActionError) return refused(e.code, e.params);
        this.log.error(e);
        return refused("serverError");
      }
      // Committed: report success even if fan-out fails, or a retap would apply a delta twice. The next broadcast resyncs.
      try {
        const kick = async () => {
          for (const k of kicks({ ctx, action })) await this.kick({ campaignId: ctx.campaignId, kick: k });
        };
        // Kicks that reach the sender go a moment later: the ack has to reach them first.
        if (kicksSender(action)) setTimeout(() => kick().catch((e) => this.log.error(e)), KICK_GRACE_MS);
        else await kick();
        await this.broadcast(ctx.campaignId, touches(action));
      } catch (e) {
        this.log.error(e);
      }
      return result;
    });
  }

  // For REST changes to a table (accepting an invite): same queue as socket actions, then the same broadcast.
  async mutate<T>({ campaignId, fn }: { campaignId: string; fn: () => Promise<T> }): Promise<T> {
    const result = await this.serial(campaignId, fn);
    try {
      await this.broadcast(campaignId, { state: true, codex: false });
    } catch (e) {
      this.log.error(e);
    }
    return result;
  }

  // Runs fn after every earlier call for the same key has settled; a failure doesn't break the chain.
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key);
    const run = (async () => {
      await prev;
      const result = await fn();
      return result;
    })();
    const settled = (async () => {
      try {
        await run;
      } catch {
        // The caller of `run` sees the error; the next call just waits for it to settle.
      }
    })();
    this.tails.set(key, settled);
    // An idle campaign leaves nothing behind, unless a later call has queued behind this one.
    void (async () => {
      await settled;
      if (this.tails.get(key) === settled) this.tails.delete(key);
    })();
    return run;
  }

  // This campaign's GM sockets that serve at least one book. Local sockets: one api instance, as the queue assumes.
  private bookServers(campaignId: string): TableSocket[] {
    const ids = this.server.sockets.adapter.rooms.get(room(campaignId)) ?? new Set<string>();
    return [...ids]
      .map((id) => this.server.sockets.sockets.get(id))
      .filter((s): s is TableSocket => !!s?.data?.books?.length);
  }

  // Which sources any GM is serving right now, to everyone at the table (or to one socket that just joined).
  private announceBooks(campaignId: string, to?: TableSocket) {
    const sources = [...new Set(this.bookServers(campaignId).flatMap((s) => s.data.books ?? []))];
    (to ?? this.server.to(room(campaignId))).emit("book:available", { sources } satisfies BookAvailable);
  }

  // One socket's Seat view, as the events the web reads. The gateway decides nothing about what is in it.
  private emitView(socket: TableSocket | RemoteSocket<DefaultEventsMap, SocketData>, loaded: Loaded, what: Touches) {
    const view = seatView({ ...loaded, ctx: socket.data.ctx });
    if (what.state) socket.emit("state", view.state);
    if (what.codex) socket.emit("codex", view.codex);
  }

  private async broadcast(campaignId: string, what: Touches) {
    if (!what.state && !what.codex) return;
    const loaded = await loadSnapshot(campaignId);
    if (!loaded) return;
    // ponytail: payload computed per socket, fine at table size (one GM, a few phones, one Screen); cache by a seat-kind key if rooms grow
    for (const s of await this.server.in(room(campaignId)).fetchSockets()) this.emitView(s, loaded, what);
  }

  // Sign-out and back-channel logout: the sessions' sockets go now. They reconnect as whoever the cookies still name.
  endSessions(tokenHashes: string[]) {
    if (tokenHashes.length) this.server.in(tokenHashes.map(sessionRoom)).disconnectSockets(true);
  }

  // The handshake runs once per connection, so each event checks the session it came through is still within its
  // limits (§7.7). A dead one is refused and the socket dropped a moment later, after the refusal reaches it.
  private sessionEnded(socket: TableSocket): boolean {
    const session = socket.data.session;
    if (!session || Date.now() < session.endsAt) return false;
    setTimeout(() => socket.disconnect(true), KICK_GRACE_MS);
    return true;
  }

  // Disconnects the sockets whose seat just changed or went: they reconnect and resolve their seat again.
  private async kick({ campaignId, kick }: { campaignId: string; kick: Kick }) {
    for (const s of await this.server.in(room(campaignId)).fetchSockets()) {
      const { ctx } = s.data;
      const hit =
        "all" in kick
          ? true
          : "screens" in kick
            ? ctx.seat.kind === "token" && ctx.seat.role === "screen"
            : "userId" in kick
              ? ctx.userId === kick.userId
              : ctx.seat.kind !== "admin" &&
                ctx.seat.characterIds.includes(kick.actorId) &&
                (!kick.tokensOnly || ctx.seat.kind === "token");
      if (hit) s.disconnect(true);
    }
  }
}
