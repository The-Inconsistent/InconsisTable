// End-to-end check against a running api (bun run dev:api) + Postgres 18 (bun run dev:db). The api must run with
// CLERK_TEST_SECRET set (apps/api/.env, dev only), so these tests can act as signed-in Clerk users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { io } from "socket.io-client";
import { testSessionToken, type PlatformRole } from "@inconsistable/auth/api";
import type {
  ActionInput,
  ActionResult,
  Codex,
  Ctx,
  InvitePreview,
  LiveState,
  Lobby,
} from "@inconsistable/core-schema";
import { FIXTURE_RULESET } from "./fixture.ts";

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const run = Date.now().toString(36); // test users are fresh per run, so reruns never collide

const clerk = (userId: string, role: PlatformRole = "user") =>
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

// Resolves when the socket drops (a kick).
const dropped = (c: ReturnType<typeof connect>) => new Promise<void>((r) => c.socket.once("disconnect", () => r()));

// A signed-in player seated through a room invite with a new character of their name; returns their Clerk token.
async function seatPlayer(owner: ReturnType<typeof connect>, name: string) {
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const token = clerk(name);
  assert.equal((await post(`/invites/${code}/accept`, { newCharacterName: name }, bearer(token))).status, 200);
  await owner.until((s) => s.access.members.some((m) => m.userId === uid(name)));
  return token;
}

test("the room's settings and its sessions: update, start, edit, end", async () => {
  const { owner, campaignId } = await newRoom("Settings");
  const anaClerk = await seatPlayer(owner, "ana-set");
  const ana = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await ana.until(() => true);

  ok(await owner.send({ type: "campaign.update", name: "Settings 2", nextSessionPlace: "Ana's" }));
  await owner.until((s) => s.campaign.name === "Settings 2" && s.campaign.nextSessionPlace === "Ana's");
  refused(await ana.send({ type: "campaign.update", name: "Mine" }), /permission/);

  const sessionId = ok(await owner.send({ type: "session.start", title: "One" })).id!;
  ok(await owner.send({ type: "session.edit", sessionId, title: "One, again", notes: "the twist" }));
  await owner.until((s) => s.session?.title === "One, again" && s.session.notes === "the twist");
  refused(await ana.send({ type: "session.edit", sessionId, title: "x" }), /permission/);
  refused(await owner.send({ type: "session.edit", sessionId: crypto.randomUUID(), title: "x" }), /not found/);

  // A co-GM who runs sessions but holds no secrets edits the title, never the notes they aren't shown.
  const cogmInv = ok(
    await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false }),
  ).token!;
  const coClerk = clerk("co-set");
  assert.equal((await post(`/invites/${cogmInv}/accept`, {}, bearer(coClerk))).status, 200);
  ok(await owner.send({ type: "member.appoint", userId: uid("co-set"), role: "cogm", scopes: ["session"] }));
  const co = connect({ auth: { campaignId, clerkToken: coClerk } });
  assert.equal((await co.until(() => true)).session?.notes, "", "the co-GM isn't shown the notes");
  refused(await co.send({ type: "session.edit", sessionId, notes: "" }), /secrets scope/);
  ok(await co.send({ type: "session.edit", sessionId, title: "Co's title" }));
  await owner.until((s) => s.session?.title === "Co's title" && s.session.notes === "the twist");

  refused(await ana.send({ type: "session.end" }), /permission/);
  ok(await owner.send({ type: "session.end", recap: "We met." }));
  await owner.until((s) => s.session === null);
  refused(await owner.send({ type: "session.end" }), /No session is running/);
  for (const s of [owner, ana, co]) s.socket.close();
});

