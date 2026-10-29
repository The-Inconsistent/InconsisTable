// End-to-end check against a running api (bun run dev:api) + Postgres 18 (bun run dev:db). The api must run with
// ADMIN_KEY set (32+ characters) and the suite with the same value: admin calls use it. Every simulated person is a
// device: a random `it_device` cookie, so the api makes the user on first sight.
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { io } from "socket.io-client";
import { DEVICE_COOKIE, SESSION_COOKIE, deviceSecret } from "@inconsistable/auth/api";
import type {
  ActionInput,
  ActionResult,
  Codex,
  InvitePreview,
  LiveState,
  Lobby,
  RefusalKey,
} from "@inconsistable/core-schema";
import { MAX_NEW_CHARACTERS_PER_INVITE } from "../src/auth/invite.limits.ts";
import { MAX_PACKS_PER_USER } from "../src/pack/pack.normalize.ts";
// Made up for the engine's own tests (not exported from the package): a small ruleset and a pack for it.
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_HARVEST } from "../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { FIXTURE_RULESET } from "./fixture.ts";

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const run = Date.now().toString(36); // test users are fresh per run, so reruns never collide

const ADMIN = { "x-admin-key": process.env.ADMIN_KEY ?? "" };

// One simulated person: a random `it_device` cookie, remembered by name so the same name is the same person. The first
// request makes the user; its id is read back from the database so `uid(name)` can name them in assertions.
// Returns the Cookie header value.
const people = new Map<string, Promise<{ cookie: string; userId: string }>>();
const device = (name: string) => {
  let p = people.get(name);
  if (!p) {
    p = (async () => {
      const secret = deviceSecret();
      const cookie = `${DEVICE_COOKIE}=${secret}`;
      assert.equal((await get("/lobby", { cookie, "cf-connecting-ip": nextSocketIp() })).status, 200);
      const tokenHash = createHash("sha256").update(secret).digest("hex");
      const [row] = await withDb(
        async (c) => (await c.query("select user_id from device where token_hash = $1", [tokenHash])).rows,
      );
      known.set(name, row.user_id as string);
      return { cookie, userId: row.user_id as string };
    })();
    people.set(name, p);
  }
  return p.then((x) => x.cookie);
};
// The user id of a person made with device(name); a stranger's name gives an id nobody has.
const known = new Map<string, string>();
const uid = (name: string) => known.get(name) ?? `nobody-${name}-${run}`;
const cookieOf = (cookie: string) => ({ cookie });
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${API}/api${path}`, { headers });
// Writes carry the Fetch Metadata a browser sends from the web's own pages (the api's CSRF check, core/csrf.ts).
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${API}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...SAME_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

// Each socket comes from its own address: the suite opens more sockets than the api allows one address a minute. The
// api honours cf-connecting-ip only when started with TRUST_CF=1, so the suite needs it.
let sockets = 0;
const nextSocketIp = () =>
  `172.${16 + (Math.floor(++sockets / 250) % 16)}.${sockets % 250}.${1 + Math.floor(Math.random() * 250)}`;

// A socket at one table: `auth` carries campaignId plus a device `cookie`, a guest token or the admin key; `headers`
// can carry a guest cookie instead.
function connect({ auth: given, headers }: { auth: Record<string, string>; headers?: Record<string, string> }) {
  const { cookie, ...auth } = given; // a device's cookie travels as the header a browser would send
  const socket = io(API, {
    auth,
    extraHeaders: { "cf-connecting-ip": nextSocketIp(), ...(cookie ? { cookie } : {}), ...headers },
    transports: ["websocket"],
    reconnection: false,
  });
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
  const ownerDevice = await device(`owner-${name}`);
  const res = await post("/campaigns", { name }, cookieOf(ownerDevice));
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until((s) => s.campaign.name === name);
  return { owner, campaignId, ownerDevice };
}

const ok = (r: ActionResult) => {
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return r as Extract<ActionResult, { ok: true }>;
};
// A refusal by its code (sturdy), or by a pattern on the English text for the dynamic ones.
const refused = (r: ActionResult, expected: RegExp | RefusalKey) => {
  assert.equal(r.ok, false, "expected a refusal");
  if (r.ok) return;
  assert.equal(r.message, r.error, "message and error are the same text");
  if (typeof expected === "string") assert.equal(r.code, expected, r.error);
  else assert.match(r.error, expected);
};

test("GET /api/health answers 200 without a sign-in", async () => {
  const res = await get("/health");
  assert.equal(res.status, 200);
  assert.equal((await res.text()).length, 0);
});

test("only creators open rooms, and the creator owns the room", async () => {
  assert.equal((await post("/campaigns", { name: "x" })).status, 401);
  const plain = await device("plain");
  await withDb((c) => c.query("update app_user set role = 'user' where id = $1", [uid("plain")]));
  assert.equal((await post("/campaigns", { name: "x" }, cookieOf(plain))).status, 403);
  const { owner, ownerDevice, campaignId } = await newRoom("Owned");
  const s = await owner.until(() => true);
  assert.equal(s.campaign.ownerUserId, uid("owner-Owned"));
  assert.deepEqual(
    s.access.members.map((m) => [m.userId, m.role]),
    [[uid("owner-Owned"), "gm"]],
  );
  const lobby = (await (await get("/lobby", cookieOf(ownerDevice))).json()) as Lobby;
  assert.ok(lobby.mine.some((g) => g.id === campaignId && g.isOwner));
  owner.socket.close();
});

test("room QR: a signed-in player and a guest join, each holding their own character", async () => {
  const { owner, campaignId } = await newRoom("QR");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" }));
  const code = inv.token!;

  // A signed-in player starts a new character.
  const anaDevice = await device("ana");
  const preview = (await (await get(`/invites/${code}`, cookieOf(anaDevice))).json()) as InvitePreview;
  assert.equal(preview.mode, "room");
  assert.equal(preview.role, "player");
  const acc = await post(`/invites/${code}/accept`, { newCharacterName: "Lyra" }, cookieOf(anaDevice));
  assert.equal(acc.status, 200);
  const s1 = await owner.until((s) => s.actors.some((a) => a.name === "Lyra"));
  const lyra = s1.actors.find((a) => a.name === "Lyra")!;
  assert.equal(lyra.ownerUserId, uid("ana"));
  assert.deepEqual(s1.access.members.find((m) => m.userId === uid("ana"))?.characterIds, [lyra.id]);
  const anaLobby = (await (await get("/lobby", cookieOf(anaDevice))).json()) as Lobby;
  assert.deepEqual(
    anaLobby.characters.map((c) => [c.id, c.campaignId]),
    [[lyra.id, campaignId]],
  );

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
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  ok(await ana.send({ type: "actor.rename", id: lyra.id, name: "Lyra the Bold" }));
  refused(await ana.send({ type: "actor.rename", id: bran.id, name: "Mine now" }), "notYourCharacter");
  ok(await guest.send({ type: "actor.rename", id: bran.id, name: "Bran Stout" }));
  refused(await guest.send({ type: "actor.rename", id: lyra.id, name: "Mine now" }), "notYourCharacter");
  refused(await ana.send({ type: "session.start" }), "noPermission");
  refused(await ana.send({ type: "invite.create", mode: "room" }), "noPermission");

  for (const s of [owner, ana, guest]) s.socket.close();
});

test("the table screen joins by token and only reads", async () => {
  const { owner, campaignId } = await newRoom("Screen");
  const tok = ok(await owner.send({ type: "screen.issue" })).token!;
  const screen = connect({ auth: { campaignId, token: tok } });
  const s = await screen.until(() => true);
  assert.deepEqual(s.access.invites, []);
  refused(await screen.send({ type: "session.start" }), "screenReadOnly");
  refused(await screen.send({ type: "actor.create", name: "TV hero" }), "screenReadOnly");
  const page = (await screen.socket.emitWithAck("book:request", { source: "sample", page: 1 })) as ActionResult;
  refused(page, "bookScreenNone");
  // Revoking screens drops the TV.
  const gone = new Promise<void>((r) => screen.socket.once("disconnect", () => r()));
  ok(await owner.send({ type: "screen.revoke" }));
  await gone;
  owner.socket.close();
});

test("a GM can't remove the owner, and the owner hands the room on only when the recipient accepts", async () => {
  const { owner, ownerDevice, campaignId } = await newRoom("Transfer");
  // Invite a second GM: only the owner may invite a GM.
  const gmInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false })).token!;
  const benDevice = await device("ben");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, cookieOf(benDevice))).status, 200);
  const ben = connect({ auth: { campaignId, cookie: benDevice } });
  await ben.until((s) => s.access.members.some((m) => m.userId === uid("ben") && m.role === "gm"));

  // The GM can't remove the owner, invite another GM, delete the room or hand it on.
  refused(await ben.send({ type: "member.remove", userId: uid("owner-Transfer") }), "ownerNotRemovable");
  refused(
    await ben.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false }),
    /only invite players/,
  );
  refused(await ben.send({ type: "campaign.transfer", toUserId: uid("ben") }), "noPermission");
  ok(await ben.send({ type: "campaign.archive" })); // any GM archives (kept from Auspex)
  refused(await ben.send({ type: "campaign.delete", name: "Transfer" }), "noPermission"); // only the owner deletes
  ok(await owner.send({ type: "campaign.unarchive" }));

  // Offer the room: nothing moves until Ben accepts; nobody else can accept it.
  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ben") }));
  const offered = await owner.until((s) => s.access.transfer?.toUserId === uid("ben"));
  assert.equal(offered.campaign.ownerUserId, uid("owner-Transfer"));
  refused(await owner.send({ type: "campaign.transferAccept" }), "noOffer");
  const kicked = [owner, ben].map((s) => new Promise<void>((r) => s.socket.once("disconnect", () => r())));
  ok(await ben.send({ type: "campaign.transferAccept" }));
  // The old owner's socket, still open from before the transfer, has lost the owner's powers already.
  refused(await owner.send({ type: "member.appoint", userId: uid("ben"), role: "cogm", scopes: [] }), "noPermission");
  const moved = await owner.until((s) => s.campaign.ownerUserId === uid("ben"));
  assert.equal(moved.access.transfer, null);
  // Then every seat is kicked and resolves again: Ben now holds the owner's powers, the old owner is a GM.
  await Promise.all(kicked);
  const ben2 = connect({ auth: { campaignId, cookie: benDevice } });
  await ben2.until(() => true);
  ok(await ben2.send({ type: "member.appoint", userId: uid("owner-Transfer"), role: "cogm", scopes: ["combat"] }));
  const old = connect({ auth: { campaignId, cookie: ownerDevice } });
  await old.until(() => true);
  refused(await old.send({ type: "session.start" }), "noPermission"); // a combat-only co-GM
  ok(await ben2.send({ type: "member.remove", userId: uid("owner-Transfer") }));
  ben2.socket.close();
  old.socket.close();
});

test("a private handout reaches only its listed reader, and hides when that reader goes", async () => {
  const { owner, campaignId } = await newRoom("Handouts");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const anaDevice = await device("ana-h");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Lyra" }, cookieOf(anaDevice));
  const s = await owner.until((st) => st.actors.length === 1);
  const lyra = s.actors[0]!;
  const h = ok(
    await owner.send({ type: "codex.save", kind: "handout", title: "Letter", body: "Meet at dawn", gmNotes: "a trap" }),
  ).id!;
  ok(
    await owner.send({ type: "codex.reveal", id: h, visibility: "party", audienceMode: "listed", audience: [lyra.id] }),
  );
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
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

test("a room invite makes only so many characters, and the refusal says why", { timeout: 30_000 }, async () => {
  const { owner } = await newRoom("InviteCap");
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const headers = { "cf-connecting-ip": nextSocketIp() }; // 51 accepts from one address would pass the door's window
  const accept = (n: number) =>
    post(`/invites/${code}/accept`, { newCharacterName: `Guest ${n}`, asGuest: true }, headers);
  for (let n = 1; n <= MAX_NEW_CHARACTERS_PER_INVITE; n++) assert.equal((await accept(n)).status, 200, `guest ${n}`);
  const over = await accept(MAX_NEW_CHARACTERS_PER_INVITE + 1);
  assert.equal(over.status, 400);
  const refusal = (await over.json()) as { code: string; message: string; params?: { limit: number } };
  assert.equal(refusal.code, "inviteCharacterLimit");
  assert.equal(refusal.params?.limit, MAX_NEW_CHARACTERS_PER_INVITE);
  assert.match(refusal.message, /limit/);
  const s = await owner.until(
    (st) => st.actors.filter((a) => a.kind === "pc").length === MAX_NEW_CHARACTERS_PER_INVITE,
  );
  assert.equal(
    s.actors.filter((a) => a.kind === "pc").length,
    MAX_NEW_CHARACTERS_PER_INVITE,
    "the refused one left no character",
  );
  owner.socket.close();
});

test("the admin key: its room and socket actions are logged as admin-key, and its REST calls are rate limited", async () => {
  const key = process.env.ADMIN_KEY ?? "";
  assert.ok(key, "the suite needs ADMIN_KEY, the same value the api runs with");
  const scriptIp = { "x-admin-key": key, "cf-connecting-ip": nextSocketIp() };
  const res = await post("/campaigns", { name: "Scripted", ownerUserId: uid("script-owner") }, scriptIp);
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const script = connect({ auth: { campaignId, adminKey: key } });
  await script.until(() => true);
  ok(await script.send({ type: "session.start" }));
  const events = (await (await get("/admin/events", ADMIN)).json()) as {
    actorUserId: string;
    action: string;
    campaignId: string;
    detail: string | null;
  }[];
  const mine = events.filter((e) => e.actorUserId === "admin-key" && e.campaignId === campaignId);
  assert.deepEqual(mine.map((e) => e.action).sort(), ["campaign.create", "key.action", "room.open"]);
  assert.equal(mine.find((e) => e.action === "key.action")?.detail, "session.start");
  script.socket.close();

  // Right key or wrong, the REST calls of one address share a window.
  const guessIp = { "x-admin-key": "wrong", "cf-connecting-ip": nextSocketIp() };
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) statuses.push((await post("/campaigns", { name: "x" }, guessIp)).status);
  assert.ok(statuses.includes(429), "a burst of admin-key calls from one address is refused");
});

test("book pages are limited per seat: a second socket of the same seat shares the limit", async () => {
  const { owner, campaignId } = await newRoom("PageLimit");
  const anaDevice = await seatPlayer(owner, "ana-pages");
  const first = connect({ auth: { campaignId, cookie: anaDevice } });
  const second = connect({ auth: { campaignId, cookie: anaDevice } });
  await Promise.all([first.until(() => true), second.until(() => true)]);
  const ask = (c: typeof first) =>
    c.socket.emitWithAck("book:request", { source: "sample", page: 1 }) as Promise<ActionResult>;
  // Nobody serves "sample", so each answer is a quick refusal; the 31st request in the window is the limiter's.
  for (let i = 0; i < 30; i++) refused(await ask(first), "bookNotServed");
  refused(await ask(second), "tooManyPages");
  refused(await ask(first), "tooManyPages");
  for (const c of [owner, first, second]) c.socket.close();
});

test("the admin endpoints need the key: none is 401, a wrong one 403", async () => {
  const ip = () => ({ "cf-connecting-ip": nextSocketIp() });
  for (const path of ["/admin/campaigns", "/admin/packs", "/admin/events"]) {
    assert.equal((await get(path, ip())).status, 401, `${path} without a key`);
    assert.equal((await get(path, { ...ip(), "x-admin-key": "x".repeat(40) })).status, 403, `${path} with a wrong key`);
    assert.equal((await get(path, { ...ip(), ...ADMIN })).status, 200, `${path} with the key`);
  }
  const action = { type: "campaign.archive" };
  const any = "00000000-0000-4000-8000-000000000000";
  assert.equal((await post(`/admin/campaigns/${any}/action`, action, ip())).status, 401);
  assert.equal((await post(`/admin/campaigns/${any}/action`, action, { ...ip(), "x-admin-key": "nope" })).status, 403);
  assert.equal((await post(`/admin/packs/${any}/disable`, { disabled: true }, ip())).status, 401);
  // A device is not an admin, whatever it is.
  const cookie = await device("not-admin");
  assert.equal((await get("/admin/campaigns", { ...ip(), cookie })).status, 401);
});

test("the admin key runs housekeeping at a room over REST", async () => {
  const { owner, campaignId } = await newRoom("AdminRest");
  const res = await post(`/admin/campaigns/${campaignId}/action`, { type: "campaign.archive" }, ADMIN);
  ok((await res.json()) as ActionResult);
  const rows = (await (await get("/admin/campaigns", ADMIN)).json()) as { id: string; archived: boolean }[];
  assert.equal(rows.find((r) => r.id === campaignId)?.archived, true);
  assert.ok(
    rows.some((r) => r.id === campaignId && "ownerName" in r),
    "the list shows the room with its owner",
  );
  const events = (await (await get("/admin/events", ADMIN)).json()) as { action: string; campaignId: string }[];
  assert.ok(events.some((e) => e.action === "key.action" && e.campaignId === campaignId));
  owner.socket.close();
});

test("a missing, short or garbage it_device is no user, never an error; a fresh one is a new user", async () => {
  const ip = () => ({ "cf-connecting-ip": nextSocketIp() });
  assert.equal((await get("/lobby", ip())).status, 401);
  for (const bad of ["short", "x".repeat(31), `${"a".repeat(31)}=`, "%", "a b".repeat(20), "x".repeat(201)])
    assert.equal(
      (await get("/lobby", { ...ip(), cookie: `${DEVICE_COOKIE}=${bad}` })).status,
      401,
      `it_device=${bad.slice(0, 12)}`,
    );
  const first = `${DEVICE_COOKIE}=${deviceSecret()}`;
  const seen = async () => {
    const res = await get("/lobby", { ...ip(), cookie: first });
    assert.equal(res.status, 200);
    return (await res.json()) as Lobby;
  };
  assert.equal((await seen()).name, "Player");
  await seen();
  const rows = await withDb(
    async (c) =>
      (
        await c.query("select count(*)::int as n from device where token_hash = $1", [
          createHash("sha256").update(first.split("=")[1]!).digest("hex"),
        ])
      ).rows,
  );
  assert.equal(rows[0].n, 1, "the same secret is still one device");
  // Two first requests at once make one user.
  const racer = `${DEVICE_COOKIE}=${deviceSecret()}`;
  const both = await Promise.all([
    get("/lobby", { ...ip(), cookie: racer }),
    get("/lobby", { ...ip(), cookie: racer }),
  ]);
  assert.deepEqual(
    both.map((r) => r.status),
    [200, 200],
  );
  const users = await withDb(
    async (c) =>
      (
        await c.query("select count(*)::int as n from device where token_hash = $1", [
          createHash("sha256").update(racer.split("=")[1]!).digest("hex"),
        ])
      ).rows,
  );
  assert.equal(users[0].n, 1);
});

test("PATCH /me renames the device's user, and the new name shows at the table", async () => {
  const patch = (body: unknown, headers: Record<string, string>) =>
    fetch(`${API}/api/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "cf-connecting-ip": nextSocketIp(), ...SAME_ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await patch({ name: "Ana" }, {})).status, 401);
  const cookie = await device("renamer");
  assert.equal((await patch({ name: "" }, cookieOf(cookie))).status, 400);
  assert.equal((await patch({ name: "   " }, cookieOf(cookie))).status, 400);
  assert.equal((await patch({ name: "x".repeat(41) }, cookieOf(cookie))).status, 400);
  assert.equal((await patch({}, cookieOf(cookie))).status, 400);
  const res = await patch({ name: "  Ana the Bold  " }, cookieOf(cookie));
  assert.equal(res.status, 200);
  const lobby = (await (
    await get("/lobby", { ...cookieOf(cookie), "cf-connecting-ip": nextSocketIp() })
  ).json()) as Lobby;
  assert.equal(lobby.name, "Ana the Bold");
  const made = await post("/campaigns", { name: "Named" }, cookieOf(cookie));
  const { campaignId } = (await made.json()) as { campaignId: string };
  const socket = connect({ auth: { campaignId, cookie } });
  const s = await socket.until(() => true);
  assert.equal(s.access.members.find((m) => m.userId === uid("renamer"))?.name, "Ana the Bold");
  socket.socket.close();
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

