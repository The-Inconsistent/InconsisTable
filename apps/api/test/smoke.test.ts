// End-to-end check against a running api (bun run dev:api) + Postgres 18 (bun run dev:db). The api must run with
// CLERK_TEST_SECRET set (apps/api/.env, dev only), so these tests can act as signed-in Clerk users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { testSessionToken } from "@inconsistable/auth/api";
import type {
  ActionInput,
  ActionResult,
  Codex,
  Ctx,
  InvitePreview,
  LiveState,
  Lobby,
} from "@inconsistable/core-schema";

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const run = Date.now().toString(36); // test users are fresh per run, so reruns never collide

type Role = "creator" | "member" | "moderator" | "admin";
const clerk = (userId: string, role: Role = "member") =>
  testSessionToken({ secret: process.env.CLERK_TEST_SECRET ?? "", userId: `${userId}-${run}`, role });
const uid = (userId: string) => `${userId}-${run}`;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${API}/api${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${API}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// A socket at one table: `auth` carries campaignId plus a Clerk test token, a guest token or the admin key; `headers`
// can carry a guest cookie instead.
function connect({ auth, headers }: { auth: Record<string, string>; headers?: Record<string, string> }) {
  const socket = io(API, { auth, extraHeaders: headers, transports: ["websocket"], reconnection: false });
  let latest: LiveState | null = null;
  let codex: Codex | null = null;
  socket.on("codex", (c: Codex) => (codex = c));
  const waiters: Array<[(s: LiveState) => boolean, (s: LiveState) => void]> = [];
  socket.on("state", (s: LiveState) => {
    latest = s;
    for (const w of waiters.splice(0)) {
      if (w[0](s)) w[1](s);
      else waiters.push(w);
    }
  });
  return {
    socket,
    send: (a: ActionInput) => socket.emitWithAck("action", a) as Promise<ActionResult>,
    codex: () => codex,
    until: (pred: (s: LiveState) => boolean) =>
      new Promise<LiveState>((resolve, reject) => {
        if (latest && pred(latest)) return resolve(latest);
        waiters.push([pred, resolve]);
        setTimeout(() => reject(new Error(`timed out waiting for: ${pred}`)), 3000);
      }),
    connected: () =>
      new Promise<void>((resolve, reject) => {
        if (socket.connected) return resolve();
        socket.once("connect", () => resolve());
        socket.once("connect_error", (e) => reject(e));
      }),
  };
}

async function eventually(check: () => boolean, what: string) {
  for (let i = 0; i < 30; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// A new room created by a signed-in creator, who owns it, and that owner's socket.
async function newRoom(name: string) {
  const ownerClerk = clerk(`owner-${name}`, "creator");
  const res = await post("/campaigns", { name }, bearer(ownerClerk));
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, clerkToken: ownerClerk } });
  await owner.until((s) => s.campaign.name === name);
  return { owner, campaignId, ownerClerk };
}

const ok = (r: ActionResult) => {
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return r as Extract<ActionResult, { ok: true }>;
};
const refused = (r: ActionResult, pattern: RegExp) => {
  assert.equal(r.ok, false, "expected a refusal");
  if (!r.ok) assert.match(r.error, pattern);
};

test("only creators open rooms, and the creator owns the room", async () => {
  assert.equal((await post("/campaigns", { name: "x" })).status, 401);
  assert.equal((await post("/campaigns", { name: "x" }, bearer(clerk("plain")))).status, 403);
  const { owner, ownerClerk, campaignId } = await newRoom("Owned");
  const s = await owner.until(() => true);
  assert.equal(s.campaign.ownerUserId, uid("owner-Owned"));
  assert.deepEqual(
    s.access.members.map((m) => [m.userId, m.role]),
    [[uid("owner-Owned"), "gm"]],
  );
  const lobby = (await (await get("/lobby", bearer(ownerClerk))).json()) as Lobby;
  assert.ok(lobby.mine.some((g) => g.id === campaignId && g.isOwner));
  owner.socket.close();
});