test("invites and guest tokens: revoke, issue, and revoking drops the guest", async () => {
  const { owner, campaignId } = await newRoom("Tokens");
  const anaClerk = await seatPlayer(owner, "ana-tok");
  const ana = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await ana.until(() => true);

  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).id!;
  refused(await ana.send({ type: "invite.revoke", id: inv }), /permission/);
  ok(await owner.send({ type: "invite.revoke", id: inv }));
  await owner.until((s) => !s.access.invites.some((i) => i.id === inv));
  refused(await owner.send({ type: "invite.revoke", id: inv }), /Invite not found/);

  const heroId = ok(await owner.send({ type: "actor.create", name: "Hero" })).id!;
  refused(await ana.send({ type: "token.issue", actorId: heroId }), /permission/);
  refused(await owner.send({ type: "token.issue", actorId: crypto.randomUUID() }), /Character not found/);
  const tok = ok(await owner.send({ type: "token.issue", actorId: heroId })).token!;
  const guest = connect({ auth: { campaignId, token: tok } });
  await guest.until((s) => s.actors.some((a) => a.id === heroId));

  refused(await ana.send({ type: "token.revoke", actorId: heroId }), /permission/);
  refused(await owner.send({ type: "token.revoke", actorId: crypto.randomUUID() }), /Character not found/);
  const gone = dropped(guest);
  ok(await owner.send({ type: "token.revoke", actorId: heroId }));
  await gone;
  await assert.rejects(connect({ auth: { campaignId, token: tok } }).connected(), /unauthorized/);
  for (const s of [owner, ana]) s.socket.close();
});

test("leaving drops every socket of that seat, and an offer to the leaver goes with them", async () => {
  const { owner, campaignId } = await newRoom("Leave");
  refused(await owner.send({ type: "seat.leave" }), /Hand the room on/);

  // A member with two tabs open leaves from one: the other goes too, and the room offer to them is withdrawn.
  const anaClerk = await seatPlayer(owner, "ana-leave");
  const tab1 = connect({ auth: { campaignId, clerkToken: anaClerk } });
  const tab2 = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await Promise.all([tab1.until(() => true), tab2.until(() => true)]);
  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ana-leave") }));
  await owner.until((s) => s.access.transfer?.toUserId === uid("ana-leave"));
  const gone = [dropped(tab1), dropped(tab2)];
  ok(await tab1.send({ type: "seat.leave" }));
  await Promise.all(gone);
  const after = await owner.until((s) => !s.access.members.some((m) => m.userId === uid("ana-leave")));
  assert.equal(after.access.transfer, null);
  assert.equal(after.actors.find((a) => a.name === "ana-leave")?.status, "retired", "the character stays, retired");

  // A guest on two phones leaves from one: both go, and the QR stops working.
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const g = await post(`/invites/${code}/accept`, { newCharacterName: "Bran", asGuest: true });
  const cookie = g.headers.get("set-cookie")?.split(";")[0] ?? "";
  const phone1 = connect({ auth: { campaignId }, headers: { cookie } });
  const phone2 = connect({ auth: { campaignId }, headers: { cookie } });
  await Promise.all([phone1.until(() => true), phone2.until(() => true)]);
  const both = [dropped(phone1), dropped(phone2)];
  ok(await phone1.send({ type: "seat.leave" }));
  await Promise.all(both);
  await assert.rejects(connect({ auth: { campaignId }, headers: { cookie } }).connected(), /unauthorized/);
  await owner.until((s) => s.actors.find((a) => a.name === "Bran")?.status === "retired");
  // The room QR doesn't offer a retired character to the next player.
  const preview = (await (await get(`/invites/${code}`)).json()) as InvitePreview;
  assert.deepEqual(preview.openActors, []);
  owner.socket.close();
});

test("a GM removes players only; a removed player's character stays, retired", async () => {
  const { owner, campaignId } = await newRoom("Remove");
  const gmInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false })).token!;
  const benClerk = clerk("ben-rm");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, bearer(benClerk))).status, 200);
  const coInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false })).token!;
  assert.equal((await post(`/invites/${coInv}/accept`, {}, bearer(clerk("co-rm")))).status, 200);
  await seatPlayer(owner, "ana-rm");
  const ben = connect({ auth: { campaignId, clerkToken: benClerk } });
  await ben.until(() => true);

  // Only the owner removes a GM or co-GM (docs/design.md §3.6).
  refused(await ben.send({ type: "member.remove", userId: uid("co-rm") }), /Only the owner/);
  ok(await ben.send({ type: "member.remove", userId: uid("ana-rm") }));
  const s = await owner.until((st) => !st.access.members.some((m) => m.userId === uid("ana-rm")));
  assert.equal(s.actors.find((a) => a.name === "ana-rm")?.status, "retired");
  ok(await owner.send({ type: "member.remove", userId: uid("co-rm") }));
  for (const c of [owner, ben]) c.socket.close();
});