// A signed-in player seated through a room invite with a new character of their name; returns their device cookie.
async function seatPlayer(owner: ReturnType<typeof connect>, name: string) {
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const token = await device(name);
  // An address of its own: the door's window (60 a minute) is shared by every accept of the suite otherwise.
  const headers = { ...cookieOf(token), "cf-connecting-ip": nextSocketIp() };
  assert.equal((await post(`/invites/${code}/accept`, { newCharacterName: name }, headers)).status, 200);
  await owner.until((s) => s.access.members.some((m) => m.userId === uid(name)));
  return token;
}

test("the room's settings and its sessions: update, start, edit, end", async () => {
  const { owner, campaignId } = await newRoom("Settings");
  const anaDevice = await seatPlayer(owner, "ana-set");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);

  ok(await owner.send({ type: "campaign.update", name: "Settings 2", nextSessionPlace: "Ana's" }));
  await owner.until((s) => s.campaign.name === "Settings 2" && s.campaign.nextSessionPlace === "Ana's");
  refused(await ana.send({ type: "campaign.update", name: "Mine" }), "noPermission");

  const sessionId = ok(await owner.send({ type: "session.start", title: "One" })).id!;
  ok(await owner.send({ type: "session.edit", sessionId, title: "One, again", notes: "the twist" }));
  await owner.until((s) => s.session?.title === "One, again" && s.session.notes === "the twist");
  refused(await ana.send({ type: "session.edit", sessionId, title: "x" }), "noPermission");
  refused(await owner.send({ type: "session.edit", sessionId: crypto.randomUUID(), title: "x" }), "sessionNotFound");

  // A co-GM who runs sessions reads the notes (house decision #31) but holds no secrets: they edit the title, not the notes.
  const cogmInv = ok(
    await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false }),
  ).token!;
  const coDevice = await device("co-set");
  assert.equal((await post(`/invites/${cogmInv}/accept`, {}, cookieOf(coDevice))).status, 200);
  ok(await owner.send({ type: "member.appoint", userId: uid("co-set"), role: "cogm", scopes: ["session"] }));
  const co = connect({ auth: { campaignId, cookie: coDevice } });
  assert.equal((await co.until(() => true)).session?.notes, "the twist", "the session scope reads the notes");
  ok(await co.send({ type: "session.edit", sessionId, notes: "the co-GM's twist" }));
  const codexCo = await coGm({ owner, campaignId, name: "co-codex-set", scopes: ["codex"] });
  refused(await codexCo.send({ type: "session.edit", sessionId, notes: "no" }), "noPermission"); // no session scope
  codexCo.socket.close();
  ok(await co.send({ type: "session.edit", sessionId, title: "Co's title" }));
  await owner.until((s) => s.session?.title === "Co's title" && s.session.notes === "the co-GM's twist");

  refused(await ana.send({ type: "session.end" }), "noPermission");
  ok(await owner.send({ type: "session.end", recap: "We met." }));
  await owner.until((s) => s.session === null);
  refused(await owner.send({ type: "session.end" }), "noSessionRunning");
  for (const s of [owner, ana, co]) s.socket.close();
});

test("invites and guest tokens: revoke, issue, and revoking drops the guest", async () => {
  const { owner, campaignId } = await newRoom("Tokens");
  const anaDevice = await seatPlayer(owner, "ana-tok");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);

  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).id!;
  refused(await ana.send({ type: "invite.revoke", id: inv }), "noPermission");
  ok(await owner.send({ type: "invite.revoke", id: inv }));
  await owner.until((s) => !s.access.invites.some((i) => i.id === inv));
  refused(await owner.send({ type: "invite.revoke", id: inv }), "inviteNotFound");

  const heroId = ok(await owner.send({ type: "actor.create", name: "Hero" })).id!;
  refused(await ana.send({ type: "token.issue", actorId: heroId }), "noPermission");
  refused(await owner.send({ type: "token.issue", actorId: crypto.randomUUID() }), "characterNotFound");
  const tok = ok(await owner.send({ type: "token.issue", actorId: heroId })).token!;
  const guest = connect({ auth: { campaignId, token: tok } });
  await guest.until((s) => s.actors.some((a) => a.id === heroId));

  refused(await ana.send({ type: "token.revoke", actorId: heroId }), "noPermission");
  refused(await owner.send({ type: "token.revoke", actorId: crypto.randomUUID() }), "characterNotFound");
  const gone = dropped(guest);
  ok(await owner.send({ type: "token.revoke", actorId: heroId }));
  await gone;
  await assert.rejects(connect({ auth: { campaignId, token: tok } }).connected(), /unauthorized/);
  for (const s of [owner, ana]) s.socket.close();
});

test("leaving drops every socket of that seat, and an offer to the leaver goes with them", async () => {
  const { owner, campaignId } = await newRoom("Leave");
  refused(await owner.send({ type: "seat.leave" }), "handOnFirst");

  // A member with two tabs open leaves from one: the other goes too, and the room offer to them is withdrawn.
  const anaDevice = await seatPlayer(owner, "ana-leave");
  const tab1 = connect({ auth: { campaignId, cookie: anaDevice } });
  const tab2 = connect({ auth: { campaignId, cookie: anaDevice } });
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
  const benDevice = await device("ben-rm");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, cookieOf(benDevice))).status, 200);
  const coInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false })).token!;
  assert.equal((await post(`/invites/${coInv}/accept`, {}, cookieOf(await device("co-rm")))).status, 200);
  await seatPlayer(owner, "ana-rm");
  const ben = connect({ auth: { campaignId, cookie: benDevice } });
  await ben.until(() => true);

  // Only the owner removes a GM or co-GM (docs/design.md §3.6).
  refused(await ben.send({ type: "member.remove", userId: uid("co-rm") }), "onlyOwnerRemovesGm");
  ok(await ben.send({ type: "member.remove", userId: uid("ana-rm") }));
  const s = await owner.until((st) => !st.access.members.some((m) => m.userId === uid("ana-rm")));
  assert.equal(s.actors.find((a) => a.name === "ana-rm")?.status, "retired");
  ok(await owner.send({ type: "member.remove", userId: uid("co-rm") }));
  for (const c of [owner, ben]) c.socket.close();
});

test("a room offer: cancelled by the owner, and withdrawn when the recipient is removed", async () => {
  const { owner, campaignId } = await newRoom("Offer");
  const gmInv = ok(await owner.send({ type: "invite.create", mode: "room", role: "gm", allowGuests: false })).token!;
  const benDevice = await device("ben-offer");
  assert.equal((await post(`/invites/${gmInv}/accept`, {}, cookieOf(benDevice))).status, 200);
  const ben = connect({ auth: { campaignId, cookie: benDevice } });
  await ben.until(() => true);

  ok(await owner.send({ type: "campaign.transfer", toUserId: uid("ben-offer") }));
  refused(await ben.send({ type: "campaign.transferCancel" }), "noPermission");
  ok(await owner.send({ type: "campaign.transferCancel" }));
  await owner.until((s) => s.access.transfer === null);
  refused(await ben.send({ type: "campaign.transferAccept" }), "noOffer");

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
  refused(await owner.send({ type: "codex.delete", id: h }), "entryNotFound");
  owner.socket.close();
});

test("the admin action route seats a known user and refuses anything but housekeeping", async () => {
  const { owner, campaignId } = await newRoom("Seat");
  const act = (body: unknown) => post(`/admin/campaigns/${campaignId}/action`, body, ADMIN);
  assert.equal((await act({ type: "session.start" })).status, 400, "not an admin action");
  assert.equal((await post(`/admin/campaigns/${campaignId}/action`, { type: "member.seat", userId: "x" })).status, 401);
  refused((await (await act({ type: "member.seat", userId: uid("nobody") })).json()) as ActionResult, "userNotFound");
  await get("/lobby", cookieOf(await device("dana-seat"))); // the app has now seen them
  ok((await (await act({ type: "member.seat", userId: uid("dana-seat") })).json()) as ActionResult);
  await owner.until((s) => s.access.members.some((m) => m.userId === uid("dana-seat") && m.role === "gm"));
  refused(await owner.send({ type: "member.seat", userId: uid("dana-seat") }), "noPermission");
  owner.socket.close();
});

