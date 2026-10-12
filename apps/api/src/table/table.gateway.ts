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
import type { DefaultEventsMap, Server, Socket } from "socket.io";
import { z } from "zod";
import {
  Action,
  BookAck,
  BookPage,
  BookServing,
  MAX_PAGE_BYTES,
  canInCampaign,
  toSeatCodex,
  type ActionResult,
  type BookAvailable,
  type BookSource,
  type Ctx,
} from "@inconsistable/core-schema";
import { logRoomOpen } from "../admin/admin.service.ts";
import { resolveSocketCtx } from "../auth/auth.service.ts";
import { db } from "../core/db.ts";
import { ActionError } from "../core/errors.ts";
import { clientIp, limiter } from "../core/rate-limit.ts";
import { applyAction, kicks, kicksSender, touches, type Kick } from "./table.dispatch.ts";
import { loadCodex, loadLive, seatState } from "./table.state.ts";

const room = (campaignId: string) => `c:${campaignId}`;
export const userRoom = (userId: string) => `u:${userId}`;

// Per IP for connects (a whole table shares one NAT, and all of it reconnects after an api restart), per socket for
// actions: a GM tapping fast stays far below 2/s over a minute.
const allowConnect = limiter({ max: 60, windowMs: 60_000 });
const allowAction = limiter({ max: 120, windowMs: 60_000 });
// A player flipping through cited pages; each one costs the GM's tablet a render.
const allowPage = limiter({ max: 30, windowMs: 60_000 });
const PAGE_TIMEOUT_MS = 15_000;
const KICK_GRACE_MS = 200;

// What a socket carries: who it is, whether it's the admin-key script (exempt from the action limit), and the book
// sources a GM tablet serves from its own PDFs (presence only, so it dies with the socket).
type SocketData = { ctx: Ctx; script: boolean; books?: BookSource[] };
type TableServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type TableSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

// A GM seat sees the raw snapshots; everyone else gets their own filtered copy (core-schema view.ts).
const fullView = (ctx: Ctx) => ctx.seat.kind === "admin" || (ctx.seat.kind === "member" && ctx.seat.role === "gm");
// Seats that see the same thing share one computed view.
const viewKey = (ctx: Ctx) =>
  ctx.seat.kind === "admin"
    ? "admin"
    : JSON.stringify([
        ctx.seat.kind,
        ctx.seat.role,
        ctx.seat.kind === "member" ? ctx.seat.scopes : [],
        ctx.seat.characterIds,
      ]);

// WEB_ORIGIN may list several origins (localhost and the LAN address), comma separated.
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN?.split(",").map((o) => o.trim()) ?? false, credentials: true },
  maxHttpBufferSize: MAX_PAGE_BYTES + 100_000, // a relayed book page (book:request), plus the ack envelope
})
export class TableGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: TableServer;
  private readonly log = new Logger(TableGateway.name);
  // ponytail: in-process per-campaign queue, assumes one api instance; pg_advisory_xact_lock per campaign when we scale
  // out (docs/design.md §5.6)
  private readonly tails = new Map<string, Promise<void>>();

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
        socket.data = { ctx: r.ctx, script: r.script };
        if (r.openedAsAdmin && r.ctx.userId) await logRoomOpen({ userId: r.ctx.userId, campaignId: r.ctx.campaignId });
      } catch (e) {
        // DB down: the client retries (use-table), unlike "unauthorized" which it treats as a dead token.
        this.log.error(e);
        return next(new Error("unavailable"));
      }
      next();
    });
  }

  async handleConnection(socket: TableSocket) {
    const { ctx } = socket.data;
    try {
      await socket.join(room(ctx.campaignId));
      if (ctx.userId) await socket.join(userRoom(ctx.userId));
      // In the campaign's queue, so this first snapshot can't land after (and overwrite) a newer broadcast.
      await this.serial(ctx.campaignId, async () => {
        const [live, codex] = await Promise.all([loadLive(ctx.campaignId), loadCodex(ctx.campaignId)]);
        const full = fullView(ctx);
        if (live) socket.emit("state", full ? live.state : seatState({ live, ctx }));
        socket.emit("codex", full ? codex : toSeatCodex({ codex, ctx }));
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
    const { ctx } = socket.data;
    if (ctx.seat.kind === "token" && ctx.seat.role === "screen")
      return { ok: false, error: "The table screen shows no book pages." };
    if (!allowPage(socket.id)) return { ok: false, error: "Too many pages. Slow down." };
    const parsed = BookPage.safeParse(body);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    const server = this.bookServers(ctx.campaignId).find((s) => s.data.books?.includes(parsed.data.source));
    if (!server) return { ok: false, error: "The GM isn't serving that book." };
    let reply: unknown;
    try {
      reply = await server.timeout(PAGE_TIMEOUT_MS).emitWithAck("book:request", parsed.data);
    } catch {
      return { ok: false, error: "No reply from the GM's tablet." };
    }
    // Only a GM socket answers, but its reply is still parsed before it's passed on.
    const ack = BookAck.safeParse(reply);
    return ack.success ? ack.data : { ok: false, error: "The GM's tablet couldn't render it." };
  }

  @SubscribeMessage("action")
  async onAction(@ConnectedSocket() socket: TableSocket, @MessageBody() body: unknown): Promise<ActionResult> {
    const { ctx, script } = socket.data;
    if (!script && !allowAction(socket.id)) return { ok: false, error: "Too many actions. Slow down." };
    const parsed = Action.safeParse(body);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
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
        if (e instanceof ActionError) return { ok: false, error: e.message };
        this.log.error(e);
        return { ok: false, error: "Server error" };
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

  // A platform role or lock changed in Clerk (webhook) or by a moderator: every socket of that user reconnects and
  // resolves its seat again. ponytail: local sockets only; the Redis adapter carries it across nodes (§5.6)
  async kickUser(userId: string) {
    this.server.in(userRoom(userId)).disconnectSockets(true);
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

  private async broadcast(campaignId: string, what: { state: boolean; codex: boolean }) {
    if (!what.state && !what.codex) return;
    // ponytail: per-socket fan-out with one view per distinct seat, fine at table scale; per-seat rooms if it grows
    const sockets = await this.server.in(room(campaignId)).fetchSockets();
    const send = <T>(event: string, value: T, view: (ctx: Ctx) => unknown) => {
      const views = new Map<string, unknown>();
      for (const s of sockets) {
        const { ctx } = s.data;
        if (fullView(ctx)) {
          s.emit(event, value);
          continue;
        }
        const key = viewKey(ctx);
        if (!views.has(key)) views.set(key, view(ctx));
        s.emit(event, views.get(key));
      }
    };
    if (what.state) {
      const live = await loadLive(campaignId);
      if (live) send("state", live.state, (ctx) => seatState({ live, ctx }));
    }
    if (what.codex) {
      const codex = await loadCodex(campaignId);
      send("codex", codex, (ctx) => toSeatCodex({ codex, ctx }));
    }
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