test("a room offer: cancelled by the owner, and withdrawn when the recipient is removed", async () => {
  const { owner, campaignId } = await newRoom("Offer");
  const gmInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false })).token!;
  const benClerk = clerk("ben-offer");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, bearer(benClerk))).status, 200);
  const ben = connect({ auth: { campaignId, clerkToken: benClerk } });
  await ben.until(() => true);

  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ben-offer") }));
  refused(await ben.send({ type: "campaign.transferCancel" }), /permission/);
  ok(await owner.send({ type: "campaign.transferCancel" }));
  await owner.until((s) => s.access.transfer === null);
  refused(await ben.send({ type: "campaign.transferAccept" }), /no offer for you/);

  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ben-offer") }));
  await owner.until((s) => s.access.transfer?.toUserId === uid("ben-offer"));
  const gone = dropped(ben);
  ok(await owner.send({ type: "member.remove", userId: uid("ben-offer") }));
  await gone;
  const after = await owner.until((s) => !s.access.members.some((m) => m.userId === uid("ben-offer")));
  assert.equal(after.access.transfer, null, "the offer went with the seat");
  owner.socket.close();
});

test("codex: a reader listed twice is one reader, and an entry deletes once", async () => {
  const { owner } = await newRoom("Codex");
  const hero = ok(await owner.send({ type: "actor.create", name: "Hero" })).id!;
  const h = ok(await owner.send({ type: "codex.save", kind: "handout", title: "Map" })).id!;
  ok(
    await owner.send({
      type: "codex.reveal",
      id: h,
      visibility: "party",
      audienceMode: "listed",
      audience: [hero, hero],
    }),
  );
  await eventually(
    () => JSON.stringify(owner.codex()?.entries.find((e) => e.id === h)?.audience) === JSON.stringify([hero]),
    "one reader",
  );
  ok(await owner.send({ type: "codex.delete", id: h }));
  await eventually(() => !owner.codex()?.entries.some((e) => e.id === h), "the entry is gone");
  refused(await owner.send({ type: "codex.delete", id: h }), /Entry not found/);
  owner.socket.close();
});

test("the admin action route seats a known user and refuses anything but housekeeping", async () => {
  const { owner, campaignId } = await newRoom("Seat");
  const rootClerk = clerk("root-seat", "admin");
  const act = (body: unknown) => post(`/admin/campaigns/${campaignId}/action`, body, bearer(rootClerk));
  assert.equal((await act({ type: "session.start" })).status, 400, "not an admin action");
  assert.equal((await post(`/admin/campaigns/${campaignId}/action`, { type: "member.seat", userId: "x" })).status, 401);
  refused((await (await act({ type: "member.seat", userId: uid("nobody") })).json()) as ActionResult, /User not found/);
  await get("/lobby", bearer(clerk("dana-seat"))); // the app has now seen them
  ok((await (await act({ type: "member.seat", userId: uid("dana-seat") })).json()) as ActionResult);
  await owner.until((s) => s.access.members.some((m) => m.userId === uid("dana-seat") && m.role === "gm"));
  refused(await owner.send({ type: "member.seat", userId: uid("dana-seat") }), /permission/);
  owner.socket.close();
});

test("accepting an invite moves the state version", async () => {
  const { owner } = await newRoom("InviteVersion");
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const v0 = (await owner.until((s) => s.access.invites.length === 1)).stateVersion;
  const token = clerk("ana-ver");
  assert.equal((await post(`/invites/${code}/accept`, { newCharacterName: "Ana" }, bearer(token))).status, 200);
  const s = await owner.until((st) => st.access.members.some((m) => m.userId === uid("ana-ver")));
  assert.ok(s.stateVersion > v0, "the accept bumps it, so a client keeps the new snapshot");
  owner.socket.close();
});