test("room QR: a signed-in player and a guest join, each holding their own character", async () => {
  const { owner, campaignId } = await newRoom("QR");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" }));
  const code = inv.token!;

  // A signed-in player starts a new character.
  const anaClerk = clerk("ana");
  const preview = (await (await get(`/invites/${code}`, bearer(anaClerk))).json()) as InvitePreview;
  assert.equal(preview.mode, "room");
  assert.equal(preview.role, "player");
  const acc = await post(`/invites/${code}/accept`, { newCharacterName: "Lyra" }, bearer(anaClerk));
  assert.equal(acc.status, 200);
  const s1 = await owner.until((s) => s.actors.some((a) => a.name === "Lyra"));
  const lyra = s1.actors.find((a) => a.name === "Lyra")!;
  assert.equal(lyra.ownerUserId, uid("ana"));
  assert.deepEqual(s1.access.members.find((m) => m.userId === uid("ana"))?.characterIds, [lyra.id]);

  // A guest takes a seat without an account and gets a cookie.
  const g = await post(`/invites/${code}/accept`, { newCharacterName: "Bran", asGuest: true });
  assert.equal(g.status, 200);
  const cookie = g.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^it_token=/);
  const guest = connect({ auth: { campaignId }, headers: { cookie } });
  const gs = await guest.until((s) => s.actors.some((a) => a.name === "Bran"));
  const bran = gs.actors.find((a) => a.name === "Bran")!;
  assert.deepEqual(gs.access.invites, [], "a guest never sees invites");

  // Players edit their own character only: by seat, never by account.
  const ana = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await ana.until(() => true);
  ok(await ana.send({ type: "actor.rename", id: lyra.id, name: "Lyra the Bold" }));
  refused(await ana.send({ type: "actor.rename", id: bran.id, name: "Mine now" }), /Not your character/);
  ok(await guest.send({ type: "actor.rename", id: bran.id, name: "Bran Stout" }));
  refused(await guest.send({ type: "actor.rename", id: lyra.id, name: "Mine now" }), /Not your character/);
  refused(await ana.send({ type: "session.start" }), /permission/);
  refused(await ana.send({ type: "invite.create", mode: "room" }), /permission/);

  for (const s of [owner, ana, guest]) s.socket.close();
});

test("the table screen joins by token and only reads", async () => {
  const { owner, campaignId } = await newRoom("Screen");
  const tok = ok(await owner.send({ type: "screen.issue" })).token!;
  const screen = connect({ auth: { campaignId, token: tok } });
  const s = await screen.until(() => true);
  assert.deepEqual(s.access.invites, []);
  refused(await screen.send({ type: "session.start" }), /read-only/);
  refused(await screen.send({ type: "actor.create", name: "TV hero" }), /read-only/);
  const page = (await screen.socket.emitWithAck("book:request", { source: "sample", page: 1 })) as ActionResult;
  refused(page, /no book pages/);
  // Revoking screens drops the TV.
  const gone = new Promise<void>((r) => screen.socket.once("disconnect", () => r()));
  ok(await owner.send({ type: "screen.revoke" }));
  await gone;
  owner.socket.close();
});

test("a GM can't remove the owner, and the owner hands the room on only when the recipient accepts", async () => {
  const { owner, ownerClerk, campaignId } = await newRoom("Transfer");
  // Invite a second GM: only the owner may invite a GM.
  const gmInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false })).token!;
  const benClerk = clerk("ben");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, bearer(benClerk))).status, 200);
  const ben = connect({ auth: { campaignId, clerkToken: benClerk } });
  await ben.until((s) => s.access.members.some((m) => m.userId === uid("ben") && m.role === "gm"));

  // The GM can't remove the owner, invite another GM, delete the room or hand it on.
  refused(await ben.send({ type: "member.remove", userId: uid("owner-Transfer") }), /owner can't be removed/);
  refused(
    await ben.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false }),
    /only invite players/,
  );
  refused(await ben.send({ type: "campaign.transfer", toUserId: uid("ben") }), /permission/);
  ok(await ben.send({ type: "campaign.archive" })); // any GM archives (kept from Auspex)
  refused(await ben.send({ type: "campaign.delete", name: "Transfer" }), /permission/); // only the owner deletes
  ok(await owner.send({ type: "campaign.unarchive" }));

  // Offer the room: nothing moves until Ben accepts; nobody else can accept it.
  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ben") }));
  const offered = await owner.until((s) => s.access.transfer?.toUserId === uid("ben"));
  assert.equal(offered.campaign.ownerUserId, uid("owner-Transfer"));
  refused(await owner.send({ type: "campaign.transferAccept" }), /no offer for you/);
  const kicked = [owner, ben].map((s) => new Promise<void>((r) => s.socket.once("disconnect", () => r())));
  ok(await ben.send({ type: "campaign.transferAccept" }));
  // The old owner's socket, still open from before the transfer, has lost the owner's powers already.
  refused(await owner.send({ type: "member.appoint", userId: uid("ben"), role: "cogm", scopes: [] }), /permission/);
  const moved = await owner.until((s) => s.campaign.ownerUserId === uid("ben"));
  assert.equal(moved.access.transfer, null);
  // Then every seat is kicked and resolves again: Ben now holds the owner's powers, the old owner is a GM.
  await Promise.all(kicked);
  const ben2 = connect({ auth: { campaignId, clerkToken: benClerk } });
  await ben2.until(() => true);
  ok(await ben2.send({ type: "member.appoint", userId: uid("owner-Transfer"), role: "cogm", scopes: ["combat"] }));
  const old = connect({ auth: { campaignId, clerkToken: ownerClerk } });
  await old.until(() => true);
  refused(await old.send({ type: "session.start" }), /permission/); // a combat-only co-GM
  ok(await ben2.send({ type: "member.remove", userId: uid("owner-Transfer") }));
  ben2.socket.close();
  old.socket.close();
});