test("accepting an invite moves the state version", async () => {
  const { owner } = await newRoom("InviteVersion");
  const code = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const v0 = (await owner.until((s) => s.access.invites.length === 1)).stateVersion;
  const token = await device("ana-ver");
  assert.equal((await post(`/invites/${code}/accept`, { newCharacterName: "Ana" }, cookieOf(token))).status, 200);
  const s = await owner.until((st) => st.access.members.some((m) => m.userId === uid("ana-ver")));
  assert.ok(s.stateVersion > v0, "the accept bumps it, so a client keeps the new snapshot");
  owner.socket.close();
});

// ---- The importer: rulesets and packs, and what a seat may read of them (docs/design.md §4.6) --------------------------
// SAMPLE_D20 and SAMPLE_PACK are made up for the engine's own tests (no book text).

interface Problem {
  path: string;
  message: string;
}
interface RulesetReply {
  ok: boolean;
  versionId: string;
  unchanged: boolean;
}
interface PackReply {
  ok: boolean;
  packId: string;
  versionId: string;
  unchanged: boolean;
  diff: { added: string[]; changed: string[]; removed: string[] };
  warnings: Problem[];
  problems?: Problem[];
}
interface RulesReply {
  ruleset: { versionId: string; manifest: { entities: { id: string; fields: Record<string, unknown> }[] } } | null;
  packs: { id: string; slug: string; license: string }[];
  entries: { pack: string; key: string; type: string; visibility: string }[];
  total: number;
}

// A signed-in caller with an address of its own, so the importer's rate limit doesn't add up across tests.
let ips = 0;
const ipBlock = 20 + Math.floor(Math.random() * 200); // per run: the api's windows outlive a test run
function caller(token: string) {
  const headers = { ...cookieOf(token), "cf-connecting-ip": `10.${ipBlock}.${Math.floor(++ips / 250)}.${ips % 250}` };
  const read = async <T>(res: Response) => ({ status: res.status, body: (await res.json()) as T });
  return {
    post: async <T>(path: string, body: unknown) => read<T>(await post(path, body, headers)),
    get: async <T>(path: string) => read<T>(await get(path, headers)),
  };
}
const keysOf = (r: RulesReply) => r.entries.map((e) => e.key).sort();
const SAMPLE_KEYS = ["coil-rope", "ember-wisp", "reedfolk", "wayfinder"];

test("importer: a ruleset and a pack are stored once, a re-import reports its diff, bad files are refused by path", async () => {
  assert.equal((await post("/rulesets", SAMPLE_D20)).status, 401);
  assert.equal((await post("/packs", SAMPLE_PACK)).status, 401);
  const me = caller(await device("imp"));

  // A pack needs the ruleset it is written for, imported first.
  const early = await me.post<PackReply>("/packs", SAMPLE_PACK);
  assert.equal(early.status, 422);
  assert.equal(early.body.problems?.[0]?.path, "ruleset.id");

  // A manifest without a cite is refused, by path, and nothing is stored.
  const uncited = structuredClone(SAMPLE_D20);
  delete uncited.resources?.[0]?.cite;
  const refusedRuleset = await me.post<PackReply>("/rulesets", uncited);
  assert.equal(refusedRuleset.status, 422);
  assert.ok(refusedRuleset.body.problems?.some((p) => p.path === "resources[0].cite"));
  assert.deepEqual((await me.get<unknown[]>("/rulesets")).body, []);

  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  assert.equal(rs.status, 201);
  assert.equal(rs.body.unchanged, false);
  const same = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  assert.deepEqual([same.body.unchanged, same.body.versionId], [true, rs.body.versionId], "the same file twice is one");
  const clash = await me.post<PackReply>("/rulesets", { ...SAMPLE_D20, terms: { party: "Band" } });
  assert.equal(clash.body.problems?.[0]?.path, "version", "a version is immutable: raise it to change it");
  const listed = await me.get<{ slug: string; versions: { id: string }[] }[]>("/rulesets");
  assert.deepEqual(
    listed.body.map((r) => [r.slug, r.versions.length]),
    [["sample-d20", 1]],
  );

  // First import: everything added, entries stored as rows.
  const first = await me.post<PackReply>("/packs", SAMPLE_PACK);
  assert.equal(first.status, 201);
  assert.deepEqual(first.body.diff, { added: SAMPLE_KEYS, changed: [], removed: [] });
  assert.equal(first.body.unchanged, false);
  const rows = await query<{ n: string }>("SELECT count(*) AS n FROM pack_entry WHERE pack_version_id = $1", [
    first.body.versionId,
  ]);
  assert.equal(rows[0]?.n, "4");

  // The same file again writes nothing; an edit reports exactly what moved, and only the new version is kept.
  const repeat = await me.post<PackReply>("/packs", SAMPLE_PACK);
  assert.deepEqual([repeat.body.unchanged, repeat.body.versionId], [true, first.body.versionId]);
  const edited = structuredClone(SAMPLE_PACK);
  edited.entries = edited.entries.filter((e) => e.key !== "coil-rope");
  edited.entries.push({ key: "lantern", type: "gear", name: "Lantern", cite: "Sample p.51", body: { weight: 1 } });
  if (edited.entries[0]) edited.entries[0].name = "Reed Folk";
  const second = await me.post<PackReply>("/packs", { ...edited, version: "0.2.0" });
  assert.equal(second.status, 201);
  assert.deepEqual(second.body.diff, { added: ["lantern"], changed: ["reedfolk"], removed: ["coil-rope"] });
  assert.equal(second.body.packId, first.body.packId);
  const versions = await query("SELECT id FROM pack_version WHERE pack_id = $1", [first.body.packId]);
  assert.equal(versions.length, 1, "the version no room attached is dropped");

  // A missing cite and an over-large entry body are refused with their paths; so is a different license.
  const uncitedPack = structuredClone(SAMPLE_PACK);
  delete uncitedPack.entries[0]?.cite;
  const noCite = await me.post<PackReply>("/packs", uncitedPack);
  assert.equal(noCite.status, 422);
  assert.ok(noCite.body.problems?.some((p) => p.path === "entries[0].cite"));
  const fat = structuredClone(SAMPLE_PACK);
  if (fat.entries[0]) fat.entries[0].body = { blurb: "x".repeat(20_000) };
  const tooBig = await me.post<PackReply>("/packs", fat);
  assert.ok(tooBig.body.problems?.some((p) => p.path === "entries[0].body.blurb"));
  const relabelled = await me.post<PackReply>("/packs", { ...SAMPLE_PACK, license: "srd", attribution: "Someone" });
  assert.equal(relabelled.body.problems?.[0]?.path, "license", "a private pack can't be re-imported as srd");
  assert.equal((await me.get<unknown[]>("/rulesets")).status, 200);

  // The file over 5 MB never reaches the validator.
  const huge = await post(
    "/packs",
    { pad: "x".repeat(5.5 * 1024 * 1024) },
    { ...cookieOf(await device("imp")), "cf-connecting-ip": `10.${ipBlock}.250.1` },
  );
  assert.equal(huge.status, 413);

  // My packs, with the quota used; the owner's export is the pack as it stands; nobody else gets it.
  const mine = await me.get<{
    packs: { id: string; slug: string; license: string; versions: { id: string }[] }[];
    usage: { packs: number; maxPacks: number };
  }>("/packs");
  assert.deepEqual(
    mine.body.packs.map((p) => [p.slug, p.license, p.versions.length]),
    [["sample-bestiary", "private", 1]],
  );
  assert.deepEqual([mine.body.usage.packs, mine.body.usage.maxPacks], [1, MAX_PACKS_PER_USER]);
  const exported = await me.get<{ id: string; version: string; entries: { key: string }[] }>(
    `/packs/${first.body.packId}/export`,
  );
  assert.equal(exported.status, 200);
  assert.deepEqual([exported.body.id, exported.body.version], ["sample-bestiary", "0.2.0"]);
  assert.deepEqual(exported.body.entries.map((e) => e.key).sort(), ["ember-wisp", "lantern", "reedfolk", "wayfinder"]);
  const again = await me.post<PackReply>("/packs", exported.body);
  assert.equal(again.body.unchanged, true, "the export is a file the importer takes back as it is");
  assert.equal((await caller(await device("snoop")).get(`/packs/${first.body.packId}/export`)).status, 404);
  assert.equal((await get(`/packs/${first.body.packId}/export`)).status, 401);

  // Deleting a pack no room uses removes it for real.
  const gone = await me.post<{ deleted: boolean }>(`/packs/${first.body.packId}/hide`, {});
  assert.deepEqual(gone.body, { deleted: true });
  assert.deepEqual((await me.get<{ packs: unknown[] }>("/packs")).body.packs, []);
  assert.equal((await query("SELECT 1 FROM pack_entry WHERE pack_version_id = $1", [second.body.versionId])).length, 0);
});

// 51 imports are slow on a CI runner: its own timeout.
test("importer: the 51st pack is over the quota, and imports are rate limited", { timeout: 30_000 }, async () => {
  const me = caller(await device("quota"));
  assert.equal((await me.post("/rulesets", SAMPLE_D20)).status, 201);
  for (let i = 0; i < MAX_PACKS_PER_USER; i++)
    assert.equal((await caller(await device("quota")).post("/packs", { ...SAMPLE_PACK, id: `pack-${i}` })).status, 201);
  const over = await caller(await device("quota")).post<PackReply>("/packs", { ...SAMPLE_PACK, id: "one-too-many" });
  assert.equal(over.status, 422);
  assert.equal(over.body.problems?.[0]?.path, "(quota)");

  const flood = caller(await device("flood"));
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) statuses.push((await flood.post("/packs", {})).status);
  assert.ok(statuses.includes(429), "a burst of imports from one address is refused");
}); // imports 51 packs

test("packs in a room: the pin, the seat-scoped read, and a private pack that stays with its GM", async () => {
  const ownerDevice = await device("pk-owner");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  const pk = await me.post<PackReply>("/packs", SAMPLE_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);

  // The room is made with a ruleset the owner imported, not someone else's.
  const rival = caller(await device("pk-rival"));
  assert.equal((await rival.post("/campaigns", { name: "Steal", rulesetVersionId: rs.body.versionId })).status, 400);
  const made = await me.post<{ campaignId: string }>("/campaigns", { name: "Pk", rulesetVersionId: rs.body.versionId });
  assert.equal(made.status, 201);
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);

  // Attach the pack; a player can't, and a pack that isn't the caller's is simply not found.
  const anaDevice = await seatPlayer(owner, "ana-pk");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  refused(await ana.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }), "noPermission");
  refused(await ana.send({ type: "campaign.setRuleset", rulesetVersionId: rs.body.versionId }), "noPermission");
  refused(await owner.send({ type: "campaign.attachPack", packVersionId: crypto.randomUUID() }), "packNotFound");
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId })); // pinned once, not twice

  // The GM reads everything, with the full manifest; filters page and narrow the list.
  const gm = await me.get<RulesReply>(`/campaigns/${campaignId}/rules`);
  assert.equal(gm.status, 200);
  assert.deepEqual(keysOf(gm.body), SAMPLE_KEYS);
  assert.equal(gm.body.packs.length, 1);
  assert.ok(gm.body.ruleset?.manifest.entities.some((e) => "gmNote" in e.fields));
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules?type=creature`)).body.entries.length, 1);
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules?q=EMBER`)).body.entries.length, 1);
  const page = (await me.get<RulesReply>(`/campaigns/${campaignId}/rules?limit=2&offset=1`)).body;
  assert.deepEqual([page.entries.length, page.total], [2, 4]);
  assert.equal((await me.get(`/campaigns/${campaignId}/rules?limit=100000`)).status, 400);

  // A player never gets a `gm` entry or a `gm` definition; nobody without a seat gets anything.
  const seen = await caller(anaDevice).get<RulesReply>(`/campaigns/${campaignId}/rules`);
  assert.deepEqual(keysOf(seen.body), ["coil-rope", "reedfolk", "wayfinder"]);
  assert.ok(seen.body.entries.every((e) => e.visibility !== "gm"));
  assert.ok(seen.body.ruleset?.manifest.entities.every((e) => !("gmNote" in e.fields)));
  assert.ok(seen.body.ruleset?.manifest.entities.some((e) => "level" in e.fields));
  assert.equal((await get(`/campaigns/${campaignId}/rules`)).status, 401);
  assert.equal((await caller(await device("pk-outsider")).get(`/campaigns/${campaignId}/rules`)).status, 401);

  // A private pack is served only while its owner is a GM here.
  await query("UPDATE membership SET role = 'cogm' WHERE campaign_id = $1 AND user_id = $2", [
    campaignId,
    uid("pk-owner"),
  ]);
  const demoted = await me.get<RulesReply>(`/campaigns/${campaignId}/rules`);
  assert.deepEqual([demoted.body.packs.length, demoted.body.entries.length], [0, 0]);
  await query("UPDATE membership SET role = 'gm' WHERE campaign_id = $1 AND user_id = $2", [
    campaignId,
    uid("pk-owner"),
  ]);

  // Another room, someone else's: the owner's pack can't be attached by a rival, nor by an admin who is no GM there.
  const rivalDevice = await device("pk-rival");
  const rivalRoom = await rival.post<{ campaignId: string }>("/campaigns", { name: "Rival" });
  const rivalSocket = connect({ auth: { campaignId: rivalRoom.body.campaignId, cookie: rivalDevice } });
  await rivalSocket.until(() => true);
  refused(await rivalSocket.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }), "packNotFound");
  refused(
    await rivalSocket.send({ type: "campaign.setRuleset", rulesetVersionId: rs.body.versionId }),
    /Ruleset not found/,
  );
  // A second device user can't read the owner's private pack, nor export it.
  const stranger = caller(await device("pk-stranger"));
  const strangerPacks = await stranger.get<{ packs: unknown[] }>("/packs");
  assert.deepEqual(strangerPacks.body.packs, [], "the library lists only my own packs");
  assert.equal((await stranger.get(`/packs/${pk.body.packId}/export`)).status, 404);
  // The admin key at someone else's room (no user, no seat) can't attach the owner's private pack there either.
  const adminSocket = connect({ auth: { campaignId: rivalRoom.body.campaignId, adminKey: ADMIN["x-admin-key"] } });
  await adminSocket.until(() => true);
  assert.equal((await adminSocket.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId })).ok, false);
  assert.deepEqual(
    (await query("SELECT 1 FROM campaign_pack WHERE campaign_id = $1", [rivalRoom.body.campaignId])).length,
    0,
  );

  // A room with no ruleset has nothing to attach a pack to.
  const bare = await me.post<{ campaignId: string }>("/campaigns", { name: "Bare" });
  const bareSocket = connect({ auth: { campaignId: bare.body.campaignId, cookie: ownerDevice } });
  await bareSocket.until(() => true);
  refused(await bareSocket.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }), "pickRulesetFirst");
  bareSocket.socket.close();

  // Deleting an attached pack hides it but keeps what the room uses; detached and deleted, it can't come back.
  assert.deepEqual((await me.post<{ deleted: boolean }>(`/packs/${pk.body.packId}/hide`, {})).body, { deleted: false });
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.entries.length, 4);
  ok(await owner.send({ type: "campaign.detachPack", packVersionId: pk.body.versionId }));
  refused(await owner.send({ type: "campaign.detachPack", packVersionId: pk.body.versionId }), "packNotAttached");
  refused(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }), "packDeleted");
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.entries.length, 0);
  assert.deepEqual((await me.post<{ deleted: boolean }>(`/packs/${pk.body.packId}/hide`, {})).body, { deleted: true });
  for (const c of [owner, ana, rivalSocket, adminSocket]) c.socket.close();
});