// ---- Ruleset actions: the pipeline, the value rows and undo (docs/design.md §5.3-5.4) ----------------------------
// There is no importer yet (P1 C), so a room gets its ruleset and its actors' values straight from the database. The
// ruleset is test/fixture.ts, our own invention.

const withDb = async <T>(fn: (c: Client) => Promise<T>) => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

let rulesets = 0;
async function pinFixture(campaignId: string) {
  const n = `${run}-${++rulesets}`;
  await withDb(async (c) => {
    const rs = await c.query(
      "INSERT INTO ruleset (owner_user_id, slug, title) VALUES ($1, $2, 'Fixture') RETURNING id",
      [`fixture-${n}`, `fixture-${n}`],
    );
    const v = await c.query(
      "INSERT INTO ruleset_version (ruleset_id, version, hash, manifest) VALUES ($1, '0.1.0', $2, $3) RETURNING id",
      [rs.rows[0].id, `fixture-${n}`, JSON.stringify(FIXTURE_RULESET)],
    );
    await c.query("UPDATE campaign SET ruleset_version_id = $1 WHERE id = $2", [v.rows[0].id, campaignId]);
  });
}

// Gives an actor the ruleset's entity type, field values and resource rows.
async function equip(
  actorId: string,
  entity: string,
  values: { fields?: Record<string, number | string>; resources?: Record<string, number> },
) {
  await withDb(async (c) => {
    await c.query("UPDATE actor SET entity_type = $1 WHERE id = $2", [entity, actorId]);
    for (const [id, v] of Object.entries(values.fields ?? {}))
      await c.query(
        "INSERT INTO actor_field (actor_id, field_id, ordinal, int_value, text_value) VALUES ($1, $2, 0, $3, $4)",
        [actorId, id, typeof v === "number" ? v : null, typeof v === "string" ? v : null],
      );
    for (const [id, v] of Object.entries(values.resources ?? {}))
      await c.query("INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, $2, $3)", [actorId, id, v]);
  });
}

const query = <R extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  withDb(async (c) => (await c.query<R>(sql, params)).rows);

// A room with the fixture ruleset, a player (Ana) holding a character, and a creature the GM runs. The character has
// level 3 and Grit 14, so 14 Vigour at most; the creature has 10.
async function rulesRoom(name: string) {
  const { owner, campaignId } = await newRoom(name);
  const anaClerk = await seatPlayer(owner, `ana-${name}`);
  const ana = connect({ auth: { campaignId, clerkToken: anaClerk } });
  await ana.until(() => true);
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  const ogre = ok(await owner.send({ type: "actor.create", kind: "creature", name: "Ogre" })).id!;
  await pinFixture(campaignId);
  await equip(hero, "character", {
    fields: { level: 3, "attr.con": 14, "attr.dex": 12, diary: "" },
    resources: { hp: 14, focus: 1 },
  });
  await equip(ogre, "creature", { fields: { level: 2, "attr.con": 10, "attr.dex": 10 }, resources: { hp: 10 } });
  // Any action rebroadcasts, now with the ruleset in place.
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Lyra" }));
  await owner.until((s) => s.actors.find((a) => a.id === hero)?.entity === "character");
  await ana.until((s) => s.actors.find((a) => a.id === hero)?.entity === "character");
  return { owner, ana, campaignId, hero, ogre };
}

const adjust = (actorId: string, resource: string, delta: number) =>
  ({ type: "rule.op", primitive: "resource.capped", op: "adjust", input: { actorId, resource, delta } }) as const;
const resourceOf = (c: ReturnType<typeof connect>, id: string, resource: string, value: number) =>
  c.until((s) => s.actors.find((a) => a.id === id)?.resources[resource] === value);
const actorIn = (s: LiveState, id: string) => s.actors.find((a) => a.id === id);