test("a private handout reaches only its listed reader, and hides when that reader goes", async () => {
  const { owner, campaignId } = await newRoom("Handouts");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const anaClerk = clerk("ana-h");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Lyra" }, bearer(anaClerk));
  const s = await owner.until((st) => st.actors.length === 1);
  const lyra = s.actors[0]!;
  const h = ok(
    await owner.send({ type: "codex.save", kind: "handout", title: "Letter", body: "Meet at dawn", gmNotes: "a trap" }),
  ).id!;
  ok(
    await owner.send({ type: "codex.reveal", id: h, visibility: "party", audienceMode: "listed", audience: [lyra.id] }),
  );
  const ana = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await eventually(() => ana.codex()?.entries.some((e) => e.id === h) ?? false, "Lyra sees her letter");
  assert.equal(ana.codex()?.entries.find((e) => e.id === h)?.gmNotes, "", "never the GM notes");
  ok(await owner.send({ type: "actor.delete", id: lyra.id }));
  await eventually(
    () => owner.codex()?.entries.find((e) => e.id === h)?.visibility === "gm",
    "the letter goes back to GM-only, not to everyone",
  );
  owner.socket.close();
  ana.socket.close();
});

test("a seated admin plays by their seat; OPEN AS ADMIN is logged", async () => {
  const { owner, campaignId } = await newRoom("Admin");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const rootClerk = clerk("root", "admin");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Root's hero" }, bearer(rootClerk));
  const me = (await (await get(`/campaigns/${campaignId}/me`, bearer(rootClerk))).json()) as Ctx;
  assert.equal(me.seat.kind, "member", "a seated admin gets their seat");
  const seated = connect({ auth: { campaignId, clerkToken: rootClerk } });
  await seated.until(() => true);
  refused(await seated.send({ type: "session.start" }), /permission/);
  seated.socket.close();

  // Another admin without a seat opens the room as admin.
  const otherClerk = clerk("root2", "admin");
  const opened = connect({ auth: { campaignId, clerkToken: otherClerk } });
  await opened.until(() => true);
  ok(await opened.send({ type: "session.start" }));
  const events = (await (await get("/admin/events", bearer(otherClerk))).json()) as {
    action: string;
    campaignId: string;
  }[];
  assert.ok(events.some((e) => e.action === "room.open" && e.campaignId === campaignId));
  opened.socket.close();
  owner.socket.close();
});

test("a moderator locks an ordinary account but not an admin", async () => {
  const modClerk = clerk("mod", "moderator");
  const victimClerk = clerk("victim");
  await get("/lobby", bearer(victimClerk)); // the app has now seen them
  await get("/lobby", bearer(clerk("adm", "admin")));
  const lock = (userId: string, locked: boolean) => post(`/admin/users/${userId}/lock`, { locked }, bearer(modClerk));
  assert.equal((await lock(uid("victim"), true)).status, 200);
  assert.equal((await get("/lobby", bearer(victimClerk))).status, 401, "a locked user is signed out");
  assert.equal((await lock(uid("adm"), true)).status, 403);
  assert.equal((await lock(uid("victim"), false)).status, 200);
  assert.equal((await get("/lobby", bearer(victimClerk))).status, 200);
  assert.equal((await get("/admin/events", bearer(modClerk))).status, 403, "moderators don't read the admin log");
});

test("state versions only go up", async () => {
  const { owner } = await newRoom("Versions");
  const v0 = (await owner.until(() => true)).stateVersion;
  ok(await owner.send({ type: "actor.create", name: "A" }));
  const v1 = (await owner.until((s) => s.actors.length === 1)).stateVersion;
  assert.ok(v1 > v0);
  owner.socket.close();
});