test("takedown: an admin disables a pack in every room at once, and it is logged", async () => {
  const ownerDevice = await device("td-owner");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  const pk = await me.post<PackReply>("/packs", SAMPLE_PACK);
  const { campaignId } = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "Takedown", rulesetVersionId: rs.body.versionId })
  ).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.entries.length, 4);

  const disable = (token: string | null, disabled: boolean) =>
    post(`/admin/packs/${pk.body.packId}/disable`, { disabled }, token ? { cookie: token } : ADMIN);
  assert.equal((await post(`/admin/packs/${pk.body.packId}/disable`, { disabled: true })).status, 401);
  assert.equal((await disable(ownerDevice, true)).status, 401, "the owner can't undo their own takedown");
  assert.equal((await disable(null, true)).status, 200);

  const served = await me.get<RulesReply>(`/campaigns/${campaignId}/rules`);
  assert.deepEqual([served.body.packs.length, served.body.entries.length], [0, 0], "no longer served to anyone");
  refused(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }), "packTakenDown");
  assert.equal((await me.get(`/packs/${pk.body.packId}/export`)).status, 403);
  const reimport = await me.post<PackReply>("/packs", SAMPLE_PACK);
  assert.equal(reimport.status, 422);
  assert.match(reimport.body.problems?.[0]?.message ?? "", /taken down/);
  const mine = await me.get<{ packs: { disabled: boolean }[] }>("/packs");
  assert.equal(mine.body.packs[0]?.disabled, true);

  const events = (await (await get("/admin/events", ADMIN)).json()) as {
    action: string;
    targetUserId: string | null;
  }[];
  assert.ok(events.some((e) => e.action === "pack.disable" && e.targetUserId === uid("td-owner")));
  assert.equal((await get("/admin/packs", ADMIN)).status, 200);

  // Put back, it serves again.
  assert.equal((await disable(null, false)).status, 200);
  assert.equal((await me.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.entries.length, 4);
  owner.socket.close();
});

// ---- Ruleset actions: the pipeline, the value rows and undo (docs/design.md §5.3-5.4) ----------------------------
// A room gets its ruleset through the importer; its actors' values are written straight to the database (nothing
// creates them yet). The ruleset is test/fixture.ts, our own invention.

const withDb = async <T>(fn: (c: Client) => Promise<T>) => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

// Imports the fixture ruleset as the room owner and pins it, the way a GM does: the importer, then campaign.setRuleset.
async function pinFixture({ owner, ownerDevice }: { owner: ReturnType<typeof connect>; ownerDevice: string }) {
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", FIXTURE_RULESET);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
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
  const { owner, ownerDevice, campaignId } = await newRoom(name);
  const anaDevice = await seatPlayer(owner, `ana-${name}`);
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  const ogre = ok(await owner.send({ type: "actor.create", kind: "creature", name: "Ogre" })).id!;
  await pinFixture({ owner, ownerDevice });
  await equip(hero, "character", {
    fields: { level: 3, "attr.con": 14, "attr.dex": 12, diary: "" },
    resources: { hp: 14, focus: 1 },
  });
  await equip(ogre, "creature", { fields: { level: 2, "attr.con": 10, "attr.dex": 10 }, resources: { hp: 10 } });
  // Any action rebroadcasts, now with the ruleset in place.
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Lyra" }));
  await owner.until((s) => s.actors.find((a) => a.id === hero)?.entity === "character");
  await ana.until((s) => s.actors.find((a) => a.id === hero)?.entity === "character");
  return { owner, ownerDevice, ana, campaignId, hero, ogre };
}

const adjust = (actorId: string, resource: string, delta: number) =>
  ({ type: "rule.op", primitive: "resource.capped", op: "adjust", input: { actorId, resource, delta } }) as const;
// HP moves only through the health track; a plain adjust on it is refused.
const hpStep = (actorId: string, resource: string, delta: number) =>
  delta < 0
    ? ({
        type: "rule.op",
        primitive: "health.tracks",
        op: "damage",
        input: { actorId, amount: -delta, track: resource, critical: false },
      } as const)
    : ({
        type: "rule.op",
        primitive: "health.tracks",
        op: "heal",
        input: { actorId, amount: delta, track: resource },
      } as const);
const resourceOf = (c: ReturnType<typeof connect>, id: string, resource: string, value: number) =>
  c.until((s) => s.actors.find((a) => a.id === id)?.resources[resource] === value);
const actorIn = (s: LiveState, id: string) => s.actors.find((a) => a.id === id);

test("campaign.setRuleset: a room whose characters use a version can't move to another", async () => {
  const { owner, ana, ownerDevice } = await rulesRoom("Pin");
  const next = await caller(ownerDevice).post<RulesetReply>("/rulesets", { ...FIXTURE_RULESET, version: "0.2.0" });
  assert.equal(next.status, 201);
  refused(
    await owner.send({ type: "campaign.setRuleset", rulesetVersionId: next.body.versionId }),
    /already use another version/,
  );
  for (const c of [owner, ana]) c.socket.close();
});

test("rule.op: the server clamps, and each seat writes only what its `editableBy` allows", async () => {
  const { owner, ana, hero, ogre } = await rulesRoom("Clamp");
  const lyra = actorIn(await owner.until(() => true), hero)!;
  assert.deepEqual(
    [lyra.resources.hp, lyra.derived.maxHp, lyra.conditions],
    [14, 14, []],
    "the snapshot carries values and derived",
  );

  // Damage far past zero stops at the minimum; healing past the max stops at the max.
  ok(await owner.send(hpStep(hero, "hp", -100)));
  await resourceOf(owner, hero, "hp", 0);
  ok(await owner.send(hpStep(hero, "hp", 100)));
  await resourceOf(owner, hero, "hp", 14);
  refused(await owner.send(hpStep(hero, "hp", 5_000_000)), /amount/);
  refused(await owner.send({ type: "rule.op", primitive: "nope", op: "adjust", input: {} }), "noOperation");
  refused(await owner.send({ type: "rule.op", primitive: "resource.capped", op: "nope", input: {} }), "noOperation");
  refused(await owner.send(hpStep(crypto.randomUUID(), "hp", -1)), "unknownActor");
  refused(await owner.send(adjust(hero, "mana", -1)), "unknownResource");
  refused(await owner.send(adjust(hero, "hp", -1)), "hpThroughDamage");

  // A player: spends their own `ownerSpendOnly` focus, never gains it, and never touches a `gm` resource.
  ok(await ana.send(adjust(hero, "focus", -1)));
  await resourceOf(ana, hero, "focus", 0);
  refused(await ana.send(adjust(hero, "focus", 1)), "onlySpend");
  refused(await ana.send(adjust(hero, "hp", -1)), "hpThroughDamage");
  refused(await ana.send(adjust(ogre, "focus", -1)), "notYourCharacter");
  refused(
    await ana.send({ type: "rule.op", primitive: "health.tracks", op: "damage", input: { actorId: hero, amount: 1 } }),
    /permission/,
  );
  await resourceOf(owner, hero, "hp", 14);
  for (const c of [owner, ana]) c.socket.close();
});

test("field.set: type and range are checked, `editableBy` decides who writes, hidden fields stay hidden", async () => {
  const { owner, ana, campaignId, hero, ogre } = await rulesRoom("Fields");
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ben-Fields") } });
  await ben.until(() => true);
  const set = (actorId: string, field: string, value: number | string | string[] | null) =>
    ({ type: "field.set", actorId, field, value }) as const;

  // The owner writes their own `owner` fields; `gm` fields and other characters are the GM's.
  ok(await ana.send(set(hero, "diary", "Met a dragon")));
  refused(await ana.send(set(hero, "diary", "x".repeat(41))), /over the cap of 40/);
  refused(await ana.send(set(hero, "gmNote", "hm")), "gmOnly");
  refused(await ana.send(set(hero, "level", 4)), "gmOnly");
  refused(await ana.send(set(ogre, "level", 4)), "notYourCharacter");
  refused(await ana.send(set(hero, "nope", 1)), "noField");

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
  refused(await ana.send(add("dazed")), "noPermission");
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
  refused(await ana.send(roundEnd), "noPermission");
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
  refused(await ana.send({ type: "condition.remove", actorId: hero, condition: "marked" }), "noPermission");
  const bare = ok(await owner.send({ type: "actor.create", kind: "npc", name: "Bare" })).id!;
  refused(await owner.send({ ...add("dazed"), actorId: bare }), /isn't built for this ruleset/);
  for (const c of [owner, ana]) c.socket.close();
});

test("actor.rest and session boundaries run the engine's rest primitive", async () => {
  const { owner, ana, hero, ogre } = await rulesRoom("Rest");
  const rest = (event: string, actorId?: string) => ({ type: "actor.rest", event, actorId }) as const;
  ok(await owner.send(hpStep(hero, "hp", -9)));
  ok(await owner.send(hpStep(ogre, "hp", -7)));
  await resourceOf(owner, hero, "hp", 5);

  refused(await ana.send(rest("longRest")), "noPermission");
  refused(await owner.send(rest("nap")), /No rest called "nap"/);
  refused(await owner.send(rest("longRest", crypto.randomUUID())), "unknownActor");
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
  refused(await owner.send({ type: "event.undo" }), "noSessionRunning");
  ok(await owner.send({ type: "session.start" }));
  refused(await owner.send({ type: "event.undo" }), /Nothing to undo/);

  // Two hits come back newest first: the second (2), then the first (3).
  const hit1 = ok(await owner.send(hpStep(hero, "hp", -3))).id!;
  const hit2 = ok(await owner.send(hpStep(hero, "hp", -2))).id!;
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
  ok(await owner.send(hpStep(hero, "hp", -1)));
  ok(await owner.send(hpStep(ogre, "hp", -2)));
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
  ok(await owner.send(hpStep(hero, "hp", -1)));
  refused(await ana.send({ type: "event.undo" }), "noPermission");
  const cogm = async (name: string, scopes: ("combat" | "session")[]) => {
    const code = ok(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false })).token!;
    const token = await device(name);
    assert.equal((await post(`/invites/${code}/accept`, {}, cookieOf(token))).status, 200);
    ok(await owner.send({ type: "member.appoint", userId: uid(name), role: "cogm", scopes }));
    const c = connect({ auth: { campaignId, cookie: token } });
    await c.until(() => true);
    return c;
  };
  const session = await cogm("co-session-Undo", ["session"]);
  refused(await session.send({ type: "event.undo" }), "noPermission");
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
  refused(await session.send(damage), "noPermission");
  refused(await ana.send(damage), "noPermission");
  ok(await combat.send({ type: "event.undo" }));
  await resourceOf(owner, hero, "hp", 14);

  // Ended session: nothing left to undo.
  ok(await owner.send({ type: "session.end" }));
  refused(await owner.send({ type: "event.undo" }), "noSessionRunning");

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

// ---- Tests called by the GM: the dice stay physical, the server resolves them (docs/design.md §6.3) ----------------

// Every number anywhere in a payload, so a hidden target is looked for by value, not in ids or dates.
const numbersIn = (v: unknown): number[] =>
  typeof v === "number" ? [v] : v !== null && typeof v === "object" ? Object.values(v).flatMap(numbersIn) : [];

const DN = 23; // far from any roll below, so a leak is found by value
const callIn = (s: LiveState, id: string) => s.tests.find((t) => t.id === id);
const report = (callId: string, actorId: string, faces: number[], advantage = "none") =>
  ({ type: "test.report", callId, actorId, advantage, roll: { kind: "faces", faces } }) as ActionInput;

// A room with the fixture ruleset, a running session, Ana holding Lyra and Ben holding Bram. Every socket counts against
// the api's connect limit (60 a minute per IP), so a test opens only the ones it reads.
async function testRoom(name: string) {
  const { owner, ana, campaignId, hero, ogre } = await rulesRoom(name);
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, `ben-${name}`) } });
  const members = (await owner.until((s) => s.access.members.some((m) => m.userId === uid(`ben-${name}`)))).access;
  const bram = members.members.find((m) => m.userId === uid(`ben-${name}`))!.characterIds[0]!;
  await equip(bram, "character", {
    fields: { level: 1, "attr.con": 10, "attr.dex": 14, diary: "" },
    resources: { hp: 8, focus: 1 },
  });
  ok(await owner.send({ type: "actor.rename", id: bram, name: "Bram" }));
  await ben.until((s) => s.actors.find((a) => a.id === bram)?.entity === "character");
  // The snapshot carries the open calls and the running session's closed ones.
  ok(await owner.send({ type: "session.start" }));
  const call = (over: Record<string, unknown> = {}) =>
    ({
      type: "test.call",
      testId: "check",
      actorIds: [hero, bram],
      inputs: { ability: "dex", dc: DN },
      hideTarget: true,
      ...over,
    }) as ActionInput;
  return { owner, ana, ben, campaignId, hero, bram, ogre, call };
}