test("rule.op: the server clamps, and each seat writes only what its `editableBy` allows", async () => {
  const { owner, ana, hero, ogre } = await rulesRoom("Clamp");
  const lyra = actorIn(await owner.until(() => true), hero)!;
  assert.deepEqual(
    [lyra.resources.hp, lyra.derived.maxHp, lyra.conditions],
    [14, 14, []],
    "the snapshot carries values and derived",
  );

  // Damage far past zero stops at the minimum; healing past the max stops at the max.
  ok(await owner.send(adjust(hero, "hp", -100)));
  await resourceOf(owner, hero, "hp", 0);
  ok(await owner.send(adjust(hero, "hp", 100)));
  await resourceOf(owner, hero, "hp", 14);
  refused(await owner.send(adjust(hero, "hp", 5_000_000)), /delta/);
  refused(await owner.send({ type: "rule.op", primitive: "nope", op: "adjust", input: {} }), /No operation/);
  refused(await owner.send({ type: "rule.op", primitive: "resource.capped", op: "nope", input: {} }), /No operation/);
  refused(await owner.send(adjust(crypto.randomUUID(), "hp", -1)), /no actor/);
  refused(await owner.send(adjust(hero, "mana", -1)), /no resource "mana"/);

  // A player: spends their own `ownerSpendOnly` focus, never gains it, and never touches a `gm` resource.
  ok(await ana.send(adjust(hero, "focus", -1)));
  await resourceOf(ana, hero, "focus", 0);
  refused(await ana.send(adjust(hero, "focus", 1)), /only spend/);
  refused(await ana.send(adjust(hero, "hp", -1)), /Only the GM can change that/);
  refused(await ana.send(adjust(ogre, "hp", -1)), /Not your character/);
  refused(
    await ana.send({ type: "rule.op", primitive: "health.tracks", op: "damage", input: { actorId: hero, amount: 1 } }),
    /permission/,
  );
  await resourceOf(owner, hero, "hp", 14);
  for (const c of [owner, ana]) c.socket.close();
});

test("field.set: type and range are checked, `editableBy` decides who writes, hidden fields stay hidden", async () => {
  const { owner, ana, campaignId, hero, ogre } = await rulesRoom("Fields");
  const ben = connect({ auth: { campaignId, clerkToken: await seatPlayer(owner, "ben-Fields") } });
  await ben.until(() => true);
  const set = (actorId: string, field: string, value: number | string | string[] | null) =>
    ({ type: "field.set", actorId, field, value }) as const;

  // The owner writes their own `owner` fields; `gm` fields and other characters are the GM's.
  ok(await ana.send(set(hero, "diary", "Met a dragon")));
  refused(await ana.send(set(hero, "diary", "x".repeat(41))), /over the cap of 40/);
  refused(await ana.send(set(hero, "gmNote", "hm")), /Only the GM can change that/);
  refused(await ana.send(set(hero, "level", 4)), /Only the GM can change that/);
  refused(await ana.send(set(ogre, "level", 4)), /Not your character/);
  refused(await ana.send(set(hero, "nope", 1)), /no field "nope"/);

  // The GM is checked against the declaration too.
  ok(await owner.send(set(hero, "gmNote", "she is the heir")));
  refused(await owner.send(set(hero, "level", 99)), /above the maximum of 20/);
  refused(await owner.send(set(hero, "level", "high")), /expected a whole number/);
  ok(await owner.send(set(hero, "level", 5)));
  ok(await owner.send(set(hero, "tags", ["a", "b"])));
  refused(await owner.send(set(hero, "tags", ["a", "b", "c", "d"])), /more than 3 items/);
  const gm = await owner.until((s) => actorIn(s, hero)?.derived.maxHp === 18);
  assert.deepEqual(actorIn(gm, hero)?.fields.tags, ["a", "b"]);
  assert.equal(actorIn(gm, hero)?.fields.gmNote, "she is the heir");

  // What each seat is sent: the GM note never leaves the GM, the diary goes to its owner only, party fields to all.
  const mine = actorIn(await ana.until((s) => actorIn(s, hero)?.fields.level === 5), hero)!;
  assert.equal(mine.fields.diary, "Met a dragon");
  assert.equal("gmNote" in mine.fields, false);
  assert.equal(mine.derived.maxHp, 18);
  assert.equal(mine.resources.focus, 1);
  const theirs = actorIn(await ben.until((s) => actorIn(s, hero)?.fields.level === 5), hero)!;
  assert.equal("diary" in theirs.fields, false, "another player doesn't see the diary");
  assert.equal("gmNote" in theirs.fields, false);
  assert.equal(theirs.resources.focus, undefined, "focus is the owner's");
  assert.equal(actorIn(await ana.until(() => true), ogre), undefined, "the creature stays on the GM side");
  for (const c of [owner, ana, ben]) c.socket.close();
});