async function coGm({
  owner,
  campaignId,
  name,
  scopes,
}: {
  owner: ReturnType<typeof connect>;
  campaignId: string;
  name: string;
  scopes: ("combat" | "session" | "codex")[];
}) {
  const code = ok(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false })).token!;
  const token = await device(name);
  assert.equal((await post(`/invites/${code}/accept`, {}, cookieOf(token))).status, 200);
  ok(await owner.send({ type: "member.appoint", userId: uid(name), role: "cogm", scopes }));
  const c = connect({ auth: { campaignId, cookie: token } });
  await c.until(() => true);
  return c;
}

test("test.call / test.report / test.close: a hidden target stays on the GM side, the server resolves the roll", async () => {
  const { owner, ana, ben, campaignId, hero, bram, call } = await testRoom("TestReport");
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const combat = await coGm({ owner, campaignId, name: "co-combat-TestReport", scopes: ["combat"] });

  // Who may call: the GM and a co-GM with the session scope. The call is checked against the pinned ruleset.
  refused(await ana.send(call({ actorIds: [hero] })), "noPermission");
  refused(await screen.send(call()), "screenReadOnly");
  refused(await combat.send(call()), "noPermission");
  refused(await owner.send(call({ testId: "nope" })), /No Test "nope"/);
  refused(await owner.send(call({ inputs: { ability: "dex" } })), /dc/);
  refused(await owner.send(call({ inputs: { ability: "dex", dc: "hard" } })), /whole number/);
  refused(await owner.send(call({ inputs: { ability: "dex", dc: 5, extra: 1 } })), /extra/);
  refused(await owner.send(call({ inputs: { ability: "2", dc: 5 } })), /ability: pick one of str, dex/);
  refused(await owner.send(call({ inputs: { ability: "wis", dc: 5 } })), /Lyra/); // no such score
  refused(await owner.send(call({ actorIds: [crypto.randomUUID()] })), "characterNotFound");
  refused(await owner.send(call({ actorIds: [] })), /too small|at least|Invalid/i);
  const bare = ok(await owner.send({ type: "actor.create", kind: "npc", name: "Bare" })).id!;
  refused(await owner.send(call({ actorIds: [bare] })), /isn't built/);
  const session = await coGm({ owner, campaignId, name: "co-session-TestReport", scopes: ["session"] });
  ok(await session.send({ type: "test.close", callId: ok(await session.send(call({ actorIds: [hero] }))).id! }));
  session.socket.close();

  // The GM calls two characters with a hidden target.
  const id = ok(await owner.send(call())).id!;
  const gm = callIn(await owner.until((s) => callIn(s, id) !== undefined), id)!;
  assert.equal(gm.status, "open");
  const byActor = (c: typeof gm) => Object.fromEntries(c.targets.map((t) => [t.actorId, t]));
  assert.deepEqual([byActor(gm)[hero]?.modifier, byActor(gm)[hero]?.target], [1, DN]);
  assert.deepEqual([byActor(gm)[bram]?.modifier, byActor(gm)[bram]?.target], [2, DN]);
  assert.deepEqual(gm.secretInputs, ["dc"]);
  assert.deepEqual((await owner.until(() => true)).testDefs.map((d) => d.id).toSorted(), ["check", "skill"]);

  // Each seat gets its own copy: a player only their own character, never the target number or the dc input.
  const anaState = await ana.until((s) => callIn(s, id) !== undefined);
  const anaCall = callIn(anaState, id)!;
  assert.deepEqual(anaCall.targets, [{ actorId: hero, modifier: 1, target: null, pool: null, report: null }]);
  assert.deepEqual(anaCall.inputs, { ability: "dex" });
  assert.deepEqual(anaState.testDefs, []);
  assert.ok(!numbersIn(anaState.tests).includes(DN), "the target number is nowhere in the player's state");
  const tv = callIn(await screen.until((s) => callIn(s, id) !== undefined), id)!;
  assert.deepEqual([tv.called, tv.reported, tv.targets], [2, 0, []]);
  assert.ok(!numbersIn((await screen.until(() => true)).tests).includes(DN));
  assert.equal(callIn(await combat.until(() => true), id), undefined, "a co-GM without the scope sees no call");

  // A player reports the physical roll for their own character, never for another's; a bad roll is refused.
  refused(await ana.send(report(id, bram, [12])), "notYourCharacter");
  refused(await ana.send(report(id, hero, [21])), /d20 rolls/);
  refused(await ana.send(report(id, hero, [4, 5])), /expected 1 face/);
  refused(await ana.send(report(id, hero, [4], "lucky")), /advantage, disadvantage or none/);
  refused(await ana.send(report(crypto.randomUUID(), hero, [4])), /isn't at this table/);
  ok(await ana.send(report(id, hero, [13])));

  // The server computed the outcome (13 + 1 against 23 fails); Ana is not told it, the GM is.
  const gmAfter = callIn(await owner.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.deepEqual(byActor(gmAfter)[hero]?.report, {
    natural: 13,
    total: 14,
    outcome: "failure",
    margin: null,
    shifts: null,
    flags: [],
  });
  const anaAfter = callIn(await ana.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.deepEqual(anaAfter.targets[0]?.report, {
    natural: 13,
    total: 14,
    outcome: null,
    margin: null,
    shifts: null,
    flags: [],
  });
  assert.ok(!numbersIn((await ana.until(() => true)).tests).includes(DN));
  refused(await ana.send(report(id, hero, [20])), /Already reported/);
  const stored = (a: string) =>
    query<{ outcome: string; reported_by_role: string }>(
      "SELECT outcome, reported_by_role FROM test_report WHERE call_id = $1 AND actor_id = $2",
      [id, a],
    );
  assert.deepEqual(await stored(hero), [{ outcome: "failure", reported_by_role: "player" }]);

  // The GM side reports for anyone and may correct one: a natural 20 is critical, then Bram's 19 + 2 fails.
  ok(await owner.send(report(id, bram, [20])));
  const crit = callIn(await owner.until((s) => callIn(s, id)?.reported === 2), id)!;
  assert.equal(byActor(crit)[bram]?.report?.outcome, "critical");
  ok(await owner.send(report(id, bram, [19])));
  const fixed = callIn(await owner.until((s) => byActor(callIn(s, id)!)[bram]?.report?.natural === 19), id)!;
  assert.deepEqual(byActor(fixed)[bram]?.report, {
    natural: 19,
    total: 21,
    outcome: "failure",
    margin: null,
    shifts: null,
    flags: [],
  });
  assert.deepEqual(await stored(bram), [{ outcome: "failure", reported_by_role: "gm" }]);

  // Closing is the GM side's; nothing more is reported afterwards, and Ana is still not shown Bram's result.
  refused(await ana.send({ type: "test.close", callId: id }), "noPermission");
  refused(await combat.send({ type: "test.close", callId: id }), "noPermission");
  ok(await owner.send({ type: "test.close", callId: id }));
  refused(await owner.send({ type: "test.close", callId: id }), /closed/);
  refused(await owner.send(report(id, hero, [5])), /closed/);
  const closed = callIn(await ana.until((s) => callIn(s, id)?.status === "closed"), id)!;
  assert.deepEqual(
    closed.targets.map((t) => [t.actorId, t.report?.outcome]),
    [[hero, null]],
  );
  assert.deepEqual((await screen.until(() => true)).tests, [], "the TV shows only what is open");
  for (const c of [owner, ana, ben, screen, combat]) c.socket.close();
});

test("a Test can tell the called players pass or fail, show its target, or reveal every result when closed", async () => {
  const { owner, ana, ben, campaignId, hero, bram, call } = await testRoom("TestShow");

  // showOutcome: the outcome without the number.
  const id = ok(await owner.send(call({ showOutcome: true }))).id!;
  ok(await ana.send(report(id, hero, [12])));
  ok(await ben.send(report(id, bram, [3])));
  const told = callIn(await ana.until((s) => callIn(s, id)?.targets[0]?.report?.outcome === "failure"), id)!;
  assert.deepEqual(told.targets[0]?.report, {
    natural: 12,
    total: 13,
    outcome: "failure",
    margin: null,
    shifts: null,
    flags: [],
  });
  assert.ok(!numbersIn((await ana.until(() => true)).tests).includes(DN));

  // Revealing on close: the other character's outcome and die, never their modifier, total or the target.
  assert.equal(callIn(await ana.until(() => true), id)?.targets.length, 1);
  ok(await owner.send({ type: "test.close", callId: id, reveal: true }));
  const revealed = callIn(await ana.until((s) => callIn(s, id)?.revealed === true), id)!;
  assert.deepEqual(revealed.targets.map((t) => t.actorId).toSorted(), [hero, bram].toSorted());
  const other = revealed.targets.find((t) => t.actorId === bram)!;
  assert.deepEqual(other, {
    actorId: bram,
    modifier: null,
    target: null,
    pool: null,
    report: { natural: 3, total: null, outcome: "failure", margin: null, shifts: null, flags: [] },
  });
  assert.ok(!numbersIn((await ana.until(() => true)).tests).includes(DN));

  // A target the GM didn't hide is told to the called player, with its input.
  const shownId = ok(await owner.send(call({ hideTarget: false, actorIds: [hero] }))).id!;
  const shown = callIn(await ana.until((s) => callIn(s, shownId) !== undefined), shownId)!;
  assert.equal(shown.targets[0]?.target, DN);
  assert.equal(shown.inputs.dc, DN);
  assert.equal(shown.showOutcome, true, "a shown target gives the outcome away, so it is shown");

  // The session log keeps the story for the recap, GM side only; it has no Test steps for undo to take back.
  const log = await query<{ type: string; seat_user_id: string | null; session_id: string | null }>(
    "SELECT type, seat_user_id, session_id FROM session_event WHERE campaign_id = $1 AND type LIKE 'test.%' ORDER BY created_at, id",
    [campaignId],
  );
  assert.deepEqual(
    log.map((e) => [e.type, e.seat_user_id]),
    [
      ["test.call", uid("owner-TestShow")],
      ["test.report", uid("ana-TestShow")],
      ["test.report", uid("ben-TestShow")],
      ["test.close", uid("owner-TestShow")],
      ["test.call", uid("owner-TestShow")],
    ],
  );
  assert.ok(log.every((e) => e.session_id !== null));
  refused(await owner.send({ type: "event.undo" }), /Nothing to undo/);
  for (const c of [owner, ana, ben]) c.socket.close();
});

test("a Dice pool Test: the pool is set at the call, the server counts the report, the number stays hidden", async () => {
  const { owner, ana, ben, campaignId, hero, bram, call } = await testRoom("TestPool");
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const DN_POOL = 3;
  const poolCall = (over: Record<string, unknown> = {}) =>
    call({ testId: "skill", inputs: { dn: DN_POOL, bonus: 0 }, ...over });
  const poolReport = (
    callId: string,
    actorId: string,
    counts: Record<string, number>,
    special: number[],
    advantage = "none",
  ) =>
    ({
      type: "test.report",
      callId,
      actorId,
      advantage,
      roll: { kind: "pool", counts, special },
    }) as ActionInput;

  // The ruleset's Tests as the GM's form reads them: the Dice pool carries what the phone needs.
  const defs = (await owner.until(() => true)).testDefs;
  assert.deepEqual(defs.map((d) => d.id).toSorted(), ["check", "skill"]);
  assert.equal(defs.find((d) => d.id === "skill")?.pool?.special?.count, 1);
  refused(await owner.send(poolCall({ inputs: { dn: DN_POOL } })), /bonus/);

  // Lyra's Grit 14 gives 3 dice, Bram's 10 gives 2; the call's modifier adds or removes dice, down to none.
  const id = ok(await owner.send(poolCall())).id!;
  const gm = callIn(await owner.until((s) => callIn(s, id) !== undefined), id)!;
  const byActor = (c: typeof gm) => Object.fromEntries(c.targets.map((t) => [t.actorId, t]));
  assert.deepEqual([byActor(gm)[hero]?.pool, byActor(gm)[bram]?.pool], [3, 2]);
  assert.deepEqual(
    gm.pool?.bands.map((b) => [b.id, b.worth]),
    [
      ["top", 2],
      ["hit", 1],
    ],
  );
  const sized = ok(await owner.send(poolCall({ inputs: { dn: DN_POOL, bonus: 2 }, actorIds: [hero] }))).id!;
  const bonus = callIn(await owner.until((s) => callIn(s, sized) !== undefined), sized)!;
  assert.equal(bonus.targets[0]?.pool, 5);
  const fewer = ok(await owner.send(poolCall({ inputs: { dn: DN_POOL, bonus: -9 }, actorIds: [hero] }))).id!;
  assert.equal(callIn(await owner.until((s) => callIn(s, fewer) !== undefined), fewer)!.targets[0]?.pool, 0);

  // The phone's copy: the pool size and the bands, never the difficulty number.
  const anaCall = callIn(await ana.until((s) => callIn(s, id) !== undefined), id)!;
  assert.deepEqual([anaCall.targets[0]?.pool, anaCall.targets[0]?.target], [3, null]);
  assert.equal(anaCall.pool?.die, 8);
  assert.ok(!JSON.stringify(anaCall.inputs).includes("dn"), "the dn input is hidden with the number");

  // An impossible report is refused with a reason, and a sum report or a pool report on the wrong Test too.
  refused(await ana.send(poolReport(id, bram, { top: 1 }, [4])), "notYourCharacter");
  refused(await ana.send(poolReport(id, hero, { top: 3 }, [4])), /4 dice counted, but the pool is 3/);
  refused(await ana.send(poolReport(id, hero, { top: -1 }, [4])), /can't be negative/);
  refused(await ana.send(poolReport(id, hero, { gold: 1 }, [4])), /no scoring band "gold"/);
  refused(await ana.send(poolReport(id, hero, { top: 1 }, [])), /expected 1 special die/);
  refused(await ana.send(poolReport(id, hero, { top: 1 }, [9])), /a d8 rolls 1–8/);
  refused(await ana.send(report(id, hero, [4])), /./); // faces are for a sum Test
  refused(await ana.send(poolReport(id, hero, { top: 1 }, [4], "advantage")), /no advantage/);

  // Lyra counts a top face, a scoring face and an Omen 8: 2 + 1 + 2 = 5 against 3. Margin 2, one shift, a critical.
  ok(await ana.send(poolReport(id, hero, { top: 1, hit: 1 }, [8])));
  const gmAfter = callIn(await owner.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.deepEqual(byActor(gmAfter)[hero]?.report, {
    natural: null,
    total: 5,
    outcome: "success",
    margin: 2,
    shifts: 1,
    flags: ["critical"],
  });
  // Ana is told her score and flags, not pass or fail, the margin or the shifts: those would give the number away.
  const anaAfter = callIn(await ana.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.deepEqual(anaAfter.targets[0]?.report, {
    natural: null,
    total: 5,
    outcome: null,
    margin: null,
    shifts: null,
    flags: ["critical"],
  });
  const tv = callIn(await screen.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.deepEqual([tv.called, tv.reported, tv.targets, tv.pool?.die], [2, 1, [], 8]);

  // Bram, a complication on an empty count: fails by 3 (0 against 3), no shift.
  ok(await owner.send(poolReport(id, bram, {}, [1])));
  const failed = byActor(callIn(await owner.until((s) => callIn(s, id)?.reported === 2), id)!)[bram]?.report;
  assert.deepEqual(
    [failed?.total, failed?.outcome, failed?.margin, failed?.shifts, failed?.flags],
    [0, "failure", -3, 0, ["complication"]],
  );
  const stored = await query<Record<string, unknown>>(
    "SELECT outcome, total, margin, shifts, flags, band_counts, special_faces FROM test_report WHERE call_id = $1 AND actor_id = $2",
    [id, hero],
  );
  assert.deepEqual(stored, [
    {
      outcome: "success",
      total: 5,
      margin: 2,
      shifts: 1,
      flags: ["critical"],
      band_counts: { top: 1, hit: 1 },
      special_faces: [8],
    },
  ]);

  // Revealing on close tells Ana the margin and the shifts, and Ben his character's.
  ok(await owner.send({ type: "test.close", callId: id, reveal: true }));
  const revealed = callIn(await ana.until((s) => callIn(s, id)?.revealed === true), id)!;
  assert.deepEqual(
    [
      revealed.targets.find((t) => t.actorId === hero)?.report?.margin,
      revealed.targets.find((t) => t.actorId === hero)?.report?.shifts,
    ],
    [2, 1],
  );
  assert.equal(revealed.targets.find((t) => t.actorId === bram)?.report?.margin, -3);
  assert.equal(
    revealed.targets.find((t) => t.actorId === bram)?.report?.total,
    null,
    "another character's score stays",
  );
  for (const c of [owner, ana, ben, screen]) c.socket.close();
});

// ---- The builder, creatures from packs and builder drafts (docs/p1-plan.md workstream D) ---------------------------
// The sample ruleset, with the level asked in the last creation step so derived values can be computed, and the sample
// pack with one lineage that only the GM side may pick.

const BUILD_RULESET = structuredClone(SAMPLE_D20);
const identity = BUILD_RULESET.creation?.find((s) => s.id === "identity");
if (identity?.kind === "fields") identity.fields = ["name", "level"];
const BUILD_PACK = structuredClone(SAMPLE_PACK);
BUILD_PACK.entries.push({
  key: "hidden-kin",
  type: "lineage",
  name: "Hidden Kin",
  cite: "Sample p.10",
  visibility: "gm",
  body: { size: "medium", blurb: "Only the GM side may pick this." },
});
const GOOD_ANSWERS = {
  lineage: ["reedfolk"],
  calling: ["wayfinder"],
  scores: { "attr.str": 12, "attr.dex": 9, "attr.con": 15 },
  identity: { name: "Lyra", level: 3 },
};

async function buildRoom(name: string) {
  const ownerDevice = await device(`owner-${name}`);
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", BUILD_RULESET);
  const pk = await me.post<PackReply>("/packs", BUILD_PACK);
  const other = await me.post<PackReply>("/packs", { ...BUILD_PACK, id: "sample-other" });
  assert.deepEqual([rs.status, pk.status, other.status], [201, 201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", { name, rulesetVersionId: rs.body.versionId });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const player = async (who: string) => {
    const c = connect({ auth: { campaignId, cookie: await seatPlayer(owner, `${who}-${name}`) } });
    const s = await owner.until((x) => x.access.members.some((m) => m.userId === uid(`${who}-${name}`)));
    const held = s.access.members.find((m) => m.userId === uid(`${who}-${name}`))!.characterIds[0]!;
    await c.until((x) => x.actors.some((a) => a.id === held));
    return { c, held };
  };
  const [ana, ben] = [await player("ana"), await player("ben")];
  return { owner, ana, ben, campaignId, packVersionId: pk.body.versionId, otherVersionId: other.body.versionId };
}

test("actor.create: a typed actor needs a ruleset and one of its actor entities", async () => {
  const bare = await newRoom("TypedBare");
  refused(await bare.owner.send({ type: "actor.create", name: "Kay", entityType: "character" }), /no ruleset/);
  bare.owner.socket.close();

  const { owner, ana } = await buildRoom("Typed");
  refused(await owner.send({ type: "actor.create", name: "Kay", entityType: "dragon" }), /no "dragon"/);
  refused(await owner.send({ type: "actor.create", name: "Kay", entityType: "lineage" }), /no "lineage"/); // not an actor
  refused(await ana.c.send({ type: "actor.create", name: "Kay", entityType: "character" }), "noPermission");
  const id = ok(await owner.send({ type: "actor.create", kind: "pc", name: "Kay", entityType: "character" })).id!;
  const s = await owner.until((x) => x.actors.some((a) => a.id === id));
  assert.equal(actorIn(s, id)?.entity, "character");
  for (const c of [owner, ana.c]) c.socket.close();
});

test("actor.build: the server runs the creation, writes the values, and refuses what isn't allowed", async () => {
  const { owner, ana, ben, campaignId } = await buildRoom("Build");
  const mine = ana.held;
  const build = (answers: Record<string, unknown>, actorId = mine) =>
    ({ type: "actor.build", actorId, answers }) as const;

  // Someone else's character, a gm entry picked by a player, and answers that break the creation (by step path).
  refused(await ben.c.send(build(GOOD_ANSWERS)), "notYourCharacter");
  refused(
    await ana.c.send(build({ ...GOOD_ANSWERS, lineage: ["hidden-kin"] })),
    /lineage\[0\]: no lineage "hidden-kin"/,
  );
  refused(
    await ana.c.send(build({ ...GOOD_ANSWERS, scores: { "attr.str": 15, "attr.dex": 15, "attr.con": 9 } })),
    /scores\.attr\.dex: 15 is not left in the table/,
  );
  refused(await ana.c.send(build({ ...GOOD_ANSWERS, identity: { name: "Lyra", level: 99 } })), /identity\.level/);
  refused(await ana.c.send(build({ lineage: ["reedfolk"] })), /calling: this step needs an answer/);
  refused(await ana.c.send(build({ ...GOOD_ANSWERS, bogus: 1 })), /bogus: no such step/);
  const none = await query("SELECT 1 FROM actor_field WHERE actor_id = $1", [mine]);
  assert.equal(none.length, 0); // nothing was written by the refusals

  // The same pick is fine for the GM side (a gm entry is theirs to choose).
  const pregen = ok(
    await owner.send({ type: "actor.create", kind: "pc", name: "Pregen", entityType: "character" }),
  ).id!;
  ok(
    await owner.send(build({ ...GOOD_ANSWERS, lineage: ["hidden-kin"], identity: { name: "Mara", level: 2 } }, pregen)),
  );

  // The player builds their own character; derived values appear in the owner's view and the GM's.
  ok(await ana.c.send(build(GOOD_ANSWERS)));
  const maxHp = 6 + 2 + (3 - 1) * 4; // base 6 + mod(15) + (level - 1) * 4
  const seen = (s: LiveState) => actorIn(s, mine)?.derived.maxHp === maxHp;
  for (const s of [await ana.c.until(seen), await owner.until(seen)]) {
    const a = actorIn(s, mine)!;
    assert.equal(a.name, "Lyra"); // the name step names the actor
    assert.equal(a.entity, "character");
    assert.equal(a.fields["attr.con"], 15);
    assert.equal(a.fields.guard, 3); // copied from the calling
    assert.equal(a.resources.hp, maxHp); // starts full
  }
  assert.equal(actorIn(await ben.c.until(seen), mine)?.derived.maxHp, maxHp); // the party sees it too
  const chosen = await query<{ step_id: string; option_key: string }>(
    "SELECT step_id, option_key FROM actor_choice WHERE actor_id = $1 ORDER BY step_id",
    [mine],
  );
  assert.deepEqual(
    chosen.map((c) => `${c.step_id}:${c.option_key}`),
    ["calling:wayfinder", "lineage:reedfolk"],
  );
  const logged = await query("SELECT 1 FROM session_event WHERE campaign_id = $1 AND type = 'delta'", [campaignId]);
  assert.ok(logged.length >= 2); // written as deltas, in the log like any other

  refused(await ana.c.send(build(GOOD_ANSWERS)), /Already built/);
  for (const c of [owner, ana.c, ben.c]) c.socket.close();
});

test("builder drafts: only their owner is sent one, a good build deletes it, and the size is capped", async () => {
  const { owner, ana, ben, campaignId } = await buildRoom("Draft");
  const body = { actorId: ana.held, answers: { lineage: ["reedfolk"] } };
  ok(await ana.c.send({ type: "draft.save", body }));
  const got = await ana.c.until((s) => s.myDraft !== null);
  assert.deepEqual(got.myDraft, body);
  // Everyone else keeps getting null, whatever is broadcast after.
  ok(await owner.send({ type: "actor.rename", id: ana.held, name: "Lyra" }));
  assert.equal((await ben.c.until((s) => s.actors.some((a) => a.name === "Lyra"))).myDraft, null);
  assert.equal((await owner.until((s) => s.actors.some((a) => a.name === "Lyra"))).myDraft, null);

  refused(await ben.c.send({ type: "draft.save", body }), "notYourCharacter"); // not his to build
  refused(await ana.c.send({ type: "draft.save", body: { ...body, answers: { big: "x".repeat(70_000) } } }), /64 KB/);

  // A draft is one per user: saving again replaces it, discarding removes it.
  const more = { ...body, answers: { lineage: ["reedfolk"], calling: ["wayfinder"] } };
  ok(await ana.c.send({ type: "draft.save", body: more }));
  await ana.c.until((s) => Object.keys(s.myDraft?.answers ?? {}).length === 2);
  ok(await ana.c.send({ type: "draft.discard" }));
  await ana.c.until((s) => s.myDraft === null);

  ok(await ana.c.send({ type: "draft.save", body }));
  await ana.c.until((s) => s.myDraft !== null);
  ok(await ana.c.send({ type: "actor.build", actorId: ana.held, answers: GOOD_ANSWERS }));
  await ana.c.until((s) => s.myDraft === null);
  assert.equal((await query("SELECT 1 FROM builder_draft WHERE campaign_id = $1", [campaignId])).length, 0);
  for (const c of [owner, ana.c, ben.c]) c.socket.close();
});

test("actor.spawn: the GM places numbered creatures from an attached pack, as rows, and nobody else may", async () => {
  const { owner, ana, ben, campaignId, packVersionId, otherVersionId } = await buildRoom("Spawn");
  const spawn = (over: Record<string, unknown> = {}) =>
    ({ type: "actor.spawn", packVersionId, key: "ember-wisp", count: 3, temporary: true, ...over }) as ActionInput;

  refused(await ana.c.send(spawn()), "noPermission");
  refused(await owner.send(spawn({ packVersionId: otherVersionId })), /isn't in a pack attached/);
  refused(await owner.send(spawn({ packVersionId: crypto.randomUUID() })), /isn't in a pack attached/);
  refused(await owner.send(spawn({ key: "nope" })), /isn't in a pack attached/);
  refused(await owner.send(spawn({ key: "coil-rope" })), /takes a place at the table/); // gear isn't an actor
  refused(await owner.send(spawn({ count: 21 })), /too big|<=20|20/);
  refused(await owner.send(spawn({ count: 0 })), /too small|>=1|1/);

  ok(await owner.send(spawn()));
  const s = await owner.until((x) => x.actors.filter((a) => a.kind === "creature").length === 3);
  const wisps = s.actors.filter((a) => a.kind === "creature");
  assert.deepEqual(wisps.map((a) => a.name).sort(), ["Ember Wisp 1", "Ember Wisp 2", "Ember Wisp 3"]);
  for (const w of wisps) {
    assert.equal(w.entity, "creature");
    assert.equal(w.fields["attr.dex"], 14); // the pack entry's body, as rows
    assert.equal(w.derived.maxHp, 7); // 4 + max(0, mod 8) * 2 + level 1 * 3
    assert.equal(w.resources.hp, 7);
  }
  const rows = await query<{ n: number; temporary: boolean }>(
    "SELECT count(*)::int AS n, bool_and(temporary) AS temporary FROM actor WHERE campaign_id = $1 AND kind = 'creature'",
    [campaignId],
  );
  assert.deepEqual(rows[0], { n: 3, temporary: true });
  const fieldRows = await query(
    "SELECT 1 FROM actor_field f JOIN actor a ON a.id = f.actor_id WHERE a.campaign_id = $1 AND a.kind = 'creature'",
    [campaignId],
  );
  assert.equal(fieldRows.length, 3 * 6); // name, level, three scores and guard

  // More of the same continue the numbering; the party keeps not seeing creatures.
  ok(await owner.send(spawn({ count: 2, temporary: false })));
  const next = await owner.until((x) => x.actors.filter((a) => a.kind === "creature").length === 5);
  assert.deepEqual(
    next.actors
      .filter((a) => a.kind === "creature")
      .map((a) => a.name)
      .sort()
      .slice(3),
    ["Ember Wisp 4", "Ember Wisp 5"],
  );
  assert.equal(
    (await ana.c.until(() => true)).actors.some((a) => a.kind === "creature"),
    false,
  );
  for (const c of [owner, ana.c, ben.c]) c.socket.close();
});

// ---- The combat tracker (docs/p1-plan.md workstream F) ----------------------------------------------------------

// Spare Vigour clears at the end of a fight, so the closing rest can be seen. Applies to every test using this ruleset.
const spare = BUILD_RULESET.resources?.find((r) => r.id === "tempHp");
if (spare) spare.resetOn = [{ event: "encounterEnd", to: "min" }];

test("encounter: a full round of turns, seat views, undo of a turn, and the end of the fight", async () => {
  const { owner, ana, ben, campaignId, packVersionId } = await buildRoom("Track");
  const cc = await coGm({ owner, campaignId, name: "co-combat-Track", scopes: ["combat"] });
  const pregen = ok(
    await owner.send({ type: "actor.create", kind: "pc", name: "Pregen", entityType: "character" }),
  ).id!;
  for (const [c, held] of [
    [ana.c, ana.held],
    [ben.c, ben.held],
    [owner, pregen],
  ] as const)
    ok(await c.send({ type: "actor.build", actorId: held, answers: GOOD_ANSWERS }));
  const [pcA, pcB, pcC] = [ana.held, ben.held, pregen];
  await owner.until((s) => [pcA, pcB, pcC].every((id) => actorIn(s, id)?.resources.hp === 16));

  // Start: a session first, the combat side only, once.
  refused(await owner.send({ type: "encounter.start" }), /Start a session first/);
  ok(await owner.send({ type: "session.start" }));
  refused(await ana.c.send({ type: "encounter.start" }), "noPermission");
  refused(await owner.send({ type: "turn.next" }), /No encounter is running/);
  ok(await owner.send({ type: "encounter.start" }));
  refused(await cc.send({ type: "encounter.start" }), /already running/);

  // Three creatures spawned while the fight is on join it, hidden; the three characters are added from the party.
  ok(await owner.send({ type: "actor.spawn", packVersionId, key: "ember-wisp", count: 3, temporary: true }));
  const spawned = await owner.until((s) => s.encounter?.combatants.length === 3);
  assert.ok(spawned.encounter?.combatants.every((c) => c.side === "foe" && c.visibility === "hidden"));
  refused(await ana.c.send({ type: "encounter.add", actorIds: [pcA], side: "party" }), "noPermission");
  refused(
    await owner.send({ type: "encounter.add", actorIds: [crypto.randomUUID()], side: "party" }),
    "characterNotFound",
  );
  ok(await owner.send({ type: "encounter.add", actorIds: [pcA, pcB, pcC], side: "party", visibility: "full" }));
  refused(await owner.send({ type: "encounter.add", actorIds: [pcA], side: "party" }), /already in the fight/);
  const all = await owner.until((s) => s.encounter?.combatants.length === 6);
  const cb = (s: LiveState, actorId: string) => s.encounter!.combatants.find((c) => c.actorId === actorId)!;
  const wisps = all.actors.filter((a) => a.kind === "creature").sort((x, y) => x.name.localeCompare(y.name));
  const [w1, w2, w3] = wisps.map((w) => w.id) as [string, string, string];

  // The GM types every initiative (nothing rolls); a tie is settled by moving one place, and only among equals.
  for (const [id, score] of [
    [pcA, 18],
    [w1, 15],
    [pcB, 12],
    [w2, 12],
    [pcC, 9],
    [w3, 5],
  ] as const)
    ok(await owner.send({ type: "encounter.setInitiative", combatantId: cb(all, id).id, score }));
  const ranked = await owner.until((s) => s.encounter?.combatants.every((c) => c.initiative !== null) === true);
  const ids = (s: LiveState) => s.encounter!.combatants.map((c) => c.actorId);
  assert.deepEqual(ids(ranked), [pcA, w1, pcB, w2, pcC, w3]); // a tie keeps the place it came in
  refused(
    await owner.send({ type: "encounter.move", combatantId: cb(ranked, pcC).id, direction: "up" }),
    /same initiative/,
  );
  ok(await owner.send({ type: "encounter.move", combatantId: cb(ranked, pcB).id, direction: "down" }));
  const order = [pcA, w1, w2, pcB, pcC, w3];
  await owner.until((s) => ids(s).join() === order.join());

  // What the table may see: w1 a bar, w2 the numbers, w3 nothing; the GM keeps w2.
  ok(await owner.send({ type: "encounter.setVisibility", combatantId: cb(ranked, w1).id, visibility: "bar" }));
  ok(await owner.send({ type: "encounter.setVisibility", combatantId: cb(ranked, w2).id, visibility: "full" }));
  ok(await owner.send({ type: "encounter.keep", combatantId: cb(ranked, w2).id, keep: true }));

  // Timed conditions: Staggered (ends with its holder's turn) on A for two turns, Dazed (round end) on w1, Braced
  // (fight end) on B, and spare Vigour on A for the closing rest to clear.
  ok(await owner.send({ type: "condition.add", actorId: pcA, condition: "staggered", expiresAfter: 2 }));
  ok(await owner.send({ type: "condition.add", actorId: w1, condition: "dazed", expiresAfter: 1 }));
  ok(await owner.send({ type: "condition.add", actorId: pcB, condition: "braced" }));
  ok(await owner.send(adjust(pcA, "tempHp", 3)));

  // One round: the first turn starts at the top, each next passes the turn and ticks the finished holder's conditions.
  const turn = () => owner.send({ type: "turn.next" });
  const at = (s: LiveState) => s.encounter?.combatants.find((c) => c.id === s.encounter!.currentId)?.actorId;
  ok(await turn());
  assert.equal(at(await owner.until((s) => s.encounter?.currentId != null)), pcA);
  ok(await turn());
  const second = await owner.until((s) => at(s) === w1);
  assert.deepEqual(cb(second, pcA).conditions, [{ id: "staggered", left: 1, expiresOn: "ownTurnEnd" }]);
  assert.deepEqual(actorIn(second, pcA)?.conditionTimers, [
    { id: "staggered", expiresOn: "ownTurnEnd", expiresAfter: 1 },
  ]);
  for (const next of [w2, pcB, pcC, w3]) {
    ok(await turn());
    await owner.until((s) => at(s) === next);
  }
  const hasDazed = (s: LiveState) => cb(s, w1).conditions.some((c) => c.id === "dazed");
  assert.ok(hasDazed(await owner.until(() => true)));
  const wrap = ok(await turn()).id!;
  const round2 = await owner.until((s) => s.encounter?.round === 2);
  assert.equal(at(round2), pcA);
  assert.equal(hasDazed(round2), false, "the round-end condition ticked off at the wrap");

  // One undo takes the whole step back: the round, whose turn it is, and the condition.
  assert.equal(ok(await owner.send({ type: "event.undo" })).id, wrap);
  const back = await owner.until((s) => s.encounter?.round === 1);
  assert.equal(at(back), w3);
  assert.deepEqual(cb(back, w1).conditions, [{ id: "dazed", left: 1, expiresOn: "roundEnd" }]);
  ok(await turn());
  await owner.until((s) => s.encounter?.round === 2);
  ok(await owner.send({ type: "turn.prev" }));
  const prev = await owner.until((s) => s.encounter?.round === 1);
  assert.equal(at(prev), w3);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => s.encounter?.round === 2 && at(s) === pcA);

  // Damage from a co-GM who holds only the combat scope; a player can't.
  const hit = (actorId: string, amount: number) =>
    ({ type: "rule.op", primitive: "health.tracks", op: "damage", input: { actorId, amount } }) as const;
  refused(await ana.c.send(hit(w1, 3)), "noPermission");
  ok(await cc.send(hit(w1, 3)));
  ok(await cc.send(hit(w2, 2)));
  const hurt = await owner.until((s) => cb(s, w2).hp?.value === 5);
  assert.deepEqual(cb(hurt, w1).hp, { value: 4, max: 7 });

  // Seats: no hidden combatant at all, a bar without numbers, numbers where shown in full.
  const seen = await ana.c.until(
    (s) => s.encounter?.combatants.some((c) => c.actorId === w2 && c.hp?.value === 5) === true,
  );
  const enc = seen.encounter!;
  assert.equal(
    enc.combatants.some((c) => c.actorId === w3),
    false,
  );
  assert.equal(JSON.stringify(enc).includes("Ember Wisp 3"), false);
  assert.equal(enc.combatants.length, 5);
  const bar = enc.combatants.find((c) => c.actorId === w1)!;
  assert.equal(bar.hp, null);
  assert.ok(Math.abs((bar.bar ?? -1) - 4 / 7) < 1e-9);
  assert.deepEqual(enc.combatants.find((c) => c.actorId === w2)?.hp, { value: 5, max: 7 });
  assert.ok(enc.combatants.every((c) => c.conditions.length === 0 && !c.keep));
  assert.equal(enc.round, 2);
  assert.equal(enc.combatants.find((c) => c.id === enc.currentId)?.actorId, pcA); // A holds this turn: Ana's banner
  assert.equal((await ben.c.until((s) => s.encounter?.round === 2)).encounter?.combatants.length, 5);

  // The end: players can't; expiry and rest run for those who stay; non-kept temporary creatures go, the kept one stays.
  refused(await ana.c.send({ type: "encounter.end" }), "noPermission");
  const endId = ok(await owner.send({ type: "encounter.end" })).id!;
  const ended = await owner.until((s) => s.encounter === null);
  // House decision #15: expiry, then rest, all under the one returned action id, and nothing for the deleted creatures.
  const endRows = await query<{ payload: { target: Record<string, unknown>; kind: string } }>(
    "SELECT payload FROM session_event WHERE campaign_id = $1 AND action_id = $2 ORDER BY id",
    [campaignId, endId],
  );
  assert.deepEqual(
    endRows.map((r) => r.payload.target),
    [
      { actorId: pcB, condition: endRows[0]!.payload.target.condition },
      { actorId: pcA, resource: "tempHp" },
    ],
    "the expiry's write comes before the rest's, and only those who stay are touched",
  );
  assert.ok(endRows[0]!.payload.target.condition, "the condition delta targets the expired Braced row");
  assert.deepEqual(
    ended.actors.filter((a) => a.kind === "creature").map((a) => a.id),
    [w2],
  );
  assert.equal(actorIn(ended, pcA)?.resources.tempHp, 0, "the encounterEnd rest ran");
  assert.equal(actorIn(ended, pcB)?.conditions.includes("braced"), false, "the encounterEnd expiry ran");
  assert.equal(actorIn(ended, pcA)?.resources.hp, 16);
  assert.equal((await ana.c.until((s) => s.encounter === null)).encounter, null);
  refused(await owner.send({ type: "turn.next" }), /No encounter is running/);

  // Undo past the end: the end's own step comes back, then the hit on a creature that is gone is skipped and noted.
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => actorIn(s, pcB)?.conditions.includes("braced") === true);
  ok(await owner.send({ type: "event.undo" })); // the hit on w2, who stays
  ok(await owner.send({ type: "event.undo" }));
  const [undoEvent] = await query<{ payload: { skipped: { actorId?: string; reason: string }[] } }>(
    "SELECT payload FROM session_event WHERE campaign_id = $1 AND type = 'undo' ORDER BY created_at DESC, id DESC LIMIT 1",
    [campaignId],
  );
  assert.deepEqual(undoEvent?.payload.skipped, [{ actorId: w1, reason: "deleted" }]);
  for (const c of [owner, ana.c, ben.c, cc]) c.socket.close();
});

test("encounter: open between sessions it is paused, and the next session continues the same order", async () => {
  const { owner, ana, ben } = await buildRoom("Paused");
  for (const p of [ana, ben]) ok(await p.c.send({ type: "actor.build", actorId: p.held, answers: GOOD_ANSWERS }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [ana.held, ben.held], side: "party", visibility: "full" }));
  const added = await owner.until((s) => s.encounter?.combatants.length === 2);
  assert.equal(added.encounter?.paused, false);
  for (const [i, p] of [ana, ben].entries()) {
    const combatantId = added.encounter!.combatants.find((c) => c.actorId === p.held)!.id;
    ok(await owner.send({ type: "encounter.setInitiative", combatantId, score: 20 - i }));
  }
  ok(await owner.send({ type: "turn.next" }));
  const first = await owner.until((s) => s.encounter?.currentId != null);

  // Between sessions the fight stays open, but nothing in it moves, not even its end.
  ok(await owner.send({ type: "session.end" }));
  const paused = await ana.c.until((s) => s.encounter?.paused === true);
  assert.equal(paused.encounter?.combatants.length, 2);
  const combatantId = first.encounter!.currentId!;
  for (const action of [
    { type: "turn.next" },
    { type: "turn.prev" },
    { type: "encounter.end" },
    { type: "encounter.keep", combatantId, keep: true },
    { type: "rule.op", primitive: "initiative.ranked", op: "next", input: {} },
  ] as const)
    refused(await owner.send(action), /^Start a session to continue$/);
  refused(await owner.send({ type: "encounter.start" }), /Start a session first/);

  // A new session picks the same order up where it stopped.
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "turn.next" }));
  const moved = await owner.until((s) => s.encounter?.paused === false && s.encounter.currentId !== combatantId);
  assert.equal(moved.encounter?.combatants.length, 2);
  for (const c of [owner, ana.c, ben.c]) c.socket.close();
});

test("encounter: only the combat side runs it, undo moves past a combatant who left, other rooms' ids are refused", async () => {
  const { owner, ana, ben, campaignId } = await buildRoom("Guard");
  const other = await buildRoom("GuardB");
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await tv.until(() => true);
  for (const p of [ana, ben]) ok(await p.c.send({ type: "actor.build", actorId: p.held, answers: GOOD_ANSWERS }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [ana.held, ben.held], side: "party", visibility: "full" }));
  const added = await owner.until((s) => s.encounter?.combatants.length === 2);
  const byActor = (s: LiveState, id: string) => s.encounter!.combatants.find((c) => c.actorId === id)!;
  const [a, b] = [byActor(added, ana.held), byActor(added, ben.held)];
  ok(await owner.send({ type: "encounter.setInitiative", combatantId: a.id, score: 20 }));
  ok(await owner.send({ type: "encounter.setInitiative", combatantId: b.id, score: 10 }));

  // Every action of the tracker: a player is refused the permission, the TV is read-only.
  const all: ActionInput[] = [
    { type: "encounter.start" },
    { type: "encounter.end" },
    { type: "encounter.add", actorIds: [ana.held], side: "party" },
    { type: "encounter.remove", combatantId: a.id },
    { type: "encounter.setInitiative", combatantId: a.id, score: 1 },
    { type: "encounter.move", combatantId: a.id, direction: "down" },
    { type: "encounter.setVisibility", combatantId: a.id, visibility: "hidden" },
    { type: "encounter.keep", combatantId: a.id, keep: true },
    { type: "turn.next" },
    { type: "turn.prev" },
  ];
  for (const action of all) {
    refused(await ana.c.send(action), "noPermission");
    refused(await tv.send(action), "screenReadOnly");
  }

  // A combatant of another room is not in this fight.
  ok(await other.owner.send({ type: "session.start" }));
  ok(await other.owner.send({ type: "encounter.start" }));
  ok(await other.owner.send({ type: "encounter.add", actorIds: [other.ana.held], side: "party" }));
  const foreign = (await other.owner.until((s) => s.encounter?.combatants.length === 1)).encounter!.combatants[0]!.id;
  refused(await owner.send({ type: "encounter.remove", combatantId: foreign }), /That isn't in the fight/);
  refused(await owner.send({ type: "encounter.keep", combatantId: foreign, keep: true }), /That isn't in the fight/);

  // A's turn, then the turn passes to B, then A leaves: undoing the pass cannot hand the turn back to A, so it is
  // skipped and noted, and the undo still succeeds.
  ok(await owner.send({ type: "turn.next" }));
  ok(await owner.send({ type: "turn.next" }));
  await owner.until((s) => s.encounter?.currentId === b.id);
  ok(await owner.send({ type: "encounter.remove", combatantId: a.id }));
  ok(await owner.send({ type: "event.undo" }));
  const [undoEvent] = await query<{ payload: { skipped: { turn?: string; reason: string }[] } }>(
    "SELECT payload FROM session_event WHERE campaign_id = $1 AND type = 'undo' ORDER BY created_at DESC, id DESC LIMIT 1",
    [campaignId],
  );
  assert.deepEqual(undoEvent?.payload.skipped, [{ turn: "currentId", reason: "gone" }]);
  for (const c of [owner, ana.c, ben.c, tv, other.owner, other.ana.c, other.ben.c]) c.socket.close();
});

test("encounter: a full combatant's health stays home where the viewer view hides it", async () => {
  const ownerDevice = await device("owner-HpHide");
  const me = caller(ownerDevice);
  const hidden = {
    ...BUILD_RULESET,
    resources: BUILD_RULESET.resources?.map((r) => (r.id === "hp" ? { ...r, visibility: "owner" as const } : r)),
  };
  const rs = await me.post<RulesetReply>("/rulesets", hidden);
  const { campaignId } = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "HpHide", rulesetVersionId: rs.body.versionId })
  ).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const pk = await me.post<PackReply>("/packs", BUILD_PACK);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const anaDevice = await seatPlayer(owner, "ana-HpHide");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  const state = await owner.until((s) => s.access.members.some((m) => m.userId === uid("ana-HpHide")));
  const held = state.access.members.find((m) => m.userId === uid("ana-HpHide"))!.characterIds[0]!;
  const npc = ok(await owner.send({ type: "actor.create", kind: "pc", name: "Pregen", entityType: "character" })).id!;
  for (const [c, actorId] of [
    [ana, held],
    [owner, npc],
  ] as const)
    ok(await c.send({ type: "actor.build", actorId, answers: GOOD_ANSWERS }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [held, npc], side: "party", visibility: "full" }));
  const seen = await ana.until((s) => s.encounter?.combatants.length === 2);
  const hp = (actorId: string) => seen.encounter!.combatants.find((c) => c.actorId === actorId)!.hp;
  assert.notEqual(hp(held), null, "her own character's health is hers to see");
  assert.equal(hp(npc), null, "the party's health stays home where the ruleset keeps it private");
  for (const c of [owner, ana]) c.socket.close();
});

test("seat views: a combat-only co-GM runs the hidden creature, and reads no codex secret nor hidden Test target", async () => {
  const { owner, ana, campaignId, ogre, call } = await testRoom("SeatView");
  const co = await coGm({ owner, campaignId, name: "co-combat-SeatView", scopes: ["combat"] });
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [ogre], side: "foe", visibility: "hidden" }));
  const id = ok(await owner.send(call())).id!;
  const secret = ok(await owner.send({ type: "codex.save", kind: "handout", title: "Secret", gmNotes: "a trap" })).id!;

  const combatants = (s: LiveState) => s.encounter?.combatants.length;
  const gm = await owner.until((s) => combatants(s) === 1 && s.tests.some((t) => t.id === id));
  assert.equal(gm.tests.find((t) => t.id === id)?.targets[0]?.target, DN);
  const player = await ana.until((s) => s.encounter !== null && s.tests.some((t) => t.id === id));
  assert.equal(combatants(player), 0, "a hidden Combatant is not in the player's order");
  assert.equal(player.tests.find((t) => t.id === id)?.targets[0]?.target, null);

  const coState = await co.until((s) => combatants(s) === 1);
  assert.equal(actorIn(coState, ogre)?.fields["attr.con"], 10, "the combat scope reads the creature's values");
  assert.equal(coState.tests.length, 0, "no Test without the session scope");
  await eventually(() => owner.codex()?.entries.some((e) => e.id === secret) ?? false, "the GM reads the secret");
  assert.equal(
    co.codex()?.entries.some((e) => e.id === secret),
    false,
    "a combat-only co-GM reads no secret",
  );
  // A codex co-GM's new entry (GM-only by default) stays in their own view, with its notes left to the secrets scope.
  const codexCo = await coGm({ owner, campaignId, name: "co-codex-SeatView", scopes: ["codex"] });
  const mine = ok(await codexCo.send({ type: "codex.save", kind: "handout", title: "Mine" })).id!;
  await eventually(
    () => codexCo.codex()?.entries.some((e) => e.id === mine) ?? false,
    "the codex co-GM keeps their entry",
  );
  await eventually(() => codexCo.codex()?.entries.some((e) => e.id === secret) ?? false, "and reads every entry");
  assert.equal(codexCo.codex()?.entries.find((e) => e.id === secret)?.gmNotes, "", "but not the notes on it");
  for (const c of [owner, ana, co, codexCo]) c.socket.close();
});

// ---- Characterization pins for the rule-engine handlers (house decision #28 and the no-ruleset case) ----------------

test("pins: an open encounter between sessions refuses the tracker and the turn primitives, and keeps the rest loose", async () => {
  const { owner, ana, hero, ogre } = await rulesRoom("Pins");
  const turnOp = (primitive: string, op: string) => ({ type: "rule.op", primitive, op, input: {} }) as const;
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [hero, ogre], side: "party" }));
  const added = await owner.until((s) => s.encounter?.combatants.length === 2);
  assert.equal(added.encounter?.paused, false);
  const [c1, c2] = added.encounter!.combatants.map((c) => c.id) as [string, string];
  ok(await owner.send({ type: "encounter.setInitiative", combatantId: c1, score: 9 }));
  ok(await owner.send({ type: "encounter.setInitiative", combatantId: c2, score: 4 }));
  ok(await owner.send({ type: "turn.next" }));
  ok(await owner.send(turnOp("conditions.expire", "roundEnd")));
  ok(await owner.send(turnOp("initiative.ranked", "next")));

  // No session: every tracker action but start, and the two turn primitives, answer sessionPaused.
  ok(await owner.send({ type: "session.end" }));
  await ana.until((s) => s.encounter?.paused === true);
  const paused = "sessionPaused";
  for (const action of [
    { type: "turn.next" },
    { type: "encounter.add", actorIds: [hero], side: "party" },
    { type: "encounter.setInitiative", combatantId: c1, score: 5 },
    turnOp("conditions.expire", "roundEnd"),
    turnOp("conditions.expire", "encounterEnd"),
    turnOp("initiative.ranked", "next"),
  ] satisfies ActionInput[])
    refused(await owner.send(action), paused);

  // The looseness that stays: other primitives, field and condition writes, and a rest all still run.
  ok(await owner.send(hpStep(hero, "hp", -4)));
  ok(await owner.send(adjust(hero, "focus", -1)));
  ok(await owner.send({ type: "field.set", actorId: hero, field: "level", value: 4 }));
  ok(await owner.send({ type: "condition.add", actorId: hero, condition: "marked" }));
  ok(await owner.send({ type: "condition.remove", actorId: hero, condition: "marked" }));
  ok(await owner.send({ type: "actor.rest", event: "longRest", actorId: hero }));
  await resourceOf(owner, hero, "hp", 16); // the level-4 max, restored from 10
  assert.equal((await owner.until(() => true)).encounter?.paused, true);
  for (const c of [owner, ana]) c.socket.close();
});