test("conditions: stack by the manifest, tick down through conditions.expire, hidden where the manifest hides them", async () => {
  const { owner, ana, hero } = await rulesRoom("Conditions");
  const add = (condition: string, expiresAfter?: number) =>
    ({ type: "condition.add", actorId: hero, condition, expiresAfter }) as const;
  refused(await ana.send(add("dazed")), /permission/);
  ok(await owner.send(add("dazed", 2)));
  ok(await owner.send(add("marked")));
  const gm = await owner.until((s) => (actorIn(s, hero)?.conditions.length ?? 0) === 2);
  assert.deepEqual(actorIn(gm, hero)?.conditions.toSorted(), ["dazed", "marked"]);
  const seen = await ana.until((s) => (actorIn(s, hero)?.conditions.length ?? 0) === 1);
  assert.deepEqual(actorIn(seen, hero)?.conditions, ["dazed"], "`marked` is gm-only");

  assert.equal(ok(await owner.send(add("dazed"))).id, undefined, "stacking `none`: again does nothing");
  for (let i = 0; i < 4; i++) ok(await owner.send(add("braced")));
  const braced = await query<{ stacks: number }>(
    "SELECT stacks FROM actor_condition WHERE actor_id = $1 AND condition_id = 'braced'",
    [hero],
  );
  assert.deepEqual(
    braced.map((r) => r.stacks),
    [3],
    "one row, and maxStacks caps it",
  );
  refused(await owner.send(add("nope")), /No condition "nope"/);

  // `refresh`: applying it again restarts the count, and without one the count is cleared (house decision 19).
  const burning = () =>
    query<{ expires_after: number | null }>(
      "SELECT expires_after FROM actor_condition WHERE actor_id = $1 AND condition_id = 'burning'",
      [hero],
    );
  ok(await owner.send(add("burning", 2)));
  assert.deepEqual(await burning(), [{ expires_after: 2 }]);
  ok(await owner.send(add("burning", 5)));
  assert.deepEqual(await burning(), [{ expires_after: 5 }]);
  ok(await owner.send(add("burning")));
  assert.deepEqual(await burning(), [{ expires_after: null }]);
  ok(await owner.send({ type: "condition.remove", actorId: hero, condition: "burning" }));

  // `dazed` lasts two round ends: the first ticks it down (a row delta), the second removes it.
  const roundEnd = { type: "rule.op", primitive: "conditions.expire", op: "roundEnd", input: {} } as const;
  refused(await ana.send(roundEnd), /permission/);
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send(roundEnd));
  const left = () =>
    query<{ expires_after: number | null }>(
      "SELECT expires_after FROM actor_condition WHERE actor_id = $1 AND condition_id = 'dazed'",
      [hero],
    );
  assert.deepEqual(await left(), [{ expires_after: 1 }]);
  ok(await owner.send({ type: "event.undo" }));
  assert.deepEqual(await left(), [{ expires_after: 2 }], "a tick is undone by the tick back");
  ok(await owner.send(roundEnd));
  ok(await owner.send(roundEnd));
  assert.deepEqual(await left(), [], "the last tick removes the row");
  ok(await owner.send({ type: "event.undo" }));
  assert.deepEqual(await left(), [{ expires_after: 1 }], "and undo puts the row back");

  ok(await owner.send({ type: "condition.remove", actorId: hero, condition: "dazed" }));
  refused(await owner.send({ type: "condition.remove", actorId: hero, condition: "dazed" }), /doesn't have/);
  refused(await ana.send({ type: "condition.remove", actorId: hero, condition: "marked" }), /permission/);
  const bare = ok(await owner.send({ type: "actor.create", kind: "npc", name: "Bare" })).id!;
  refused(await owner.send({ ...add("dazed"), actorId: bare }), /isn't built for this ruleset/);
  for (const c of [owner, ana]) c.socket.close();
});

test("actor.rest and session boundaries run the engine's rest primitive", async () => {
  const { owner, ana, hero, ogre } = await rulesRoom("Rest");
  const rest = (event: string, actorId?: string) => ({ type: "actor.rest", event, actorId }) as const;
  ok(await owner.send(adjust(hero, "hp", -9)));
  ok(await owner.send(adjust(ogre, "hp", -7)));
  await resourceOf(owner, hero, "hp", 5);

  refused(await ana.send(rest("longRest")), /permission/);
  refused(await owner.send(rest("nap")), /No rest called "nap"/);
  refused(await owner.send(rest("longRest", crypto.randomUUID())), /no actor/);
  ok(await owner.send(rest("longRest", hero)));
  await resourceOf(owner, hero, "hp", 14);
  assert.equal(actorIn(await owner.until(() => true), ogre)?.resources.hp, 3, "only the one asked");
  ok(await owner.send(rest("longRest")));
  await resourceOf(owner, hero, "hp", 14);
  assert.equal(ok(await owner.send(rest("longRest"))).id, undefined, "already full: nothing to log");

  ok(await owner.send(rest("shortRest")));
  await resourceOf(owner, hero, "focus", 3);
  // Starting a session sets focus to 1 (sessionStart), and the running session's undo takes it back.
  ok(await owner.send({ type: "session.start" }));
  await resourceOf(owner, hero, "focus", 1);
  ok(await owner.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "focus", 3);
  for (const c of [owner, ana]) c.socket.close();
});

test("event.undo: newest first, deltas stay, a deleted actor is skipped, only the combat side may", async () => {
  const { owner, ana, campaignId, hero, ogre } = await rulesRoom("Undo");
  const set = (field: string, value: string) => ({ type: "field.set", actorId: hero, field, value }) as const;
  refused(await owner.send({ type: "event.undo" }), /No session is running/);
  ok(await owner.send({ type: "session.start" }));
  refused(await owner.send({ type: "event.undo" }), /Nothing to undo/);

  // Two hits come back newest first: the second (2), then the first (3).
  const hit1 = ok(await owner.send(adjust(hero, "hp", -3))).id!;
  const hit2 = ok(await owner.send(adjust(hero, "hp", -2))).id!;
  await resourceOf(owner, hero, "hp", 9);
  assert.equal(ok(await owner.send({ type: "event.undo" })).id, hit2);
  await resourceOf(owner, hero, "hp", 11);
  assert.equal(ok(await owner.send({ type: "event.undo" })).id, hit1);
  await resourceOf(owner, hero, "hp", 14);
  refused(await owner.send({ type: "event.undo" }), /Nothing to undo/);

  // A set goes back to what it held before, one step at a time.
  ok(await owner.send(set("gmNote", "one")));
  ok(await owner.send(set("gmNote", "two")));
  const note = (s: LiveState) => actorIn(s, hero)?.fields.gmNote;
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => note(s) === "one");
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => note(s) === undefined);

  // One action with several writes (hp, status, tallies) is taken back together, after the edit made on top of it.
  ok(
    await owner.send({
      type: "rule.op",
      primitive: "health.tracks",
      op: "damage",
      input: { actorId: hero, amount: 20 },
    }),
  );
  await owner.until((s) => actorIn(s, hero)?.fields.healthState === "dying");
  ok(await owner.send(set("healthState", "stable")));
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => actorIn(s, hero)?.fields.healthState === "dying");
  ok(await owner.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "hp", 14);
  await owner.until((s) => actorIn(s, hero)?.fields.healthState === undefined);

  // A deleted actor doesn't block undo: its step is skipped and noted, and the next undo goes on to the one before.
  ok(await owner.send(adjust(hero, "hp", -1)));
  ok(await owner.send(adjust(ogre, "hp", -2)));
  ok(await owner.send({ type: "actor.delete", id: ogre }));
  ok(await owner.send({ type: "event.undo" }));
  const [undoEvent] = await query<{ payload: { skipped: { actorId: string; reason: string }[] } }>(
    "SELECT payload FROM session_event WHERE campaign_id = $1 AND type = 'undo' ORDER BY created_at DESC, id DESC LIMIT 1",
    [campaignId],
  );
  assert.deepEqual(undoEvent?.payload.skipped, [{ actorId: ogre, reason: "deleted" }]);
  await resourceOf(owner, hero, "hp", 13);
  ok(await owner.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "hp", 14);
  refused(await owner.send({ type: "event.undo" }), /Nothing to undo/);

  // Who may undo: not the player, not a co-GM without the combat scope; a co-GM with it, yes.
  ok(await owner.send(adjust(hero, "hp", -1)));
  refused(await ana.send({ type: "event.undo" }), /permission/);
  const cogm = async (name: string, scopes: ("combat" | "session")[]) => {
    const code = ok(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false })).token!;
    const token = clerk(name);
    assert.equal((await post(`/invites/${code}/accept`, {}, bearer(token))).status, 200);
    ok(await owner.send({ type: "member.appoint", userId: uid(name), role: "cogm", scopes }));
    const c = connect({ auth: { campaignId, clerkToken: token } });
    await c.until(() => true);
    return c;
  };
  const session = await cogm("co-session-Undo", ["session"]);
  refused(await session.send({ type: "event.undo" }), /permission/);
  const combat = await cogm("co-combat-Undo", ["combat"]);
  ok(await combat.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "hp", 14);

  // HP is the combat side's: a co-GM with only the combat scope deals damage, the session co-GM and a player can't.
  const damage = {
    type: "rule.op",
    primitive: "health.tracks",
    op: "damage",
    input: { actorId: hero, amount: 1 },
  } as const;
  ok(await combat.send(damage));
  await resourceOf(owner, hero, "hp", 13);
  refused(await session.send(damage), /permission/);
  refused(await ana.send(damage), /permission/);
  ok(await combat.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "hp", 14);

  // Ended session: nothing left to undo.
  ok(await owner.send({ type: "session.end" }));
  refused(await owner.send({ type: "event.undo" }), /No session is running/);

  // The log: every write has its action and seat, undone steps point at their undo event.
  const log = await query<{ type: string; seat_user_id: string | null; undone_by: string | null; id: string }>(
    "SELECT id, type, seat_user_id, undone_by FROM session_event WHERE campaign_id = $1 ORDER BY created_at, id",
    [campaignId],
  );
  const undoIds = new Set(log.filter((e) => e.type === "undo").map((e) => e.id));
  assert.ok(undoIds.size >= 7, `${undoIds.size} undo events`);
  const deltas = log.filter((e) => e.type === "delta");
  assert.ok(deltas.length >= 8);
  assert.ok(deltas.every((e) => [uid("owner-Undo"), uid("co-combat-Undo")].includes(e.seat_user_id ?? "")));
  assert.ok(deltas.filter((e) => e.undone_by !== null).every((e) => undoIds.has(e.undone_by!)));
  assert.equal(deltas.filter((e) => e.undone_by === null).length, 0, "everything in this run was taken back");
  for (const c of [owner, ana, session, combat]) c.socket.close();
});

test("a turn op is refused until the combat tracker gives it an encounter, and nothing is logged", async () => {
  const { owner, campaignId, hero, ogre } = await rulesRoom("Turn");
  ok(await owner.send({ type: "session.start" }));
  refused(
    await owner.send({
      type: "rule.op",
      primitive: "initiative.ranked",
      op: "start",
      input: {
        combatants: [
          { id: hero, score: 3 },
          { id: ogre, score: 1 },
        ],
      },
    }),
    /encounter/,
  );
  const rows = await query("SELECT 1 FROM session_event WHERE campaign_id = $1", [campaignId]);
  assert.equal(rows.length, 0, "the refusal rolled the action back");
  owner.socket.close();
});