test("pins: with no ruleset a rule action is refused, and sessions still start and end", async () => {
  const { owner } = await newRoom("PinsBare");
  const pc = crypto.randomUUID();
  refused(await owner.send(adjust(pc, "hp", 1)), "noRuleset");
  refused(await owner.send({ type: "field.set", actorId: pc, field: "level", value: 1 }), "noRuleset");
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "session.end" }));
  refused(await owner.send({ type: "actor.rest", event: "longRest" }), "noRuleset");
  owner.socket.close();
});

// Signing in (docs/research/auth-service-security.md §7.4 to §7.7). The api's sessions work whether or not a provider
// is configured, so the suite makes the row a callback would make, for a device user it already has.
async function sessionFor(userId: string, { endsInS }: { endsInS: number }) {
  const token = deviceSecret();
  await withDb((c) =>
    c.query(
      `insert into api_session (token_hash, user_id, op_sid, roles, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
      [createHash("sha256").update(token).digest("hex"), userId, `sid-${run}-${token}`, ["creator"], endsInS],
    ),
  );
  return `${SESSION_COOKIE}=${token}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a write without the web's origin is refused; the back-channel logout is the one exception", async () => {
  const bare = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${API}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": nextSocketIp(), ...headers },
      body: "{}",
    });
  const cookie = await device("csrf");
  assert.equal((await bare("/campaigns", { cookie })).status, 403);
  assert.equal((await bare("/campaigns", { cookie, "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await bare("/campaigns", { cookie, "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await bare("/campaigns", { cookie, origin: "https://evil.example" })).status, 403);
  assert.notEqual((await bare("/auth/backchannel-logout")).status, 403, "400 with sign-in on, 404 with it off");
});

test("a session is its user over a device cookie; past its end, REST falls back to the device and the socket is dropped", async () => {
  const { campaignId } = await newRoom("Session");
  const stranger = await device("session-stranger");
  const cookie = `${stranger}; ${await sessionFor(uid("owner-Session"), { endsInS: 3 })}`;
  const me = (await (await get("/auth/me", { cookie })).json()) as { account: { roles: string[] } | null };
  assert.deepEqual(me.account, { roles: ["creator"] });
  const lobby = (await (await get("/lobby", { cookie })).json()) as Lobby;
  assert.ok(
    lobby.mine.some((g) => g.id === campaignId),
    "the owner's lobby, not the stranger's",
  );

  const s = connect({ auth: { campaignId, cookie } });
  await s.until((st) => st.campaign.name === "Session");
  await sleep(3200);
  const dropped = new Promise((r) => s.socket.once("disconnect", r));
  const reply = (await s.socket.emitWithAck("action", {})) as ActionResult;
  refused(reply, "unauthorized");
  assert.equal(await dropped, "io server disconnect");
  const after = (await (await get("/auth/me", { cookie })).json()) as { account: unknown };
  assert.equal(after.account, null, "back to the stranger's anonymous device user");
});

test("signing out deletes the session and disconnects its sockets at once", async () => {
  const { campaignId } = await newRoom("Signout");
  const session = await sessionFor(uid("owner-Signout"), { endsInS: 3600 });
  const s = connect({ auth: { campaignId, cookie: session } });
  await s.until((st) => st.campaign.name === "Signout");
  const dropped = new Promise((r) => s.socket.once("disconnect", r));
  const out = await fetch(`${API}/api/auth/logout`, {
    method: "POST",
    headers: { ...SAME_ORIGIN, cookie: session, "cf-connecting-ip": nextSocketIp() },
    redirect: "manual",
  });
  assert.equal(out.status, 303);
  assert.match(out.headers.get("set-cookie") ?? "", /__Host-it_session=;.*Secure/);
  assert.equal(await dropped, "io server disconnect");
  const left = await withDb(
    async (c) =>
      (
        await c.query("select count(*)::int as n from api_session where token_hash = $1", [
          createHash("sha256").update(session.split("=")[1]!).digest("hex"),
        ])
      ).rows,
  );
  assert.equal(left[0].n, 0);
});

test("encounter: a seated order rotates its first player, Undo of the wrap puts it back, and scores are refused", async () => {
  const { owner, ownerDevice } = await newRoom("Seated");
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", SAMPLE_HARVEST);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
  const seats: string[] = [];
  for (const name of ["Ana", "Ben", "Cy"])
    seats.push(ok(await owner.send({ type: "actor.create", kind: "pc", name, entityType: "player" })).id!);
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: seats, side: "party", visibility: "full" }));
  const seated = await owner.until((s) => s.encounter?.combatants.length === 3 && s.encounter.firstId !== null);
  const [a, b, c] = seated.encounter!.combatants.map((x) => x.id) as [string, string, string];
  assert.deepEqual(
    seated.encounter!.combatants.map((x) => x.actorId),
    seats,
    "the seat order is the order they were added in",
  );
  assert.equal(seated.encounter!.firstId, a);
  assert.equal(seated.encounter!.firstPlayer, "rotate");

  // Nothing is scored; a seat moves one place without a tie.
  refused(await owner.send({ type: "encounter.setInitiative", combatantId: a, score: 5 }), "noSeatedScores");
  refused(await owner.send({ type: "turn.first", combatantId: b }), /by hand/);

  // A round: first player, then round the table; the wrap moves the first player one place.
  const state = (s: LiveState) => [s.encounter?.round, s.encounter?.currentId, s.encounter?.firstId];
  const step = async (want: unknown[]) => {
    ok(await owner.send({ type: "turn.next" }));
    await owner.until((s) => state(s).join() === want.join());
  };
  await step([1, a, a]);
  await step([1, b, a]);
  await step([1, c, a]);
  const wrap = ok(await owner.send({ type: "turn.next" })).id!;
  await owner.until((s) => state(s).join() === [2, b, b].join());

  // One Undo takes the wrap back: the round, whose turn it is, and the first player.
  assert.equal(ok(await owner.send({ type: "event.undo" })).id, wrap);
  await owner.until((s) => state(s).join() === [1, c, a].join());
  await step([2, b, b]);
  await step([2, c, b]);
  await step([2, a, b]);
  await step([3, c, c]);
});
