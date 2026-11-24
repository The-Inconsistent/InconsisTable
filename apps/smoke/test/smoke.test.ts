// End-to-end check against a running api (bun run dev:api) + Postgres 18 (bun run dev:db). The api must run with
// ADMIN_KEY set (32+ characters) and the suite with the same value: admin calls use it. Every simulated person is a
// device: a random `it_device` cookie, so the api makes the user on its first write.
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
  RoomImportRefusal,
  RoomImportReply,
} from "@inconsistable/core-schema";
import { HandoutLayout, MAX_PAGE_BYTES } from "@inconsistable/core-schema";
// Made up for the engine's own tests (not exported from the package): a small ruleset and a pack for it.
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARM, SAMPLE_HARM_GROWTHS } from "../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { SAMPLE_PACK, SAMPLE_PACK_EFFECTS } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_HARVEST } from "../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_NO_ORDER } from "../../../packages/rules-engine/src/fixtures/sample-no-order.ts";
import { SAMPLE_POOL } from "../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { SAMPLE_SKIRMISH } from "../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_SKIRMISH_PACK } from "../../../packages/rules-engine/src/fixtures/sample-skirmish-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { SAMPLE_LEDGER_PACK } from "../../../packages/rules-engine/src/fixtures/sample-ledger-pack.ts";
import { SAMPLE_WORLD } from "../../../packages/rules-engine/src/fixtures/sample-world.ts";
import { SAMPLE_PARAMS } from "../../../packages/rules-engine/src/build/fixtures/sample-ledger.ts";
import { buildSchemas } from "../../../packages/rules-engine/src/build/schemas.ts";
import { FIXTURE_RULESET } from "./fixture.ts";
import { FREEFORM } from "../../web/lib/freeform/freeform.ts";
import { d20Document, IDS, ROOM_D20 } from "../../api-go/vectors/room-documents.ts";

// Spelled out, not imported from the api: this suite is the black-box spec any api implementation has to pass.
const MAX_NEW_CHARACTERS_PER_INVITE = 50;
const MAX_PACKS_PER_USER = 50;

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const run = Date.now().toString(36); // test users are fresh per run, so reruns never collide

const ADMIN = { "x-admin-key": process.env.ADMIN_KEY ?? "" };

// One simulated person: a random `it_device` cookie, remembered by name so the same name is the same person. The first
// write (keeping the default name) makes the user; its id is read back from the database so `uid(name)` can name them
// in assertions. Returns the Cookie header value.
const people = new Map<string, Promise<{ cookie: string; userId: string }>>();
const device = (name: string) => {
  let p = people.get(name);
  if (!p) {
    p = (async () => {
      const secret = deviceSecret();
      const cookie = `${DEVICE_COOKIE}=${secret}`;
      assert.equal((await rename("Player", { cookie })).status, 200);
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
const rename = (name: string, headers: Record<string, string> = {}) =>
  fetch(`${API}/api/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "cf-connecting-ip": nextSocketIp(), ...SAME_ORIGIN, ...headers },
    body: JSON.stringify({ name }),
  });

// Each socket comes from its own address: the suite opens more sockets than the api allows one address a minute. The
// api honours cf-connecting-ip only when started with TRUST_CF=1, so the suite needs it.
let sockets = 0;
const nextSocketIp = () =>
  `172.${16 + (Math.floor(++sockets / 250) % 16)}.${sockets % 250}.${1 + Math.floor(Math.random() * 250)}`;

// A socket at one table: `auth` carries campaignId plus a device `cookie`, a guest token or the admin key; `headers`
// can carry a guest cookie instead.
function connect({
  auth: given,
  headers,
  transports = ["websocket"],
}: {
  auth: Record<string, string>;
  headers?: Record<string, string>;
  transports?: string[];
}) {
  const { cookie, ...auth } = given; // a device's cookie travels as the header a browser would send
  const socket = io(API, {
    auth,
    extraHeaders: { "cf-connecting-ip": nextSocketIp(), ...(cookie ? { cookie } : {}), ...headers },
    transports,
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

for (const transport of ["websocket", "polling"]) {
  test(`a ${transport} frame over the socket limit closes the socket and never reaches a handler`, async () => {
    const { owner, campaignId, ownerDevice } = await newRoom(`Frame ${transport}`);
    owner.socket.close();
    const c = connect({ auth: { campaignId, cookie: ownerDevice }, transports: [transport] });
    await c.connected();

    // A page-sized frame still gets through: the handler answers it.
    const fits = (await c.socket.emitWithAck("action", { type: "x", pad: "a".repeat(MAX_PAGE_BYTES) })) as ActionResult;
    refused(fits, "badRequest");

    const closed = new Promise<string>((resolve) => c.socket.once("disconnect", resolve));
    let answered = false;
    c.socket.emit("action", { type: "x", pad: "a".repeat(MAX_PAGE_BYTES + 200_000) }, () => (answered = true));
    await closed;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(answered, false);
  });
}

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

test("a missing, short or garbage it_device is no user, never an error; a fresh one is a user from its first write", async () => {
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
  const devices = async (cookie: string) =>
    (
      await withDb(
        async (c) =>
          (
            await c.query("select count(*)::int as n from device where token_hash = $1", [
              createHash("sha256").update(cookie.split("=")[1]!).digest("hex"),
            ])
          ).rows,
      )
    )[0].n as number;
  assert.equal((await seen()).name, "Player");
  assert.equal(await devices(first), 0, "looking makes no user");
  assert.equal((await rename("Ana", { cookie: first })).status, 200);
  assert.equal((await seen()).name, "Ana");
  assert.equal((await rename("Ana", { cookie: first })).status, 200);
  assert.equal(await devices(first), 1, "the same secret is still one device");
  // Two first writes at once make one user.
  const racer = `${DEVICE_COOKIE}=${deviceSecret()}`;
  const both = await Promise.all([rename("A", { cookie: racer }), rename("B", { cookie: racer })]);
  assert.deepEqual(
    both.map((r) => r.status),
    [200, 200],
  );
  assert.equal(await devices(racer), 1);
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

test("recaps: an ended session's recap reaches every seat, the GM corrects it, notes never travel", async () => {
  const { owner, campaignId } = await newRoom("Recaps");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-rec") } });
  await ana.until(() => true);
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await screen.until(() => true);

  const one = ok(await owner.send({ type: "session.start", title: "One" })).id!;
  ok(await owner.send({ type: "session.edit", sessionId: one, notes: "the twist" }));
  ok(await owner.send({ type: "session.end", recap: "We met." }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "session.end" })); // no recap: left out
  const three = ok(await owner.send({ type: "session.start", title: "Three" })).id!;
  ok(await owner.send({ type: "session.end", recap: "We fled." }));

  for (const c of [owner, ana, screen]) {
    await eventually(() => c.codex()?.recaps.length === 2, "the recaps reach the seat");
    assert.deepEqual(
      c.codex()?.recaps.map((r) => [r.sessionId, r.number, r.recap]),
      [
        [three, 3, "We fled."],
        [one, 1, "We met."],
      ],
      "newest first, the empty one left out",
    );
    assert.ok(!JSON.stringify(c.codex()).includes("the twist"), "the session notes never enter the codex");
  }

  refused(await ana.send({ type: "session.edit", sessionId: one, recap: "Mine" }), "noPermission");
  ok(await owner.send({ type: "session.edit", sessionId: one, recap: "We met in a tavern." }));
  for (const c of [owner, ana, screen])
    await eventually(
      () => c.codex()?.recaps.find((r) => r.sessionId === one)?.recap === "We met in a tavern.",
      "edited",
    );
  for (const c of [owner, ana, screen]) c.socket.close();
});

test("sessions: end without an award, delete the latest, the journal reaches the GM only (house decision #85)", async () => {
  const { owner, campaignId } = await newRoom("Journal");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-jou") } });
  await ana.until(() => true);

  refused(await owner.send({ type: "session.abandon" }), "noSessionRunning");
  const one = ok(await owner.send({ type: "session.start", title: "One" })).id!;
  refused(await owner.send({ type: "session.edit", sessionId: one, recap: "early" }), "recapAtSessionEnd");
  ok(await owner.send({ type: "session.edit", sessionId: one, notes: "the twist" }));
  refused(await ana.send({ type: "session.abandon" }), "noPermission");
  ok(await owner.send({ type: "session.abandon", recap: "Rained off." }));
  const two = ok(await owner.send({ type: "session.start", title: "Two" })).id!;
  refused(await owner.send({ type: "session.delete", sessionId: two }), "endSessionFirst");
  ok(await owner.send({ type: "session.end", recap: "We met." }));
  refused(await owner.send({ type: "session.delete", sessionId: one }), "notLatestSession");
  refused(await ana.send({ type: "session.delete", sessionId: two }), "noPermission");

  const gm = await owner.until((s) => s.journal.length === 2 && s.journal[0]!.endedAt !== null);
  assert.deepEqual(
    gm.journal.map((s) => [s.id, s.number, s.title, s.recap, s.notes, s.abandoned]),
    [
      [two, 2, "Two", "We met.", "", false],
      [one, 1, "One", "Rained off.", "the twist", true],
    ],
    "newest first, the abandoned one marked, the notes the GM's",
  );
  const seen = await ana.until((s) => s.session === null);
  assert.deepEqual(seen.journal, [], "a player receives no journal");
  assert.ok(!JSON.stringify(seen).includes("the twist"), "nor any GM notes");
  await eventually(() => ana.codex()?.recaps.length === 2, "the recaps still reach the player");

  const deleted = ok(await owner.send({ type: "session.delete", sessionId: two }));
  assert.deepEqual(deleted.notices, [{ code: "sessionDeleted", params: { number: 2 } }]);
  await owner.until((s) => s.journal.length === 1 && s.journal[0]!.id === one);
  await eventually(() => ana.codex()?.recaps.length === 1, "the deleted session's recap is gone");
  for (const c of [owner, ana]) c.socket.close();
});

test("whispers: one reaches only its reader, the reply only the GM, a new reply replaces it (house decision #93)", async () => {
  const { owner, campaignId } = await newRoom("Whispers");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-whi") } });
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ben-whi") } });
  const held = (name: string) =>
    owner.until((s) => s.access.members.some((m) => m.userId === uid(name) && m.characterIds.length === 1));
  const anaChar = (await held("ana-whi")).access.members.find((m) => m.userId === uid("ana-whi"))!.characterIds[0]!;
  const benChar = (await held("ben-whi")).access.members.find((m) => m.userId === uid("ben-whi"))!.characterIds[0]!;
  await Promise.all([ana.until(() => true), ben.until(() => true)]);

  refused(await ana.send({ type: "whisper.send", to: [anaChar], text: "to myself" }), "noPermission");
  const id = ok(await owner.send({ type: "whisper.send", to: [anaChar], text: "The cellar door is unlocked." })).id!;
  const seen = await ana.until((s) => s.whispers.length === 1);
  assert.deepEqual(seen.whispers[0]!.readers, [{ actorId: anaChar, reply: null, repliedAt: null, readAt: null }]);
  await ben.until((s) => s.stateVersion >= seen.stateVersion);
  assert.deepEqual((await ben.until(() => true)).whispers, [], "another player's seat receives nothing");

  refused(await ben.send({ type: "whisper.reply", whisperId: id, actorId: benChar, text: "me?" }), "whisperNotToThem");
  refused(
    await ben.send({ type: "whisper.reply", whisperId: id, actorId: anaChar, text: "as Ana" }),
    "notYourCharacter",
  );
  ok(await ana.send({ type: "whisper.reply", whisperId: id, actorId: anaChar, text: "On my way" }));
  ok(await ana.send({ type: "whisper.reply", whisperId: id, actorId: anaChar, text: "Actually, wait" }));
  const gm = await owner.until((s) => s.whispers[0]?.readers[0]?.reply === "Actually, wait");
  assert.ok(gm.whispers[0]!.readers[0]!.readAt !== null, "replying marks it read");
  const benNow = await ben.until((s) => s.stateVersion >= gm.stateVersion);
  assert.ok(!JSON.stringify(benNow).includes("Actually, wait"), "the reply reaches no other player");

  ok(await owner.send({ type: "session.start" }));
  await ana.until((s) => s.whispers.length === 0);
  const again = ok(await owner.send({ type: "whisper.send", to: [anaChar, benChar], text: "Both" })).id!;
  await ben.until((s) => s.whispers[0]?.id === again && s.whispers[0].readers.length === 1);
  ok(await owner.send({ type: "whisper.delete", id: again }));
  await ana.until((s) => s.whispers.length === 0);
  for (const c of [owner, ana, ben]) c.socket.close();
});

test("the next session as a calendar file: any seat, 404 until a date is set, 3 hours", async () => {
  const { owner, campaignId, ownerDevice } = await newRoom("Calendar");
  const anaDevice = await seatPlayer(owner, "ana-ics");
  const ics = (cookie?: string) =>
    get(`/campaigns/${campaignId}/next.ics`, { ...(cookie ? { cookie } : {}), "cf-connecting-ip": nextSocketIp() });

  assert.equal((await ics(anaDevice)).status, 404, "no date yet");
  ok(
    await owner.send({
      type: "campaign.update",
      nextSessionAt: "2026-12-05T19:30:00+07:00",
      nextSessionPlace: "Ana's",
    }),
  );
  for (const cookie of [anaDevice, ownerDevice]) {
    const res = await ics(cookie);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/calendar/);
    const text = await res.text();
    assert.match(text, /\r\nDTSTART:20261205T123000Z\r\n/);
    assert.match(text, /\r\nDTEND:20261205T153000Z\r\n/);
    assert.match(text, /\r\nSUMMARY:Calendar · Session 1\r\n/);
    assert.match(text, /\r\nLOCATION:Ana's\r\n/);
  }
  assert.equal((await ics()).status, 401, "no seat, no file");
  assert.equal((await ics(await device("stranger-ics"))).status, 401, "a stranger has no seat here");
  owner.socket.close();
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

test("clocks: the server clamps a tick, players and the screen see only the party's, undo takes a tick back", async () => {
  const { owner, ana, campaignId } = await testRoom("Clocks");
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const hidden = ok(await owner.send({ type: "clock.create", name: "Reinforcements", segments: 4 })).id!;
  const ritual = ok(await owner.send({ type: "clock.create", name: "Ritual", segments: 6, visibility: "party" })).id!;

  ok(await owner.send({ type: "clock.tick", id: ritual, delta: 4 }));
  ok(await owner.send({ type: "clock.tick", id: ritual, delta: 12 }));
  const gm = await owner.until((s) => s.clocks.find((c) => c.id === ritual)?.filled === 6);
  assert.deepEqual(
    gm.clocks.map((c) => c.id),
    [hidden, ritual],
    "the GM sees both, in the order made",
  );
  for (const seat of [ana, tv]) {
    const seen = await seat.until((s) => s.clocks.some((c) => c.id === ritual && c.filled === 6));
    assert.deepEqual(
      seen.clocks.map((c) => c.id),
      [ritual],
      "a seat off the GM side sees the party clock only",
    );
  }

  refused(await ana.send({ type: "clock.tick", id: ritual, delta: -1 }), "noPermission");
  refused(await tv.send({ type: "clock.tick", id: ritual, delta: -1 }), "screenReadOnly");

  ok(await owner.send({ type: "clock.tick", id: ritual, delta: -2 }));
  await owner.until((s) => s.clocks.find((c) => c.id === ritual)?.filled === 4);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => s.clocks.find((c) => c.id === ritual)?.filled === 6);
  ok(await owner.send({ type: "clock.update", id: ritual, segments: 3 }));
  const lowered = await owner.until((s) => s.clocks.find((c) => c.id === ritual)?.segments === 3);
  assert.equal(lowered.clocks.find((c) => c.id === ritual)?.filled, 3, "fewer segments clamp what was filled");
  ok(await owner.send({ type: "clock.delete", id: hidden }));
  await owner.until((s) => s.clocks.length === 1);
  tv.socket.close();
});

test("spend requests: a player asks, the GM approves or denies, nobody else sees or cancels it", async () => {
  const { owner, ana, ben, hero, bram } = await testRoom("Requests");
  const spare = (state: { actors: { id: string; resources: Record<string, number> }[] }, id: string) =>
    state.actors.find((a) => a.id === id)?.resources.tempHp;
  await query("INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'tempHp', 5)", [hero]);
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Lyra" })); // any action rebroadcasts the state
  await ana.until((s) => spare(s, hero) === 5);

  refused(
    await ana.send({ type: "request.send", actorId: hero, resourceId: "focus", amount: 1 }),
    "requestSpendYourself",
  );
  refused(await ana.send({ type: "request.send", actorId: bram, resourceId: "tempHp", amount: 1 }), "notYourCharacter");
  refused(await ana.send({ type: "request.send", resourceId: "tempHp", amount: 1 }), "requestNoPool");
  refused(await owner.send({ type: "request.send", actorId: hero, resourceId: "tempHp", amount: 1 }), "noPermission");

  const first = ok(
    await ana.send({ type: "request.send", actorId: hero, resourceId: "tempHp", amount: 2, note: "dodge" }),
  ).id!;
  const seen = await owner.until((s) => s.requests.some((q) => q.id === first));
  assert.equal(seen.requests.find((q) => q.id === first)?.note, "dodge");
  await ana.until((s) => s.requests.some((q) => q.id === first));
  assert.deepEqual((await ben.until((s) => s.actors.length > 0)).requests, [], "another player sees none of it");
  refused(await ben.send({ type: "request.cancel", id: first }), "requestNotFound");
  refused(await ana.send({ type: "request.approve", id: first }), "noPermission");

  ok(await owner.send({ type: "request.approve", id: first }));
  await ana.until((s) => spare(s, hero) === 3 && s.requests.length === 0);
  refused(await owner.send({ type: "request.approve", id: first }), "requestAnswered");

  const second = ok(await ana.send({ type: "request.send", actorId: hero, resourceId: "tempHp", amount: 1 })).id!;
  ok(await owner.send({ type: "request.deny", id: second, reason: "not this scene" }));
  const answered = await ana.until((s) => s.requestAnswers.some((r) => r.id === second));
  assert.deepEqual(
    answered.requestAnswers.find((r) => r.id === second),
    {
      id: second,
      userId: uid("ana-Requests"),
      actorId: hero,
      resourceId: "tempHp",
      amount: 1,
      spendId: null,
      status: "denied",
      reason: "not this scene",
    },
  );
  assert.equal(spare(answered, hero), 3, "a denial spends nothing");

  // Undo takes the approved spend back (the denial wrote nothing).
  ok(await owner.send({ type: "event.undo" }));
  await ana.until((s) => spare(s, hero) === 5);

  // Five waiting at most; a session end cancels what is left.
  for (let i = 0; i < 5; i++)
    ok(await ana.send({ type: "request.send", actorId: hero, resourceId: "tempHp", amount: 1 }));
  refused(await ana.send({ type: "request.send", actorId: hero, resourceId: "tempHp", amount: 1 }), "requestLimit");
  ok(await owner.send({ type: "session.end" }));
  await owner.until((s) => s.requests.length === 0);
  ben.socket.close();
});

// A room on an invented ruleset of the owner's import, with Ana and Ben seated; their characters' ids.
async function spendRoom(name: string, manifest: object) {
  const ownerDevice = await device(`owner-${name}`);
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", manifest);
  assert.equal(rs.status, 201);
  const made = await me.post<{ campaignId: string }>("/campaigns", { name, rulesetVersionId: rs.body.versionId });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, `ana-${name}`) } });
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, `ben-${name}`) } });
  const seated = await owner.until((s) => s.access.members.filter((m) => m.characterIds.length > 0).length === 2);
  const own = (who: string) => seated.access.members.find((m) => m.userId === uid(`${who}-${name}`))!.characterIds[0]!;
  return { owner, ana, ben, lyra: own("ana"), bram: own("ben") };
}

const spendAsk = (actorId: string, spendId: string, inputs?: Record<string, number>) =>
  ({ type: "request.send", actorId, spendId, ...(inputs ? { inputs } : {}) }) as ActionInput;
const momentum = (s: LiveState) => s.pools.find((p) => p.id === "momentum")?.value;
const fillMomentum = (delta: number) =>
  ({
    type: "rule.op",
    primitive: "resource.capped",
    op: "adjustPool",
    input: { resource: "momentum", delta },
  }) as ActionInput;

test("spends: a pool ask the party sees, paid at approval or left pending, one tap, cleared with the fight (#84)", async () => {
  const { owner, ana, ben, lyra, bram } = await spendRoom("Spends", SAMPLE_SKIRMISH);
  const sheet = {
    fields: { level: 1, "attr.str": 10, "attr.con": 10, "attr.dex": 12, guard: 10 },
    resources: { hp: 8, focus: 1 },
  };
  await equip(lyra, "character", sheet);
  await equip(bram, "character", sheet);
  ok(await owner.send({ type: "actor.rename", id: lyra, name: "Lyra" }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send(fillMomentum(3)));
  await ana.until((s) => momentum(s) === 3 && actorIn(s, lyra)?.entity === "character");

  refused(await ana.send(spendAsk(lyra, "rally", { dice: 4 })), "badInput");
  refused(await ana.send(spendAsk(lyra, "jump")), "spendNotNow");
  refused(await ana.send(spendAsk(bram, "rally", { dice: 1 })), "notYourCharacter");
  refused(await ana.send({ type: "request.send", actorId: lyra, spendId: "rally", amount: 1 }), "requestKind");
  const rally = ok(await ana.send(spendAsk(lyra, "rally", { dice: 2 }))).id!;
  refused(await ana.send(spendAsk(lyra, "rally", { dice: 1 })), "spendAsked");
  const seen = await ben.until((s) => s.requests.some((q) => q.id === rally));
  assert.deepEqual(seen.requests.find((q) => q.id === rally)?.inputs, { dice: 2 }, "the party sees an ask on its pool");
  refused(await ben.send({ type: "request.cancel", id: rally }), "requestNotFound");

  // Short at approval: the ask stays, the GM is told why.
  ok(await owner.send(fillMomentum(-2)));
  refused(await owner.send({ type: "request.approve", id: rally }), "cannotPay");
  assert.ok((await owner.until((s) => momentum(s) === 1)).requests.some((q) => q.id === rally));
  ok(await owner.send(fillMomentum(2)));
  ok(await owner.send({ type: "request.approve", id: rally }));
  await ben.until((s) => momentum(s) === 1 && s.requests.length === 0);

  // One tap from the GM side, taken back whole by Undo.
  ok(await owner.send({ type: "spend.do", spendId: "rally", actorId: bram, inputs: { dice: 1 } }));
  await owner.until((s) => momentum(s) === 0);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => momentum(s) === 1);

  // A fight's asks go with it; the others stay.
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [lyra, bram] }));
  const jump = ok(await ana.send(spendAsk(lyra, "jump"))).id!;
  const later = ok(await ana.send(spendAsk(lyra, "rally", { dice: 1 }))).id!;
  ok(await owner.send({ type: "encounter.end" }));
  const after = await ana.until((s) => !s.requests.some((q) => q.id === jump));
  assert.ok(
    after.requests.some((q) => q.id === later),
    "a spend that does not clear with the fight stays",
  );
  ben.socket.close();
});

test("once a round: a second use refused, free next round; a held list raises the target of a called Test (#91)", async () => {
  const { owner, ana, lyra } = await spendRoom("Channel", SAMPLE_SKIRMISH);
  await equip(lyra, "character", {
    fields: { level: 1, "attr.str": 10, "attr.con": 10, "attr.dex": 12, guard: 10 },
    resources: { hp: 8, focus: 1, nerve: 4 },
  });
  ok(await owner.send({ type: "actor.rename", id: lyra, name: "Lyra" }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [lyra] }));
  ok(await owner.send({ type: "rule.op", primitive: "initiative.sides", op: "begin", input: {} }));
  const nerve = (s: LiveState) => actorIn(s, lyra)?.resources.nerve;
  const channel = (push: number) =>
    ({ type: "spend.do", spendId: "channel", actorId: lyra, inputs: { push } }) as const;

  ok(await owner.send(channel(1)));
  const used = await owner.until((s) => nerve(s) === 2);
  assert.deepEqual(used.encounter?.combatants.find((c) => c.actorId === lyra)?.used, ["channel"]);
  refused(await owner.send(channel(0)), /Already used this round: "Channel", round 1/);
  refused(await ana.send(spendAsk(lyra, "channel", { push: 0 })), "usedThisRound");
  ok(await owner.send({ type: "rule.op", primitive: "initiative.sides", op: "newRound", input: {} }));
  ok(await owner.send(channel(0)));
  await owner.until((s) => nerve(s) === 1);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => nerve(s) === 2 && s.encounter?.combatants[0]?.used === undefined);

  // The holder's phone holds two wards up: its checks are 4 harder, as the GM's call shows.
  ok(await ana.send({ type: "field.set", actorId: lyra, field: "wards", value: ["Ward of Ash", "Ward of Salt"] }));
  await ana.until((s) => actorIn(s, lyra)?.derived.wardLoad === 4);
  const id = ok(
    await owner.send({
      type: "test.call",
      testId: "check",
      actorIds: [lyra],
      inputs: { ability: "str", dc: 10 },
      hideTarget: false,
    }),
  ).id!;
  const called = await owner.until((s) => s.tests.some((t) => t.id === id));
  assert.equal(called.tests.find((t) => t.id === id)?.targets[0]?.target, 14);
  ok(await ana.send({ type: "field.set", actorId: lyra, field: "wards", value: [] }));
  await ana.until((s) => actorIn(s, lyra)?.derived.wardLoad === 0);
  ana.socket.close();
});

test("spawn options and the table's scaling, fixed at spawn; a marker a player's phone sees (#92)", async () => {
  const ownerDevice = await device("owner-Raid");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_SKIRMISH);
  const pk = await me.post<PackReply>("/packs", SAMPLE_SKIRMISH_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Raid",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  ok(await owner.send({ type: "campaign.setField", fieldId: "peril", value: 3 }));
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Raid") } });
  ok(await owner.send({ type: "actor.create", kind: "pc", name: "Unseated" }));
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  const spawn = (key: string, more: Record<string, unknown>) =>
    owner.send({ type: "actor.spawn", packVersionId: pk.body.versionId, key, count: 1, ...more } as ActionInput);

  refused(await spawn("iron-warden", { options: ["nope"] }), "noSuchOption");
  refused(await spawn("ash-hound", { options: ["hardened"] }), /"Hardened" is not for this entry/);
  ok(await spawn("iron-warden", { options: ["scaled", "quick"], marker: "red", visibility: "full", name: "Warden" }));
  // One seated character and a peril of 3, added once to the entry's level 2; its Spite starts from its grudge of 2, + 1.
  const gm = await owner.until((s) => s.actors.some((a) => a.name === "Warden" && a.resources.spite !== undefined));
  const warden = gm.actors.find((a) => a.name === "Warden")!;
  assert.deepEqual([warden.fields.level, warden.resources.spite], [6, 3]);
  assert.deepEqual(warden.spawnOptions, ["scaled", "quick"]);
  const seen = await ana.until((s) => s.encounter?.combatants.some((c) => c.name === "Warden") === true);
  assert.equal(seen.encounter?.combatants.find((c) => c.name === "Warden")?.marker, "red");
  assert.ok(!seen.actors.some((a) => a.spawnOptions !== undefined), "a player is not told the options");
  const combatant = gm.encounter?.combatants.find((c) => c.actorId === warden.id);
  ok(await owner.send({ type: "encounter.mark", combatantId: combatant!.id, marker: "white" }));
  await ana.until((s) => s.encounter?.combatants.find((c) => c.name === "Warden")?.marker === "white");
  refused(await ana.send({ type: "encounter.mark", combatantId: combatant!.id, marker: null }), "noPermission");
  ana.socket.close();
});

test("spends: a free conversion by a reported number, approved and undone (#84)", async () => {
  const { owner, ana, lyra } = await spendRoom("Endure", SAMPLE_HARM);
  await equip(lyra, "hero", { fields: { grit: 2 }, resources: { wounds: 4, strain: 0 } });
  ok(await owner.send({ type: "actor.rename", id: lyra, name: "Hal" }));
  ok(await owner.send({ type: "session.start" }));
  await ana.until((s) => actorIn(s, lyra)?.entity === "hero");
  refused(await ana.send(spendAsk(lyra, "endure", { marks: 5 })), "badInput");
  const id = ok(await ana.send(spendAsk(lyra, "endure", { marks: 3 }))).id!;
  ok(await owner.send({ type: "request.approve", id }));
  await ana.until((s) => actorIn(s, lyra)?.resources.wounds === 1 && actorIn(s, lyra)?.resources.strain === 3);
  ok(await owner.send({ type: "event.undo" }));
  await ana.until((s) => actorIn(s, lyra)?.resources.wounds === 4 && actorIn(s, lyra)?.resources.strain === 0);
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

test("pictures: uploaded, attached, shown to the table apart from the entry; a replaced one is gone", async () => {
  const { owner, campaignId, ownerDevice } = await newRoom("Pictures");
  const anaDevice = await seatPlayer(owner, "ana-pics");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, n]);
  const upload = (cookie: string, bytes: Uint8Array<ArrayBuffer>, type = "image/jpeg", site = SAME_ORIGIN) =>
    fetch(`${API}/api/campaigns/${campaignId}/images`, {
      method: "POST",
      headers: { "content-type": type, ...site, cookie, "cf-connecting-ip": nextSocketIp() },
      body: bytes,
    });
  const picture = (cookie: string, id: string) =>
    get(`/campaigns/${campaignId}/images/${id}`, { cookie, "cf-connecting-ip": nextSocketIp() });
  const idOf = async (res: Response) => {
    assert.equal(res.status, 200);
    return ((await res.json()) as { id: string }).id;
  };
  const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;

  assert.equal((await upload(anaDevice, jpeg(1))).status, 403, "a player uploads nothing into a room with a GM");
  assert.equal((await upload(ownerDevice, jpeg(1), "image/jpeg", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(await codeOf(await upload(ownerDevice, jpeg(1), "image/webp")), "pictureNotPicture");
  assert.equal(await codeOf(await upload(ownerDevice, jpeg(1), "image/png")), "pictureType");

  const first = await idOf(await upload(ownerDevice, jpeg(1)));
  const npc = ok(await owner.send({ type: "codex.save", kind: "npc", title: "Lamplighter", imageId: first })).id!;
  ok(await owner.send({ type: "codex.reveal", id: npc, visibility: "party", audienceMode: "all", audience: [] }));
  const seen = () => ana.codex()?.entries.find((e) => e.id === npc);
  await eventually(() => seen() !== undefined, "the player reads the entry");
  assert.deepEqual([seen()?.imageId, seen()?.imageRevealed], [null, false], "the picture is not shown yet");
  assert.ok(!JSON.stringify(ana.codex()).includes(first), "nor its id anywhere");
  assert.equal((await picture(anaDevice, first)).status, 404);
  assert.equal((await picture(ownerDevice, first)).status, 200);

  ok(await owner.send({ type: "codex.reveal", id: npc, imageRevealed: true }));
  await eventually(() => seen()?.imageId === first, "the player receives the shown picture's id");
  assert.equal(seen()?.imageRevealed, true);
  assert.equal(owner.codex()?.entries.find((e) => e.id === npc)?.visibility, "party", "who reads it is unchanged");
  const res = await picture(anaDevice, first);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("cache-control") ?? "", /^private/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg(1));
  assert.equal((await picture(await device("stranger-pics"), first)).status, 404, "no seat, no picture");

  const second = await idOf(await upload(ownerDevice, jpeg(2)));
  ok(await owner.send({ type: "codex.save", id: npc, kind: "npc", imageId: second }));
  await eventually(() => seen()?.imageId === null, "a replacement starts hidden from the table");
  assert.equal(owner.codex()?.entries.find((e) => e.id === npc)?.imageId, second);
  assert.equal((await picture(ownerDevice, first)).status, 404, "the replaced picture is gone");
  refused(
    await owner.send({ type: "codex.save", id: npc, kind: "npc", imageId: crypto.randomUUID() }),
    "pictureNotFound",
  );
  owner.socket.close();
  ana.socket.close();
});

test("prep: scenes under an adventure, reordered and linked; a player sees only the visible ends", async () => {
  const { owner, campaignId } = await newRoom("Prep");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const anaDevice = await device("ana-prep");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Lyra" }, cookieOf(anaDevice));
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const adv = await save({ kind: "adventure", title: "The Drowned Road" });
  const [a, b] = [await save({ kind: "scene", title: "Ferry" }), await save({ kind: "scene", title: "Shrine" })];
  for (const [i, id] of [a, b].entries()) ok(await owner.send({ type: "codex.move", id, parentId: adv, position: i }));
  ok(await owner.send({ type: "codex.move", id: b, parentId: adv, position: 0 }));
  const pos = (id: string) => owner.codex()?.entries.find((e) => e.id === id)?.position;
  await eventually(() => pos(b) === 0 && pos(a) === 1, "the scenes were reordered and renumbered");

  const npc = await save({ kind: "npc", title: "Ferryman" });
  const secret = await save({ kind: "handout", title: "Smuggler's note" });
  ok(await owner.send({ type: "codex.link", id: a, targetId: npc }));
  ok(await owner.send({ type: "codex.link", id: a, targetId: npc }));
  ok(await owner.send({ type: "codex.link", id: a, targetId: secret }));
  await save({ id: a, kind: "scene", plannedTests: ["check"] });
  for (const id of [adv, a, npc])
    ok(await owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(
    () => [a, npc].every((id) => ana.codex()?.entries.some((e) => e.id === id)),
    "Lyra sees the scene and the Ferryman",
  );

  const gmScene = owner.codex()?.entries.find((e) => e.id === a);
  assert.deepEqual([...(gmScene?.links ?? [])].sort(), [npc, secret].sort(), "the GM sees both links, once each");
  assert.deepEqual(gmScene?.plannedTests, ["check"]);
  const seen = ana.codex()?.entries.find((e) => e.id === a);
  assert.deepEqual(seen?.links, [npc], "the hidden handout's id never reaches the player");
  assert.deepEqual(seen?.plannedTests, []);
  assert.equal(seen?.parentId, adv);
  assert.ok(!JSON.stringify(ana.codex()).includes(secret));

  refused(await ana.send({ type: "codex.move", id: a, parentId: null, position: 0 }), "noPermission");
  refused(await ana.send({ type: "codex.link", id: a, targetId: npc }), "noPermission");
  refused(await owner.send({ type: "codex.delete", id: adv }), "adventureHasScenes");
  refused(await owner.send({ type: "codex.move", id: npc, parentId: adv, position: 0 }), "parentOtherKind");
  owner.socket.close();
  ana.socket.close();
});

test("scenes: a begin sends its reveals and can be taken back, an exit begins the next, an adventure goes with its scenes", async () => {
  const { owner, campaignId } = await newRoom("Scenes");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-scenes") } });
  await ana.until(() => true);
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const adv = await save({ kind: "adventure", title: "The Gate Road" });
  const keeper = await save({ kind: "npc", title: "Gatekeeper" });
  const map = await save({ kind: "handout", title: "Gate map" });
  const known = await save({ kind: "lore", title: "Old song" });
  ok(await owner.send({ type: "codex.reveal", id: known, visibility: "party", audienceMode: "all", audience: [] }));
  const hall = await save({ kind: "scene", title: "Hall" });
  const reveals = [keeper, map, known].map((entryId, i) => ({ id: `v${i}`, entryId }));
  const gate = await save({
    kind: "scene",
    title: "Gate",
    prep: { reveals, exits: [{ id: "x", label: "Inside", sceneId: hall }] },
  });
  for (const [i, id] of [gate, hall].entries())
    ok(await owner.send({ type: "codex.move", id, parentId: adv, position: i }));
  const anaSees = (id: string) => ana.codex()?.entries.find((e) => e.id === id);
  const statusOf = (id: string) => owner.codex()?.entries.find((e) => e.id === id)?.status;

  refused(await ana.send({ type: "scene.begin", sceneId: gate }), "noPermission");
  const begun = ok(await owner.send({ type: "scene.begin", sceneId: gate }));
  assert.deepEqual(begun.notices, [{ code: "sceneBegun", params: { title: "Gate", revealed: 3 } }]);
  await eventually(() => !!anaSees(keeper) && !!anaSees(map), "both reveals reach the player");
  assert.ok(anaSees(map)?.revealedAt, "with the time they were revealed");
  assert.ok(
    !JSON.stringify([ana.codex(), await ana.until(() => true)]).includes("sceneBegun"),
    "the notice is the GM's",
  );
  await eventually(() => statusOf(gate) === "active", "the begun scene is active");

  refused(await ana.send({ type: "scene.undoBegin", beginId: begun.id! }), "noPermission");
  ok(await owner.send({ type: "scene.undoBegin", beginId: begun.id! }));
  await eventually(() => !anaSees(keeper) && !anaSees(map), "taking it back seals them again");
  assert.ok(anaSees(known), "an entry revealed before the begin stays revealed");
  await eventually(() => statusOf(gate) === "planned", "the scene goes back to where it stood");
  refused(await owner.send({ type: "scene.undoBegin", beginId: begun.id! }), "notLatestBegin");

  // An exit is scene.begin of the scene it names: the one being played goes to done.
  const again = ok(await owner.send({ type: "scene.begin", sceneId: gate })).id!;
  const inside = ok(await owner.send({ type: "scene.begin", sceneId: hall }));
  assert.deepEqual(inside.notices, [{ code: "sceneBegun", params: { title: "Hall", revealed: 0 } }]);
  await eventually(() => statusOf(gate) === "done" && statusOf(hall) === "active", "the exit began the next scene");
  refused(await owner.send({ type: "scene.undoBegin", beginId: again }), "notLatestBegin");
  ok(await owner.send({ type: "codex.save", id: hall, kind: "scene", status: "done" }));
  refused(await owner.send({ type: "scene.undoBegin", beginId: inside.id! }), "sceneNotActive");
  refused(await owner.send({ type: "scene.begin", sceneId: keeper }), "notAScene");

  refused(await owner.send({ type: "codex.delete", id: adv }), "adventureHasScenes");
  ok(await owner.send({ type: "codex.delete", id: adv, withScenes: true }));
  await eventually(
    () => ![adv, gate, hall].some((id) => owner.codex()?.entries.some((e) => e.id === id)),
    "the adventure went with its scenes",
  );
  for (const c of [owner, ana]) c.socket.close();
});

test("a quest has a status; only a quest", async () => {
  const { owner, campaignId } = await newRoom("Quest");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const anaDevice = await device("ana-quest");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Lyra" }, cookieOf(anaDevice));
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const q = ok(await owner.send({ type: "codex.save", kind: "quest", title: "Find the bell" })).id!;
  const entry = () => owner.codex()?.entries.find((e) => e.id === q);
  await eventually(() => entry()?.status === "open", "a new quest is open");
  ok(await owner.send({ type: "codex.reveal", id: q, visibility: "party", audienceMode: "all", audience: [] }));
  ok(await owner.send({ type: "codex.save", id: q, kind: "quest", status: "done" }));
  await eventually(() => ana.codex()?.entries.find((e) => e.id === q)?.status === "done", "the player sees done");
  const npc = ok(await owner.send({ type: "codex.save", kind: "npc", title: "Ferryman" })).id!;
  refused(await owner.send({ type: "codex.save", id: npc, kind: "npc", status: "open" }), "onlyQuestStatus");
  assert.equal(owner.codex()?.entries.find((e) => e.id === npc)?.status, null);
  owner.socket.close();
  ana.socket.close();
});

test("codex tree: places nest, never in a loop; a hidden middle is never named to a player or the screen", async () => {
  const { owner, campaignId } = await newRoom("Tree");
  const inv = ok(await owner.send({ type: "invite.create", mode: "room" })).token!;
  const anaDevice = await device("ana-tree");
  await post(`/invites/${inv}/accept`, { newCharacterName: "Lyra" }, cookieOf(anaDevice));
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const place = async (title: string) => ok(await owner.send({ type: "codex.save", kind: "location", title })).id!;
  const [city, ward, inn, dock] = [await place("City"), await place("Ward"), await place("Inn"), await place("Dock")];
  const move = (id: string, parentId: string | null) => owner.send({ type: "codex.move", id, parentId, position: 0 });
  ok(await move(ward, city));
  ok(await move(inn, ward));
  ok(await move(dock, city));
  refused(await move(city, inn), "wouldLoop");
  refused(await move(ward, ward), "wouldLoop");
  refused(
    await move(inn, ok(await owner.send({ type: "codex.save", kind: "npc", title: "Keeper" })).id!),
    "parentOtherKind",
  );
  // The Dock moves under the Ward, then the Ward is hidden from the table: below it, the Inn reaches seats as a root.
  ok(await move(dock, ward));
  for (const id of [city, inn, dock])
    ok(await owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] }));
  const parents = (codex: Codex | null | undefined) =>
    Object.fromEntries((codex?.entries ?? []).filter((e) => e.kind === "location").map((e) => [e.title, e.parentId]));
  await eventually(() => parents(owner.codex()).Dock === ward, "the GM sees the Dock under the Ward");
  for (const [who, seat] of [
    ["player", ana],
    ["screen", screen],
  ] as const) {
    await eventually(() => Object.keys(parents(seat.codex())).length === 3, `the ${who} sees three places`);
    assert.deepEqual(parents(seat.codex()), { City: null, Inn: null, Dock: null }, `the ${who} gets roots`);
    assert.ok(!JSON.stringify(seat.codex()).includes(ward), `the ${who} never learns the Ward's id`);
  }
  // Deleting the Ward leaves its children as roots.
  ok(await owner.send({ type: "codex.delete", id: ward }));
  await eventually(() => parents(owner.codex()).Inn === null && parents(owner.codex()).Dock === null, "roots");
  assert.deepEqual(parents(ana.codex()), { City: null, Inn: null, Dock: null }, "the player sees three roots still");
  owner.socket.close();
  ana.socket.close();
  screen.socket.close();
});

test("entry fields: the ruleset declares them, the GM sets them, a player and the screen read the party's (#71)", async () => {
  const ownerDevice = await device("ef-owner");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  const pk = await me.post<PackReply>("/packs", SAMPLE_PACK);
  const made = await me.post<{ campaignId: string }>("/campaigns", { name: "Ef", rulesetVersionId: rs.body.versionId });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const anaDevice = await seatPlayer(owner, "ef-ana");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await Promise.all([ana.until(() => true), screen.until(() => true)]);

  // The GM sets the four invented fields; the server checks each against the manifest and the room's packs.
  const npc = ok(
    await owner.send({
      type: "codex.save",
      kind: "npc",
      title: "Harbourmaster",
      fields: { mood: "cold", disposition: -2, patron: "ember-wisp" },
    }),
  ).id!;
  const band = ok(await owner.send({ type: "codex.save", kind: "faction", title: "Tide Guild" })).id!;
  ok(await owner.send({ type: "codex.save", id: band, kind: "faction", fields: { standing: "rival" } }));
  refused(
    await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { standing: "ally" } }),
    "noSuchEntryField",
  );
  refused(await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { disposition: 4 } }), "badEntryField");
  refused(await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { mood: "sulky" } }), "badEntryField");
  refused(
    await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { patron: "coil-rope" } }),
    "badEntryField",
  );
  refused(await ana.send({ type: "codex.save", id: npc, kind: "npc", fields: { mood: "warm" } }), "noPermission");
  for (const id of [npc, band])
    ok(await owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] }));
  const fieldsOf = (c: typeof owner, id: string) => c.codex()?.entries.find((e) => e.id === id)?.fields;
  await eventually(() => fieldsOf(owner, npc)?.patron === "ember-wisp", "the GM reads every field");
  assert.deepEqual(fieldsOf(owner, band), { standing: "rival" });
  const party = { mood: "cold", disposition: -2 };
  await eventually(() => fieldsOf(ana, band) !== undefined && fieldsOf(screen, band) !== undefined, "revealed");
  for (const c of [ana, screen]) {
    assert.deepEqual(fieldsOf(c, npc), party);
    assert.deepEqual(fieldsOf(c, band), {});
  }

  // A null clears one field and leaves the others.
  ok(await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { disposition: null } }));
  await eventually(() => fieldsOf(ana, npc)?.disposition === undefined, "cleared");
  assert.equal(fieldsOf(ana, npc)?.mood, "cold");

  // The served manifest carries the definitions each seat may read.
  type Defs = { codex?: { kinds: Record<string, { fields: Record<string, unknown> }> } };
  const defsOf = async (c: ReturnType<typeof caller>, kind: string) => {
    const manifest = (await c.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.ruleset?.manifest as Defs;
    return Object.keys(manifest?.codex?.kinds[kind]?.fields ?? {}).sort();
  };
  assert.deepEqual(await defsOf(me, "npc"), ["disposition", "home", "mood", "patron"]);
  assert.deepEqual(await defsOf(me, "faction"), ["marks", "seat", "standing"]);
  assert.deepEqual(await defsOf(caller(anaDevice), "npc"), ["disposition", "home", "mood"]);
  assert.deepEqual(await defsOf(caller(anaDevice), "faction"), []);
  // A ref's entry is read by its type and key, as the seat may read it: the gm creature only from the GM side.
  const byKey = `/campaigns/${campaignId}/rules?type=creature&key=ember-wisp&limit=1`;
  assert.deepEqual(keysOf((await me.get<RulesReply>(byKey)).body), ["ember-wisp"]);
  assert.deepEqual(keysOf((await caller(anaDevice).get<RulesReply>(byKey)).body), []);

  // Links to other entries (#76): the GM links the person to a place (the party's field) and the guild to it (the
  // GM's). The server refuses another kind, the entry itself, and an id that is no entry of this room.
  const quay = ok(await owner.send({ type: "codex.save", kind: "location", title: "Quay" })).id!;
  const helper = ok(await owner.send({ type: "codex.save", kind: "npc", title: "Helper" })).id!;
  for (const home of [band, "0190a000-0000-7000-8000-000000000999", "quay"])
    refused(await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { home } }), "badEntryField");
  refused(
    await owner.send({ type: "codex.save", id: band, kind: "faction", fields: { seat: helper } }),
    "badEntryField",
  );
  ok(await owner.send({ type: "codex.save", id: npc, kind: "npc", fields: { home: quay } }));
  ok(await owner.send({ type: "codex.save", id: band, kind: "faction", fields: { seat: quay } }));
  await eventually(() => fieldsOf(owner, band)?.seat === quay, "the GM reads both links");
  assert.equal(fieldsOf(owner, npc)?.home, quay);
  // The place is hidden: no player link yet, and never the guild's.
  assert.equal(fieldsOf(ana, npc)?.home, undefined);
  ok(await owner.send({ type: "codex.reveal", id: quay, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(() => fieldsOf(ana, npc)?.home === quay, "the party's link once the place is readable");
  // Each seat gets its own broadcast: the screen's may land after the player's.
  await eventually(() => fieldsOf(screen, npc)?.home === quay, "the screen's link once the place is readable");
  assert.equal(fieldsOf(ana, band)?.seat, undefined);
  ok(await owner.send({ type: "codex.reveal", id: quay, visibility: "gm", audienceMode: "all", audience: [] }));
  await eventually(() => fieldsOf(ana, npc)?.home === undefined, "the link goes with the place");
  assert.ok(!JSON.stringify(ana.codex()).includes(quay), "nothing names the hidden place");
  assert.equal(fieldsOf(owner, npc)?.home, quay);
  // Deleting the place rewrites nothing; the link reaches nobody.
  ok(await owner.send({ type: "codex.delete", id: quay }));
  await eventually(() => fieldsOf(owner, npc)?.home === undefined, "a link to a deleted entry is not sent");
  assert.equal(fieldsOf(owner, band)?.seat, undefined);

  // A room on a ruleset with no codex block takes no fields at all.
  const plain = await me.post<RulesetReply>("/rulesets", SAMPLE_NO_ORDER);
  const other = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Ef2",
    rulesetVersionId: plain.body.versionId,
  });
  const otherOwner = connect({ auth: { campaignId: other.body.campaignId, cookie: ownerDevice } });
  await otherOwner.until(() => true);
  refused(
    await otherOwner.send({ type: "codex.save", kind: "npc", title: "N", fields: { mood: "cold" } }),
    "noSuchEntryField",
  );
  const plainNpc = ok(await otherOwner.send({ type: "codex.save", kind: "npc", title: "N" })).id!;
  await eventually(() => fieldsOf(otherOwner, plainNpc) !== undefined, "saved");
  assert.deepEqual(fieldsOf(otherOwner, plainNpc), {});
  for (const c of [owner, ana, screen, otherOwner]) c.socket.close();
});

// House decision #89 on the invented fixtures: a place's dangers (rows filled from a creature and written by hand), a
// guild's marks (tags) and its reminder, a scene's pick of the dangers with its switch, and what a player receives:
// nothing of the GM's rows, tags or the reminder that reads them, and the whole of a party road log on the sides fixture.
test("tags, rows, a scene's picks with their switch and a reminder; a player reads only the party's (#89)", async () => {
  const ownerDevice = await device("lf-owner");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  const pk = await me.post<PackReply>("/packs", SAMPLE_PACK);
  const { campaignId } = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "Lf", rulesetVersionId: rs.body.versionId })
  ).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const anaDevice = await seatPlayer(owner, "lf-ana");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  const fieldsOf = (c: typeof owner, id: string) => c.codex()?.entries.find((e) => e.id === id)?.fields;
  const check = { testId: "check", inputs: { ability: "dex", dc: 12 } };
  const dangers = [
    {
      id: "d1",
      from: { entity: "creature", key: "ember-wisp", cite: "Sample p.40" },
      values: { name: "Ember Wisp", threat: 1, strength: "fierce", check },
    },
    { id: "d2", values: { name: "Slick stones", effect: "A slip into the water" } },
  ];
  const place = ok(await owner.send({ type: "codex.save", kind: "location", title: "Ford", fields: { dangers } })).id!;
  // Refused at save, by row and column: a cell past its column's cap, a creature the packs do not serve, a Test the
  // ruleset does not have; the whole save with it.
  for (const bad of [
    [{ id: "x", values: { threat: 21 } }],
    [{ id: "x", from: { entity: "creature", key: "nobody" }, values: {} }],
    [{ id: "x", values: { check: { testId: "gone", inputs: {} } } }],
    [{ id: "x", values: { nope: 1 } }],
  ])
    refused(
      await owner.send({ type: "codex.save", id: place, kind: "location", fields: { dangers: bad } }),
      "badEntryField",
    );
  const band = ok(
    await owner.send({
      type: "codex.save",
      kind: "faction",
      title: "Reed Guild",
      fields: { standing: "ally", marks: ["Reedfolk", "Outsider"] },
    }),
  ).id!;
  refused(
    await owner.send({ type: "codex.save", id: band, kind: "faction", fields: { marks: ["Outsider", "Outsider"] } }),
    "badEntryField",
  );

  // A scene picks the place's first danger; its switch is ticked by saving the prep again.
  const scene = ok(await owner.send({ type: "codex.save", kind: "scene", title: "At the ford" })).id!;
  const pick = (on: boolean) => ({
    picks: [{ id: "k1", entryId: place, field: "dangers", rows: [{ rowId: "d1", on }] }],
  });
  ok(await owner.send({ type: "codex.save", id: scene, kind: "scene", prep: pick(false) }));
  ok(await owner.send({ type: "codex.save", id: scene, kind: "scene", prep: pick(true) }));
  const prepOf = () => owner.codex()?.entries.find((e) => e.id === scene)?.prep;
  await eventually(() => prepOf()?.picks[0]?.rows[0]?.on === true, "the switch is saved with the prep");
  refused(
    await owner.send({
      type: "codex.save",
      id: scene,
      kind: "scene",
      prep: { picks: [{ id: "k1", entryId: place, field: "dangers", rows: [{ rowId: "d1" }, { rowId: "d1" }] }] },
    }),
    "badRequest",
  );

  // The GM reads all of it; a player of the revealed place and guild reads none of the GM's fields, and is not sent the
  // guild's reminder, which reads them.
  for (const id of [place, band])
    ok(await owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(() => fieldsOf(ana, band) !== undefined && fieldsOf(ana, place) !== undefined, "revealed");
  assert.deepEqual(fieldsOf(owner, place), { dangers });
  assert.deepEqual(fieldsOf(owner, band)?.marks, ["Reedfolk", "Outsider"]);
  assert.deepEqual(fieldsOf(ana, place), {});
  assert.deepEqual(fieldsOf(ana, band), {});
  type Kinds = { codex?: { kinds: Record<string, { fields: Record<string, unknown>; reminders?: unknown[] }> } };
  const kindsOf = async (c: ReturnType<typeof caller>) =>
    ((await c.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.ruleset?.manifest as Kinds).codex?.kinds;
  assert.equal((await kindsOf(me))?.faction?.reminders?.length, 1);
  assert.deepEqual((await kindsOf(caller(anaDevice)))?.faction?.reminders, []);
  assert.equal((await kindsOf(caller(anaDevice)))?.location?.fields.dangers, undefined);

  // The second shape: a party road log of text columns, read whole by the player.
  const sk = await me.post<RulesetReply>("/rulesets", SAMPLE_SKIRMISH);
  const second = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "Lf2", rulesetVersionId: sk.body.versionId })
  ).body;
  const owner2 = connect({ auth: { campaignId: second.campaignId, cookie: ownerDevice } });
  await owner2.until(() => true);
  const bo = connect({ auth: { campaignId: second.campaignId, cookie: await seatPlayer(owner2, "lf-bo") } });
  await bo.until(() => true);
  const log = [{ id: "l1", values: { day: "Day 1", what: "Crossed the ford" } }];
  const road = ok(await owner2.send({ type: "codex.save", kind: "quest", title: "The road", fields: { log } })).id!;
  ok(await owner2.send({ type: "codex.reveal", id: road, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(() => fieldsOf(bo, road)?.log !== undefined, "the party's road log");
  assert.deepEqual(fieldsOf(bo, road), { log });
  for (const c of [owner, ana, owner2, bo]) c.socket.close();
});

test("a handout has a layout and a header, read by its player; the room's World offers and names its layouts", async () => {
  const ownerDevice = await device("hl-owner");
  const me = caller(ownerDevice);
  const { campaignId } = (await me.post<{ campaignId: string }>("/campaigns", { name: "Layouts" })).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const anaDevice = await seatPlayer(owner, "hl-ana");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const seen = (id: string) => ana.codex()?.entries.find((e) => e.id === id);

  // Each of the platform's layouts, saved with a header and read back by the player.
  const ids: Record<string, string> = {};
  for (const layout of HandoutLayout.options) {
    const header = `${layout} header`;
    const id = ok(
      await owner.send({ type: "codex.save", kind: "handout", title: layout, body: "Line one", layout, header }),
    ).id!;
    ok(await owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] }));
    await eventually(() => seen(id)?.layout === layout && seen(id)?.header === header, `the player reads ${layout}`);
    ids[layout] = id;
  }
  const bare = ok(await owner.send({ type: "codex.save", kind: "handout", title: "Bare" })).id!;
  await eventually(() => owner.codex()?.entries.some((e) => e.id === bare) ?? false, "the bare handout");
  const stored = owner.codex()?.entries.find((e) => e.id === bare);
  assert.deepEqual([stored?.layout, stored?.header], ["plain", ""], "a handout is plain with no header by default");

  // Only a handout carries them, and only the platform's layouts.
  const npc = ok(await owner.send({ type: "codex.save", kind: "npc", title: "Ferryman" })).id!;
  refused(await owner.send({ type: "codex.save", id: npc, kind: "npc", layout: "form" }), "handoutOnly");
  refused(await owner.send({ type: "codex.save", kind: "lore", title: "L", header: "x" }), "handoutOnly");
  const unknown = { type: "codex.save", kind: "handout", title: "H", layout: "scroll" };
  refused((await owner.socket.emitWithAck("action", unknown)) as ActionResult, "badRequest");
  refused(await owner.send({ type: "codex.save", kind: "handout", title: "H", header: "x".repeat(121) }), "badRequest");
  await eventually(() => owner.codex()?.entries.some((e) => e.id === npc) ?? false, "the NPC");
  assert.deepEqual(
    [
      owner.codex()?.entries.find((e) => e.id === npc)?.layout,
      owner.codex()?.entries.find((e) => e.id === npc)?.header,
    ],
    [null, null],
  );

  // A World that offers three of the five under its own names; every seat reads them with the room's rules.
  type Rules = { world: { handouts: { layouts: string[]; names: Record<string, string> } | null } | null };
  const pinned = (await me.post<WorldReply>("/worlds", SAMPLE_WORLD)).body.versionId!;
  ok(await owner.send({ type: "campaign.setWorld", worldVersionId: pinned }));
  for (const reader of [me, caller(anaDevice)]) {
    const { body } = await reader.get<Rules>(`/campaigns/${campaignId}/rules`);
    assert.deepEqual(body.world?.handouts, {
      layouts: ["proclamation", "transcript", "plain"],
      names: { proclamation: "Harbour notice", transcript: "Signal log", plain: "Note" },
    });
  }
  // A layout the World does not offer is kept and still read; nothing is rewritten when the World changes.
  const { handouts: _, ...withoutHandouts } = SAMPLE_WORLD;
  const plainer = (await me.post<WorldReply>("/worlds", { ...withoutHandouts, version: "0.3.0" })).body.versionId!;
  ok(await owner.send({ type: "campaign.setWorld", worldVersionId: plainer }));
  const after = await me.get<Rules>(`/campaigns/${campaignId}/rules`);
  assert.equal(after.body.world?.handouts, null, "a World without the part");
  ok(await owner.send({ type: "codex.save", id: ids.tablet!, kind: "handout", body: "Line two" }));
  await eventually(() => seen(ids.tablet!)?.body === "Line two", "the edit reaches the player");
  for (const layout of HandoutLayout.options) {
    assert.deepEqual([seen(ids[layout]!)?.layout, seen(ids[layout]!)?.header], [layout, `${layout} header`]);
  }
  owner.socket.close();
  ana.socket.close();
});

test("scene prep: each line is sent as the action it stands for; players and the screen never receive the lines", async () => {
  const { owner, ana, ben, campaignId, packVersionId } = await buildRoom("PrepLines");
  const tok = ok(await owner.send({ type: "screen.issue" })).token!;
  const screen = connect({ auth: { campaignId, token: tok } });
  await screen.until(() => true);
  for (const p of [ana, ben]) ok(await p.c.send({ type: "actor.build", actorId: p.held, answers: GOOD_ANSWERS }));
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const well = await save({ kind: "scene", title: "The well" });
  const keeper = await save({ kind: "npc", title: "Keeper" });
  // One line of each kind on the sample d20 room (no mobs in its ruleset, so no mob), and one naming a pack it lacks.
  const prep = {
    roster: [
      { id: "r1", pack: BUILD_PACK.id, key: "ember-wisp", count: 2, label: "Wisps" },
      { id: "r2", pack: "no-such-pack", key: "ember-wisp", count: 1 },
    ],
    tests: [
      {
        id: "t1",
        testId: "check",
        inputs: { ability: "dex", dc: 12 },
        hideTarget: true,
        outcomes: [{ label: "Pass", text: "The rope holds." }],
      },
      // Taken by one seated character the GM picks when sending it (house decision #75).
      { id: "t2", testId: "check", inputs: { ability: "str", dc: 10 }, takers: "pick" },
    ],
    pools: [{ id: "p1", pool: "menace", amount: 2, text: "They are heard" }],
    exits: [{ id: "e1", label: "Down the well", sceneId: well }],
    reveals: [{ id: "v1", entryId: keeper }],
  };
  const yard = await save({ kind: "scene", title: "The yard", prep });
  const gmYard = () => owner.codex()?.entries.find((e) => e.id === yard);
  await eventually(() => gmYard()?.prep?.roster.length === 2, "the GM receives the lines");
  assert.deepEqual(gmYard()?.prep?.roster[1], { ...prep.roster[1], visibility: "hidden", temporary: true });
  assert.equal(gmYard()?.status, "planned");
  refused(await ana.c.send({ type: "codex.save", id: yard, kind: "scene", prep: null }), "noPermission");
  refused(await owner.send({ type: "codex.save", id: keeper, kind: "npc", prep: null }), "sceneOnly");
  ok(await owner.send({ type: "codex.save", id: yard, kind: "scene", status: "active" }));

  // Shown to the party, the scene reaches the phone and the screen without its lines or where it stands.
  ok(await owner.send({ type: "codex.reveal", id: yard, visibility: "party", audienceMode: "all", audience: [] }));
  for (const c of [ana.c, screen]) {
    await eventually(() => c.codex()?.entries.some((e) => e.id === yard) ?? false, "the scene is shown");
    const seen = c.codex()?.entries.find((e) => e.id === yard);
    assert.deepEqual([seen?.prep, seen?.status], [null, null]);
    assert.ok(!JSON.stringify(c.codex()).includes("Down the well"));
  }

  // The GM sends the lines as the screen builds them: each is that action, nothing else.
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "actor.spawn", packVersionId, key: "ember-wisp", count: 2, temporary: true }));
  const fight = await owner.until((s) => (s.encounter?.combatants.filter((c) => c.side === "foe").length ?? 0) === 2);
  assert.ok(fight.encounter?.combatants.filter((c) => c.side === "foe").every((c) => c.visibility === "hidden"));
  const seated = fight.actors.filter((a) => [ana.held, ben.held].includes(a.id) && a.entity !== "").map((a) => a.id);
  assert.equal(seated.length, 2);
  const line = prep.tests[0]!;
  ok(
    await owner.send({
      type: "test.call",
      testId: line.testId,
      actorIds: seated,
      inputs: line.inputs,
      hideTarget: line.hideTarget,
      showOutcome: false,
    }),
  );
  const called = await ana.c.until((s) => s.tests.some((t) => t.testId === "check" && t.status === "open"));
  assert.equal(called.tests.find((t) => t.testId === "check")?.targets[0]?.target, null, "the target stays hidden");
  // The pick line, once the GM taps Ben: test.call for him alone.
  assert.equal(gmYard()?.prep?.tests[1]?.takers, "pick");
  const picked = prep.tests[1]!;
  ok(
    await owner.send({
      type: "test.call",
      testId: picked.testId,
      actorIds: [ben.held],
      inputs: picked.inputs,
      hideTarget: false,
      showOutcome: false,
    }),
  );
  await ben.c.until((s) =>
    s.tests.some((t) => t.status === "open" && t.targets.length === 1 && t.targets[0]?.actorId === ben.held),
  );
  ok(await owner.send({ type: "codex.reveal", id: keeper, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(() => ana.c.codex()?.entries.some((e) => e.id === keeper) ?? false, "the keeper is shown");
  const menace = (s: LiveState) => s.pools.find((p) => p.id === "menace")?.value;
  const before = menace(await owner.until(() => true))!;
  ok(
    await owner.send({
      type: "rule.op",
      primitive: "resource.capped",
      op: "adjustPool",
      input: { resource: "menace", delta: 2 },
    }),
  );
  await owner.until((s) => menace(s) === before + 2);
  // Undo takes the last line back as it takes back that action.
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => menace(s) === before);

  // Making the next scene active leaves this one done.
  ok(await owner.send({ type: "codex.save", id: well, kind: "scene", status: "active" }));
  await eventually(() => gmYard()?.status === "done", "one scene is active at a time");
  for (const c of [owner, ana.c, ben.c, screen]) c.socket.close();
});

// The five codex features together (#69 to #73) on one room: what a player receives of each, and nothing of a scene's.
test("codex entry, all at once: a nested place with a shown picture and a field, a laid-out handout, a prepared scene", async () => {
  // The d20 fixture declares no place field; this copy adds one, so the nested place can carry one.
  const ruleset = structuredClone(SAMPLE_D20);
  ruleset.version = "0.1.4-all";
  ruleset.codex!.kinds.location = {
    fields: {
      district: { type: "text", label: "District", maxLength: 40, visibility: "party", cite: "Sample p.17" },
    },
  };
  const ownerDevice = await device("all-owner");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", ruleset);
  assert.equal(rs.status, 201);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "All",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const anaDevice = await seatPlayer(owner, "all-ana");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  await ana.until(() => true);
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const reveal = (id: string) =>
    owner.send({ type: "codex.reveal", id, visibility: "party", audienceMode: "all", audience: [] });

  const upload = await fetch(`${API}/api/campaigns/${campaignId}/images`, {
    method: "POST",
    headers: { "content-type": "image/jpeg", ...SAME_ORIGIN, cookie: ownerDevice, "cf-connecting-ip": nextSocketIp() },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 7]),
  });
  assert.equal(upload.status, 200);
  const picture = ((await upload.json()) as { id: string }).id;
  const town = await save({ kind: "location", title: "Harbour town" });
  const quay = await save({ kind: "location", title: "Quay", imageId: picture, fields: { district: "Docks" } });
  ok(await owner.send({ type: "codex.move", id: quay, parentId: town, position: 0 }));
  const notice = await save({ kind: "handout", title: "Notice", layout: "proclamation", header: "By order" });
  const scene = await save({ kind: "scene", title: "The quay", prep: { reveals: [{ id: "v1", entryId: notice }] } });
  ok(await owner.send({ type: "codex.save", id: scene, kind: "scene", status: "active" }));
  for (const id of [town, quay, notice, scene]) ok(await reveal(id));
  ok(await owner.send({ type: "codex.reveal", id: quay, imageRevealed: true }));

  const gm = (id: string) => owner.codex()?.entries.find((e) => e.id === id);
  await eventually(() => gm(scene)?.status === "active", "the GM reads the scene's status");
  assert.deepEqual(gm(scene)?.prep?.reveals, [{ id: "v1", entryId: notice }]);
  const seen = (id: string) => ana.codex()?.entries.find((e) => e.id === id);
  await eventually(() => seen(quay)?.imageRevealed === true && seen(scene) !== undefined, "the player reads them all");
  const place = seen(quay);
  assert.deepEqual(
    [place?.parentId, place?.imageId, place?.fields],
    [town, picture, { district: "Docks" }],
    "the nested place, its parent, its shown picture and its party field",
  );
  assert.deepEqual([seen(notice)?.layout, seen(notice)?.header], ["proclamation", "By order"]);
  assert.deepEqual([seen(scene)?.prep, seen(scene)?.status], [null, null], "nothing of the scene's prep or status");
  owner.socket.close();
  ana.socket.close();
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
  rulesetId: string;
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

test("importer: a layout's widget rows import, and an unknown widget or value is refused at its path (house decision #83)", async () => {
  const me = caller(await device("widgets"));
  const bad = structuredClone(SAMPLE_D20);
  const character = bad.layout?.character;
  assert.ok(character?.sections[1]);
  character.sections[1].show[0] = { widget: "dial", bind: { ratings: ["attr.str"] } };
  character.trackerRow = [{ widget: "track", bind: { value: "res.nope" } }];
  const refused = await me.post<PackReply>("/rulesets", bad);
  assert.equal(refused.status, 422);
  assert.deepEqual(
    refused.body.problems?.map((p) => p.path),
    ["layout.character.sections[1].show[0].widget", "layout.character.trackerRow[0].bind.value"],
  );
  assert.deepEqual((await me.get<unknown[]>("/rulesets")).body, [], "nothing is stored");
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_D20);
  assert.equal(rs.status, 201, "seven widgets on the character's sheet import");
  const exported = await me.get<{ layout: { character: { sections: { show: unknown[] }[] } } }>(
    `/rulesets/${rs.body.rulesetId}/export`,
  );
  assert.deepEqual(
    exported.body.layout.character.sections[1]?.show[0],
    SAMPLE_D20.layout?.character?.sections[1]?.show[0],
  );
});

// House decision #90 on the sides fixture: its setup checklist imports and is read back by the GM through the
// seat-scoped rules route, never by a player; a step counting what the ruleset lacks is refused at its path.
test("importer: a setup checklist imports, reaches the GM's seat only, and is refused at its path (#90)", async () => {
  const ownerDevice = await device("checklist-owner");
  const me = caller(ownerDevice);
  const bad = structuredClone(SAMPLE_SKIRMISH);
  bad.checklist = [
    { id: "a", label: "A", cite: "Sample p.1", done: { count: "entries", kind: "faction", field: "nope" } },
    { id: "b", label: "B", cite: "Sample p.1", done: { count: "sessions" }, goto: { tab: "party", kind: "npc" } },
  ];
  const refused = await me.post<PackReply>("/rulesets", bad);
  assert.equal(refused.status, 422);
  assert.deepEqual(
    refused.body.problems?.map((p) => p.path),
    ["checklist[0].done.field", "checklist[1].goto.kind"],
  );
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_SKIRMISH);
  const { campaignId } = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "Checklist", rulesetVersionId: rs.body.versionId })
  ).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const playerDevice = await seatPlayer(owner, "checklist-player");
  type Listed = { checklist?: { id: string; done: { count: string } }[] };
  const listOf = async (c: ReturnType<typeof caller>) =>
    ((await c.get<RulesReply>(`/campaigns/${campaignId}/rules`)).body.ruleset?.manifest as Listed).checklist;
  assert.deepEqual(
    (await listOf(me))?.map((s) => [s.id, s.done.count]),
    SAMPLE_SKIRMISH.checklist?.map((s) => [s.id, s.done.count]),
  );
  assert.equal(await listOf(caller(playerDevice)), undefined);
  owner.socket.close();
});

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
  const exportedRs = await me.get<Record<string, unknown>>(`/rulesets/${rs.body.rulesetId}/export`);
  assert.equal(exportedRs.status, 200);
  assert.equal(
    (await me.post<RulesetReply>("/rulesets", exportedRs.body)).body.unchanged,
    true,
    "the export re-imports unchanged",
  );
  assert.equal((await caller(await device("snoop-rs")).get(`/rulesets/${rs.body.rulesetId}/export`)).status, 404);
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

// ---- Worlds (house decision #65): imported by their owner, pinned by the one running the room, read by every seat ----

interface WorldReply {
  worldId: string;
  versionId: string;
  version: string;
  unchanged: boolean;
  problems?: Problem[];
}
interface ServedWorld {
  versionId: string;
  slug: string;
  version: string;
  name: string;
  theme: { schemes: Record<string, Record<string, string>>; texture?: string };
}

test("Worlds: imported, pinned, read by every seat of the room, changed mid-session, unset, hidden, taken down", async () => {
  assert.equal((await post("/worlds", SAMPLE_WORLD)).status, 401);
  const ownerDevice = await device("wd-owner");
  const me = caller(ownerDevice);

  // The importer refuses a World that is hard to read, by path, and stores versions as a ruleset's.
  const dim = await me.post<WorldReply>("/worlds", {
    ...SAMPLE_WORLD,
    theme: { schemes: { dark: { ink: "#000000" } } },
  });
  assert.equal(dim.status, 422);
  assert.deepEqual(dim.body.problems?.[0], {
    path: "theme.schemes.dark",
    message: '"ink" on "paper" is 1.25:1, under 4.5:1',
  });
  const first = await me.post<WorldReply>("/worlds", SAMPLE_WORLD);
  assert.equal(first.status, 201);
  const same = await me.post<WorldReply>("/worlds", SAMPLE_WORLD);
  assert.deepEqual([same.body.unchanged, same.body.versionId], [true, first.body.versionId]);
  const clash = await me.post<WorldReply>("/worlds", { ...SAMPLE_WORLD, name: "Other tide" });
  assert.equal(clash.status, 422);
  assert.match(clash.body.problems?.[0]?.message ?? "", /raise the version/);
  const second = await me.post<WorldReply>("/worlds", { ...SAMPLE_WORLD, version: "0.2.0", name: "Tidewater at dusk" });
  assert.deepEqual([second.status, second.body.worldId], [201, first.body.worldId]);
  const listed = await me.get<{ slug: string; versions: { version: string }[] }[]>("/worlds");
  assert.deepEqual(
    listed.body.map((w) => [w.slug, w.versions.map((v) => v.version)]),
    [["sample-tidewater", ["0.2.0", "0.1.0"]]],
  );
  const exported = await me.get<{ version: string }>(`/worlds/${first.body.worldId}/export`);
  assert.deepEqual([exported.status, exported.body.version], [200, "0.2.0"]);
  assert.equal((await me.get("/worlds/not-an-id/export")).status, 400);
  const stranger = caller(await device("wd-stranger"));
  assert.equal((await stranger.get(`/worlds/${first.body.worldId}/export`)).status, 404);
  assert.deepEqual((await stranger.get<unknown[]>("/worlds")).body, []);

  // A room in session, a player and the table screen.
  const { campaignId } = (await me.post<{ campaignId: string }>("/campaigns", { name: "Tide room" })).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until((s) => s.campaign.worldVersionId === null);
  ok(await owner.send({ type: "session.start" }));
  const anaDevice = await seatPlayer(owner, "wd-ana");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const screenToken = ok(await owner.send({ type: "screen.issue" })).token!;
  const screen = connect({ auth: { campaignId, token: screenToken } });
  await Promise.all([ana.until(() => true), screen.until(() => true)]);
  const readers = {
    gm: () => me.get<{ world: ServedWorld | null }>(`/campaigns/${campaignId}/rules`),
    player: () => caller(anaDevice).get<{ world: ServedWorld | null }>(`/campaigns/${campaignId}/rules`),
    screen: async () => {
      const res = await get(`/campaigns/${campaignId}/rules`, { cookie: `it_token=${screenToken}` });
      return { status: res.status, body: (await res.json()) as { world: ServedWorld | null } };
    },
  };
  const everyone = async (versionId: string | null) => {
    await Promise.all([owner, ana, screen].map((c) => c.until((s) => s.campaign.worldVersionId === versionId)));
    for (const [seat, read] of Object.entries(readers)) {
      const { status, body } = await read();
      assert.equal(status, 200, seat);
      assert.equal(body.world?.versionId ?? null, versionId, `${seat} reads the room's World`);
    }
  };

  // Pinning: only the one running the room, only a World of their own.
  const rival = await caller(await device("wd-rival")).post<WorldReply>("/worlds", SAMPLE_WORLD);
  refused(await ana.send({ type: "campaign.setWorld", worldVersionId: first.body.versionId }), "noPermission");
  refused(await screen.send({ type: "campaign.setWorld", worldVersionId: first.body.versionId }), "screenReadOnly");
  refused(await owner.send({ type: "campaign.setWorld", worldVersionId: crypto.randomUUID() }), "worldNotFound");
  refused(await owner.send({ type: "campaign.setWorld", worldVersionId: rival.body.versionId }), "worldNotFound");
  ok(await owner.send({ type: "campaign.setWorld", worldVersionId: first.body.versionId }));
  await everyone(first.body.versionId);
  const served = (await readers.screen()).body.world;
  assert.deepEqual(
    [served?.slug, served?.version, served?.name, served?.theme.texture],
    ["sample-tidewater", "0.1.0", "Tidewater", "paper"],
  );
  assert.equal(served?.theme.schemes.dark?.wood, "#0f2326");
  assert.equal((await caller(await device("wd-outsider")).get(`/campaigns/${campaignId}/rules`)).status, 401);

  // Changed mid-session, then unset.
  ok(await owner.send({ type: "campaign.setWorld", worldVersionId: second.body.versionId }));
  await everyone(second.body.versionId);
  ok(await owner.send({ type: "campaign.unsetWorld" }));
  await everyone(null);
  refused(await ana.send({ type: "campaign.unsetWorld" }), "noPermission");

  // Taken down: served to nobody, not pinned, not exported, not imported again; put back, served again.
  ok(await owner.send({ type: "campaign.setWorld", worldVersionId: second.body.versionId }));
  await everyone(second.body.versionId);
  const takedown = (disabled: boolean) => post(`/admin/worlds/${first.body.worldId}/disable`, { disabled }, ADMIN);
  assert.equal((await post(`/admin/worlds/${first.body.worldId}/disable`, { disabled: true })).status, 401);
  assert.equal((await takedown(true)).status, 200);
  assert.equal((await readers.player()).body.world, null, "a taken-down World is served to nobody");
  refused(await owner.send({ type: "campaign.setWorld", worldVersionId: first.body.versionId }), "worldTakenDown");
  assert.equal((await me.get(`/worlds/${first.body.worldId}/export`)).status, 403);
  const reimport = await me.post<WorldReply>("/worlds", { ...SAMPLE_WORLD, version: "0.3.0" });
  assert.equal(reimport.status, 422);
  assert.match(reimport.body.problems?.[0]?.message ?? "", /taken down/);
  const events = (await (await get("/admin/events", ADMIN)).json()) as { action: string; targetUserId: string }[];
  assert.ok(events.some((e) => e.action === "world.disable" && e.targetUserId === uid("wd-owner")));
  assert.equal((await post(`/admin/worlds/${crypto.randomUUID()}/disable`, { disabled: true }, ADMIN)).status, 404);
  assert.equal((await takedown(false)).status, 200);
  assert.equal((await readers.gm()).body.world?.versionId, second.body.versionId);

  // Hidden while pinned: the room keeps its look, but it can't be pinned again until imported again.
  assert.deepEqual((await me.post(`/worlds/${first.body.worldId}/hide`, {})).body, { deleted: false });
  assert.deepEqual((await me.get<unknown[]>("/worlds")).body, []);
  assert.equal((await readers.gm()).body.world?.versionId, second.body.versionId);
  refused(await owner.send({ type: "campaign.setWorld", worldVersionId: first.body.versionId }), "worldDeleted");
  ok(await owner.send({ type: "campaign.unsetWorld" }));
  assert.deepEqual((await me.post(`/worlds/${first.body.worldId}/hide`, {})).body, { deleted: true });
  assert.equal((await stranger.post(`/worlds/${rival.body.worldId}/hide`, {})).status, 404);
  for (const c of [owner, ana, screen]) c.socket.close();
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

// House decision #51: nothing stored is rewritten, so the room moves only to a version every stored value still fits.
test("campaign.setRuleset: a room whose characters are built moves only to a version their values fit", async () => {
  const { owner, ana, hero, ownerDevice } = await rulesRoom("Pin");
  const post = (over: Partial<typeof FIXTURE_RULESET>) =>
    caller(ownerDevice).post<RulesetReply>("/rulesets", { ...FIXTURE_RULESET, ...over });
  const [character, ...others] = FIXTURE_RULESET.entities;
  assert.ok(character);
  // Lyra is level 3; this version stops at 2.
  const level = { type: "int", label: "Level", min: 1, max: 2, visibility: "party" } as const;
  const tight = await post({
    version: "0.2.0",
    entities: [{ ...character, fields: { ...character.fields, level } }, ...others],
  });
  assert.equal(tight.status, 201);
  refused(
    await owner.send({ type: "campaign.setRuleset", rulesetVersionId: tight.body.versionId }),
    /does not fit what is in play: Lyra: field "level"/,
  );
  // The same rules under a new number: every value fits, and the characters come along with what they had.
  const same = await post({ version: "0.3.0" });
  assert.equal(same.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: same.body.versionId }));
  await resourceOf(owner, hero, "hp", 14);
  refused(await owner.send({ type: "campaign.unpinRuleset" }), "charactersBuilt");
  for (const c of [owner, ana]) c.socket.close();
});

test("campaign.unpinRuleset: a room with no built character goes back to no ruleset", async () => {
  const { owner, ownerDevice } = await newRoom("Unpin");
  await pinFixture({ owner, ownerDevice });
  await owner.until((s) => s.testDefs.length > 0);
  ok(await owner.send({ type: "campaign.unpinRuleset" }));
  await owner.until((s) => s.testDefs.length === 0);
  owner.socket.close();
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
  // Half built (no level, which the vigour formula reads): the refusal names what is missing, not "isn't built".
  const half = ok(await owner.send({ type: "actor.create", kind: "npc", name: "Half" })).id!;
  await equip(half, "character", { fields: { "attr.con": 10, "attr.dex": 14, diary: "" } });
  refused(await owner.send(call({ actorIds: [half] })), /Half's sheet is missing something.*\(Level\)/);
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
  assert.deepEqual((await owner.until(() => true)).testDefs.map((d) => d.id).toSorted(), ["check", "gambit", "skill"]);

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
  assert.deepEqual(defs.map((d) => d.id).toSorted(), ["check", "gambit", "skill"]);
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

test("a reported Test: the table works it out, the phone picks a listed outcome, the server only records it", async () => {
  const { owner, ana, ben, campaignId, hero, bram, call } = await testRoom("TestReported");
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const outcome = (callId: string, actorId: string, id: string) =>
    ({ type: "test.report", callId, actorId, outcome: id }) as ActionInput;
  const reportedCall = (over: Record<string, unknown> = {}) =>
    call({ testId: "gambit", inputs: {}, hideTarget: false, ...over });

  // The form reads the list; the call carries no number.
  const def = (await owner.until(() => true)).testDefs.find((d) => d.id === "gambit")!;
  assert.deepEqual(
    def.outcomes?.map((o) => o.label),
    ["Clean", "Costly", "Missed"],
  );
  const id = ok(await owner.send(reportedCall())).id!;
  const gm = callIn(await owner.until((s) => callIn(s, id) !== undefined), id)!;
  assert.deepEqual(gm.targets.map((t) => [t.modifier, t.target]).flat(), [0, 0, 0, 0]);

  // A phone gets the list, no number, and may report only its own character, once, with a listed id.
  const anaCall = callIn(await ana.until((s) => callIn(s, id) !== undefined), id)!;
  assert.equal(anaCall.showTarget, false);
  assert.deepEqual(
    anaCall.outcomes?.map((o) => o.id),
    ["clean", "costly", "missed"],
  );
  refused(await ana.send(outcome(id, hero, "stellar")), "unknownOutcome");
  refused(await ana.send(outcome(id, bram, "clean")), "notYourCharacter");
  refused(await ana.send(report(id, hero, [12])), "testTakesOutcome");
  refused(
    await ana.send({ ...outcome(id, hero, "clean"), roll: { kind: "faces", faces: [1] } } as ActionInput),
    /roll or an outcome/,
  );
  ok(await ana.send(outcome(id, hero, "costly")));
  refused(await ana.send(outcome(id, hero, "clean")), "alreadyReported");

  // Ana sees her own label's id; Ben sees nothing of Ana's until the GM reveals.
  const own = callIn(await ana.until((s) => callIn(s, id)?.reported === 1), id)!;
  assert.equal(own.targets[0]?.report?.outcome, "costly");
  assert.deepEqual(
    callIn(await ben.until((s) => callIn(s, id) !== undefined), id)!.targets.map((t) => t.report),
    [null],
  );
  // The GM corrects it; the table screen only counts.
  ok(await owner.send(outcome(id, hero, "clean")));
  ok(await ben.send(outcome(id, bram, "missed")));
  const screenCall = callIn(await screen.until((s) => callIn(s, id)?.reported === 2), id)!;
  assert.deepEqual(screenCall.targets, []);
  assert.deepEqual(
    await query("SELECT actor_id, outcome, total FROM test_report WHERE call_id = $1 ORDER BY outcome", [id]),
    [
      { actor_id: hero, outcome: "clean", total: 0 },
      { actor_id: bram, outcome: "missed", total: 0 },
    ].toSorted((a, b) => a.outcome.localeCompare(b.outcome)),
  );

  // A dice Test takes no outcome.
  const dice = ok(await owner.send(call({ actorIds: [hero] }))).id!;
  refused(await owner.send(outcome(dice, hero, "clean")), "testTakesDice");

  ok(await owner.send({ type: "test.close", callId: id, reveal: true }));
  const shown = callIn(await ben.until((s) => callIn(s, id)?.revealed === true), id)!;
  assert.deepEqual(shown.targets.map((t) => t.report?.outcome).toSorted(), ["clean", "missed"]);
  for (const c of [owner, ana, ben, screen]) c.socket.close();
});

test("degrees of success: the server picks one of four levels; a ruleset with no turn order refuses encounter.start", async () => {
  const { owner, ownerDevice } = await newRoom("Degrees");
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", SAMPLE_NO_ORDER);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
  const hero = ok(await owner.send({ type: "actor.create", kind: "pc", name: "Dara", entityType: "character" })).id!;
  await equip(hero, "character", {
    fields: { level: 1, "attr.con": 10, "attr.dex": 14, guard: 12, diary: "" },
    resources: { hp: 8, focus: 1 },
  });
  ok(await owner.send({ type: "session.start" }));
  refused(await owner.send({ type: "encounter.start" }), "noTurnOrder");

  // Dexterity 14 is +2. Beating the DC by the step (5) is a level up, missing it by the step a level down.
  const call = async (dc: number) =>
    ok(
      await owner.send({
        type: "test.call",
        testId: "ordeal",
        actorIds: [hero],
        inputs: { ability: "dex", dc },
        hideTarget: false,
      }),
    ).id!;
  const reported = async (id: string, faces: number[], want: string) => {
    ok(await owner.send(report(id, hero, faces)));
    await owner.until((s) => callIn(s, id)?.targets[0]?.report?.outcome === want);
  };
  const id = await call(15);
  await reported(id, [18], "criticalSuccess"); // 20 against 15
  await reported(id, [13], "success"); // 15 meets the DC
  await reported(id, [12], "failure"); // 14
  await reported(id, [8], "criticalFailure"); // 10, a step under
  // A natural 20 lifts a failure to a success; a natural 1 drops a success to a failure.
  await reported(id, [20], "criticalSuccess"); // 22 is already a level up; the top holds
  const low = await call(2);
  await reported(low, [1], "failure"); // 3 beats a DC of 2, the natural 1 takes a level
  const high = await call(30);
  await reported(high, [20], "failure"); // 22 is a step under 30, the natural 20 takes it back one level
  assert.deepEqual(await query<{ outcome: string }>("SELECT outcome FROM test_report WHERE call_id = $1", [high]), [
    { outcome: "failure" },
  ]);
  owner.socket.close();
});

// ---- The builder, creatures from packs and builder drafts (docs/p1-plan.md workstream D) ---------------------------
// The sample ruleset (its identity step asks the level, so derived values can be computed), and the sample
// pack with one lineage that only the GM side may pick.

const BUILD_RULESET = structuredClone(SAMPLE_D20);
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

// A room on the d20 sample (its notice rules, house decision #79), a running session, Ana holding Lyra.
async function d20Room(
  name: string,
  ruleset: object = SAMPLE_D20,
  resources: Record<string, number> = { hp: 6, boons: 2, renown: 0 },
) {
  const { owner, ownerDevice, campaignId } = await newRoom(name);
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, `ana-${name}`) } });
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  const rs = await caller(ownerDevice).post<RulesetReply>("/rulesets", ruleset);
  assert.equal(rs.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: rs.body.versionId }));
  await equip(hero, "character", {
    fields: { level: 1, "attr.str": 12, "attr.dex": 12, "attr.con": 10, guard: 1 },
    resources,
  });
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Lyra" }));
  await ana.until((s) => s.actors.find((a) => a.id === hero)?.entity === "character");
  return { owner, ana, campaignId, hero };
}

test("notices: an answer tells its sender who has points as a session starts, who crossed a line, a full pool", async () => {
  const { owner, ana } = await d20Room("Notices");
  const rule = (id: string, text: string) => ({ code: "rule", params: { rule: id, name: "Lyra" }, text });
  const luck = (delta: number) =>
    ({ type: "rule.op", primitive: "resource.capped", op: "adjustPool", input: { resource: "luck", delta } }) as const;

  // Points left are told at every start; the end's refill crosses the top step once, never again while it holds.
  assert.deepEqual(ok(await owner.send({ type: "session.start" })).notices, [
    rule("unspent", "Lyra has boons to spend"),
  ]);
  assert.deepEqual(ok(await owner.send({ type: "session.end", recap: "" })).notices, [
    rule("renowned", "Lyra is renowned"),
  ]);
  assert.deepEqual(ok(await owner.send({ type: "session.start" })).notices, [
    rule("unspent", "Lyra has boons to spend"),
  ]);
  assert.equal(ok(await owner.send({ type: "session.end", recap: "" })).notices, undefined);

  // A pool that cannot take the whole change says how much was lost, to the one seat that sent it.
  ok(await owner.send({ type: "session.start" }));
  assert.deepEqual(ok(await owner.send(luck(5))).notices, [{ code: "poolFull", params: { pool: "Luck", lost: 2 } }]);
  assert.deepEqual(ok(await ana.send(luck(1))).notices, [{ code: "poolFull", params: { pool: "Luck", lost: 1 } }]);
  assert.equal(ok(await owner.send(luck(-1))).notices, undefined);
  // Nothing of it is in the state either seat receives.
  for (const c of [owner, ana])
    assert.equal(JSON.stringify(await c.until(() => true)).includes("Lyra is renowned"), false);
  for (const c of [owner, ana]) c.socket.close();
});

test("offers: a called Test's result offers the GM its changes, applied once, undone whole, never told a phone", async () => {
  const { owner, ana, campaignId, hero } = await d20Room("Offers", SAMPLE_POOL, { hp: 6, tempHp: 0 });
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  ok(await owner.send({ type: "session.start" }));
  const call = async (marks: Record<string, boolean>) =>
    ok(
      await owner.send({
        type: "test.call",
        testId: "skill",
        actorIds: [hero],
        inputs: { ability: "str", dn: 4, bonus: 0, ...marks },
        hideTarget: false,
      }),
    ).id!;
  const report = (callId: string, counts: Record<string, number>, special: number[]) =>
    ({ type: "test.report", callId, actorId: hero, roll: { kind: "pool", counts, special } }) as ActionInput;
  const apply = (callId: string, offerId: string) =>
    ({ type: "test.applyOffer", callId, actorId: hero, offerId }) as ActionInput;
  const offersIn = (s: LiveState, callId: string) =>
    s.tests.find((c) => c.id === callId)?.targets.find((t) => t.actorId === hero)?.offers;
  const shown = (offers: ReturnType<typeof offersIn>) =>
    offers?.map((o) => [o.id, o.changes.map((c) => [c.label, c.by]), o.applied]);
  const pool = (s: LiveState, id: string) => s.pools.find((p) => p.id === id)?.value;

  // The call form reads the mark; a call under it, failed on the phone by 3 with a complication.
  const def = (await owner.until(() => true)).testDefs.find((d) => d.id === "skill")!;
  assert.deepEqual(def.marks, [{ id: "dread", label: "Dread" }]);
  const id = await call({ dread: true });
  refused(await owner.send(apply(id, "shaken")), "notReported");
  ok(await ana.send(report(id, { hit: 1 }, [1])));
  const gm = await owner.until((s) => offersIn(s, id) !== undefined);
  assert.deepEqual(shown(offersIn(gm, id)), [
    ["shaken", [["Menace", 1]], false],
    [
      "strain",
      [
        ["Spare Vigour", 6],
        ["Luck", 1],
      ],
      false,
    ],
  ]);
  // Never on a phone or the table screen.
  assert.equal(offersIn(await ana.until((s) => s.tests.some((c) => c.id === id && c.reported === 1)), id), undefined);
  assert.deepEqual(
    (await screen.until((s) => s.tests.some((c) => c.id === id))).tests.find((c) => c.id === id)?.targets,
    [],
  );
  refused(await ana.send(apply(id, "strain")), "noPermission");
  refused(await owner.send(apply(id, "nope")), "noSuchOffer");

  // Applied once through the ordinary writes; a second tap is refused; the card shows it applied.
  ok(await owner.send(apply(id, "strain")));
  refused(await owner.send(apply(id, "strain")), "offerApplied");
  const after = await owner.until((s) => offersIn(s, id)?.find((o) => o.id === "strain")?.applied === true);
  assert.equal(actorIn(after, hero)?.resources.tempHp, 6);
  assert.equal(pool(after, "luck"), 1);
  // Undo takes both changes back, and the offer is offered again.
  ok(await owner.send({ type: "event.undo" }));
  const undone = await owner.until((s) => offersIn(s, id)?.find((o) => o.id === "strain")?.applied === false);
  assert.deepEqual([actorIn(undone, hero)?.resources.tempHp, pool(undone, "luck")], [0, 0]);

  // A full pool takes what it can, and the answer says what was lost.
  const fill = {
    type: "rule.op",
    primitive: "resource.capped",
    op: "adjustPool",
    input: { resource: "menace", delta: 2 },
  };
  ok(await owner.send(fill as ActionInput));
  assert.deepEqual(ok(await owner.send(apply(id, "shaken"))).notices, [
    { code: "poolFull", params: { pool: "Menace", lost: 1 } },
  ]);

  // Without the mark only the other offer stands; a report changed to a pass offers nothing new.
  const plain = await call({});
  ok(await ana.send(report(plain, { hit: 1 }, [1])));
  refused(await owner.send(apply(plain, "shaken")), "offerNotOffered");
  ok(await owner.send(report(plain, { hit: 3 }, [6])));
  refused(await owner.send(apply(plain, "strain")), "offerNotOffered");
  for (const c of [owner, ana, screen]) c.socket.close();
});

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

test("a chosen pack entry's effects raise the numbers of the actor that chose it, and only that actor", async () => {
  const { owner, ana, ben, campaignId } = await buildRoom("Boons");
  const me = caller(await device("owner-Boons"));
  const boons = await me.post<PackReply>("/packs", SAMPLE_PACK_EFFECTS);
  assert.equal(boons.status, 201);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: boons.body.versionId }));
  const answers = (lineage: string, calling: string) => ({ ...GOOD_ANSWERS, lineage: [lineage], calling: [calling] });
  // Swift Blood adds 2 Grace (a base effect) and Shield Arm adds 3 Defense (a derived one); Ben takes neither.
  ok(await ana.c.send({ type: "actor.build", actorId: ana.held, answers: answers("swift-blood", "shield-arm") }));
  ok(await ben.c.send({ type: "actor.build", actorId: ben.held, answers: answers("reedfolk", "wayfinder") }));
  const defense = (id: string) => (s: LiveState) => actorIn(s, id)?.derived.defense !== undefined;
  const view = await ben.c.until((s) => defense(ana.held)(s) && defense(ben.held)(s));
  assert.equal(actorIn(view, ana.held)?.derived.defense, 3 + 0 + 3); // guard 3, Grace 11 (+0), Shield Arm 3
  assert.equal(actorIn(view, ben.held)?.derived.defense, 3 - 1); // guard 3, Grace 9 (-1)
  assert.equal(actorIn(view, ana.held)?.fields["attr.dex"], 9); // the stored field is the base; the effect is on top
  assert.equal(actorIn(await ana.c.until(defense(ana.held)), ana.held)?.derived.defense, 6);
  // The served entries carry their effects, for the builder's preview.
  const rules = await get(`/campaigns/${campaignId}/rules`, { cookie: await device("owner-Boons") });
  const served = (await rules.json()) as { entries: { key: string; effects: unknown[] }[] };
  assert.equal(served.entries.find((e) => e.key === "shield-arm")?.effects.length, 1);
  assert.equal(served.entries.find((e) => e.key === "reedfolk")?.effects.length, 0);
  for (const c of [owner, ana.c, ben.c]) c.socket.close();
});

// House decision #62: a ruleset picks the ledger builder for one actor type, and its pack's entries carry records.
test("a ledger ruleset imports, and its pack's records reach every seat through /rules in their schema's order", async () => {
  const { owner, ownerDevice, campaignId } = await newRoom("Ledger");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_LEDGER_RULESET);
  assert.equal(rs.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: rs.body.versionId }));

  // A record whose keys arrive in reverse is stored, and served, in its schema's order.
  const reversed = (e: (typeof SAMPLE_LEDGER_PACK.entries)[number]) =>
    e.key === "factions.wardens" ? { ...e, record: Object.fromEntries(Object.entries(e.record ?? {}).reverse()) } : e;
  const gmOnly = { key: "sample-hero", type: "hero", name: "Sample Hero", cite: "Base p.1" }; // no record, gm by default
  const pack = { ...SAMPLE_LEDGER_PACK, entries: [...SAMPLE_LEDGER_PACK.entries.map(reversed), gmOnly] };
  const imported = await me.post<PackReply>("/packs", pack);
  assert.equal(imported.status, 201);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: imported.body.versionId }));
  const anaDevice = await seatPlayer(owner, "ana-ledger");

  const wardens = SAMPLE_LEDGER_PACK.entries.find((e) => e.key === "factions.wardens")?.record;
  const expected = JSON.stringify(buildSchemas(SAMPLE_PARAMS).Faction.parse(wardens));
  for (const [cookie, gm] of [
    [ownerDevice, true],
    [anaDevice, false],
  ] as const) {
    const res = await get(`/campaigns/${campaignId}/rules?limit=500`, { cookie });
    assert.equal(res.status, 200);
    const served = (await res.json()) as { entries: { key: string; record: Record<string, unknown> | null }[] };
    assert.equal(JSON.stringify(served.entries.find((e) => e.key === "factions.wardens")?.record), expected);
    assert.equal(served.entries.filter((e) => e.record !== null).length, SAMPLE_LEDGER_PACK.entries.length);
    const hero = served.entries.find((e) => e.key === "sample-hero");
    assert.equal(hero !== undefined, gm, "a gm entry reaches the GM side only");
    if (hero !== undefined) assert.equal(hero.record, null);
  }

  // A record that names another entry is refused with its path.
  const [first, ...rest] = SAMPLE_LEDGER_PACK.entries;
  assert.ok(first?.record !== undefined);
  const misnamed = { ...first, record: { ...first.record, name: "Someone Else" } };
  const bad = await me.post<PackReply>("/packs", {
    ...SAMPLE_LEDGER_PACK,
    version: "0.2.0",
    entries: [misnamed, ...rest],
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.problems?.some((p) => p.path === "entries[0].record.name"));
  owner.socket.close();
});

// House decision #63: the server resolves a ledger build against the room's catalogue, saves the ready one, writes its
// numbers as fields, and sends the build and the sheet to the GM side and the character's seat.
test("build.save: a player reads the catalogue and saves a ledger build, which only the GM and that player receive", async () => {
  const ownerDevice = await device("owner-LedgerSave");
  const me = caller(ownerDevice);
  // A derived number from the saved fields, so the seat view shows the build at work.
  const ruleset = structuredClone(SAMPLE_LEDGER_RULESET);
  ruleset.entities[0]!.derived = [
    {
      id: "toughness",
      label: "Toughness",
      expr: "attr.mgt * 10 + skill.lore + armourRating",
      visibility: "party" as const,
      cite: "Base p.1",
    },
  ];
  const rs = await me.post<RulesetReply>("/rulesets", ruleset);
  const pk = await me.post<PackReply>("/packs", SAMPLE_LEDGER_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const { campaignId } = (
    await me.post<{ campaignId: string }>("/campaigns", { name: "LedgerSave", rulesetVersionId: rs.body.versionId })
  ).body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const seated = async (name: string) => {
    const cookie = await seatPlayer(owner, name);
    const s = await owner.until((x) => x.access.members.some((m) => m.userId === uid(name)));
    const held = s.access.members.find((m) => m.userId === uid(name))!.characterIds[0]!;
    const c = connect({ auth: { campaignId, cookie } });
    await c.until((x) => x.actors.some((a) => a.id === held));
    return { c, cookie, held };
  };
  const ana = await seated("ana-ledger-save");
  const ben = await seated("ben-ledger-save");

  // The catalogue, for any seat: every kind, the records in their schema's key order. Nobody without a seat.
  const read = await get(`/campaigns/${campaignId}/catalogue`, cookieOf(ana.cookie));
  assert.equal(read.status, 200);
  const catalogue = (await read.json()) as {
    params: { tiers: { min: number; max: number } };
    kinds: Record<string, { id: string }[]>;
    wargear: { id: string }[];
  };
  assert.equal(Object.keys(catalogue.kinds).length, 12);
  assert.deepEqual(catalogue.params.tiers, { min: 1, max: 4 });
  const records = SAMPLE_LEDGER_PACK.entries.filter((e) => e.type !== "wargear");
  assert.equal(Object.values(catalogue.kinds).flat().length, records.length);
  assert.equal(catalogue.wargear.length, SAMPLE_LEDGER_PACK.entries.length - records.length);
  const wardens = SAMPLE_LEDGER_PACK.entries.find((e) => e.key === "factions.wardens")?.record;
  assert.equal(
    JSON.stringify(catalogue.kinds.factions?.find((f) => f.id === "wardens")),
    JSON.stringify(buildSchemas(SAMPLE_PARAMS).Faction.parse(wardens)),
  );
  assert.equal((await get(`/campaigns/${campaignId}/catalogue`)).status, 401);
  const bare = await newRoom("LedgerBare");
  const none = await get(`/campaigns/${bare.campaignId}/catalogue`, cookieOf(bare.ownerDevice));
  assert.equal(none.status, 404);
  assert.equal(((await none.json()) as { code: string }).code, "noRuleset");
  bare.owner.socket.close();

  // A build with choices still to make is refused, saying what is missing; another player's character too.
  const save = (actorId: string, build: unknown) =>
    ({ type: "build.save", actorId, build: JSON.stringify(build) }) as const;
  const notReady = await ana.c.send(save(ana.held, { tier: 1, archetypeId: "lamplighter" }));
  refused(notReady, "buildNotReady");
  assert.match(notReady.ok ? "" : notReady.error, /background: Choose a Background table/);
  assert.match(notReady.ok ? "" : notReady.error, /needs Lore 3 \(for the GM to approve\)/);
  refused(await ana.c.send(save(ana.held, { tier: 2, archetypeId: "lamplighter" })), "buildTierMismatch");
  refused(await ana.c.send({ type: "build.save", actorId: ana.held, build: "{" }), "buildInvalid");
  // The unfinished build is sent to the GM as a draft: stored unresolved, nothing of the character written.
  ok(await ana.c.send({ ...save(ana.held, { tier: 1, archetypeId: "lamplighter" }), draft: true }));
  const drafted = actorIn(await owner.until((x) => actorIn(x, ana.held)?.ledger?.draft != null), ana.held);
  assert.equal(
    JSON.stringify(drafted?.ledger),
    '{"build":null,"sheet":null,"draft":{"tier":1,"archetypeId":"lamplighter","gm":{}},' +
      '"xpSpent":0,"xpAtAscension":0,"packageWaived":false}',
  );
  assert.equal(drafted?.entity, "");

  // A ready build, its keys in an order of their own: saved, and sent back in that order.
  const dream = {
    skills: { Lore: 3, Brawl: 1 },
    tier: 1,
    archetypeId: "lamplighter",
    fills: { "[GUILD]": { id: "ironhand" } },
    background: {
      tableId: "warden-roots",
      roots: "Lowland",
      deed: "Held the Gate",
      dream: "A Quiet Hearth",
      bonus: "dream",
    },
    languages: { picks: ["trade-tongue"] },
    wealth: 1,
  };
  refused(await ben.c.send(save(ana.held, dream)), "notYourCharacter");
  ok(await ana.c.send(save(ana.held, dream)));
  const saved = JSON.stringify({ ...dream, gm: {} }); // a player's save takes the GM's part, none yet
  for (const c of [ana.c, owner]) {
    const s = await c.until((x) => actorIn(x, ana.held)?.ledger?.build != null);
    const hero = actorIn(s, ana.held)!;
    assert.equal(JSON.stringify(hero.ledger?.build), saved);
    assert.equal(hero.ledger?.sheet?.species, "Heron-kin");
    assert.equal(hero.ledger?.draft, null); // a ready save clears the draft
    assert.equal(hero.entity, "hero");
    assert.equal(hero.fields["attr.mgt"], 2);
    assert.equal(hero.derived.toughness, 2 * 10 + 3 + 2);
    // Wealth starts at the sheet's value; the ruleset leaves it at the default visibility, gm.
    assert.equal(hero.resources.wealth, c === owner ? 3 : undefined);
  }
  // Ben sees Ana's hero by name and its party numbers, never the build.
  const benSees = actorIn(await ben.c.until((x) => actorIn(x, ana.held)?.derived.toughness === 25), ana.held);
  assert.equal(benSees?.ledger, null);

  // In play (house decision #64). A session's end gives XP, up to the ruleset's max.
  ok(await owner.send({ type: "session.start" }));
  refused(await owner.send({ type: "session.end", award: 51 }), "awardTooHigh");
  ok(await owner.send({ type: "session.end", award: 10 }));
  await ana.c.until((x) => actorIn(x, ana.held)?.fields.xp === 10);
  // The player buys a rating with it, stamped with that session; a creation change or another Tier is refused.
  const bought = { ...dream, advancement: { skills: { Brawl: 2 }, boughtIn: { "made/up": 9 } } };
  ok(await ana.c.send(save(ana.held, bought)));
  refused(await ana.c.send(save(ana.held, { ...bought, wealth: 0 })), "creationLocked");
  refused(await ana.c.send(save(ana.held, { ...bought, tier: 2 })), "buildMadeAtTier");
  const inPlay = actorIn(await ana.c.until((x) => actorIn(x, ana.held)?.fields["skill.brawl"] === 2), ana.held);
  assert.deepEqual(inPlay?.ledger?.build?.advancement, {
    skills: { Brawl: 2 },
    boughtIn: { "advance/skill/Brawl/2": 1 },
  });
  assert.equal(inPlay?.ledger?.xpSpent, 3);
  // The group Ascends at the GM's word: a player may not, nor may the GM by experience before the XP is earned.
  refused(await ana.c.send({ type: "build.ascend", kind: "milestone" }), "noPermission");
  refused(await owner.send({ type: "build.ascend", kind: "experience" }), "ascensionShort");
  ok(await owner.send({ type: "build.ascend", kind: "milestone", waivePackage: true }));
  for (const c of [owner, ana.c]) {
    const s = await c.until(
      (x) => x.campaign.fields.tier === 2 && actorIn(x, ana.held)?.ledger?.packageWaived === true,
    );
    const hero = actorIn(s, ana.held)!;
    assert.equal(hero.fields.xp, 30);
    assert.deepEqual([hero.ledger?.xpSpent, hero.ledger?.xpAtAscension], [3, 30]);
  }
  // The waived package lets the next purchase through at the new Tier.
  ok(await ana.c.send(save(ana.held, { ...bought, advancement: { skills: { Brawl: 3 } } })));
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

test("actor.spawn: without a GM nobody places a gm entry, and the refusal does not tell it exists", async () => {
  const ownerDevice = await device("owner-SpawnNoGm");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", {
    ...BUILD_RULESET,
    game: { title: "Sample Table", players: { min: 1, max: 4 }, modes: ["gm", "gmless"], cite: "Sample p.1" },
  });
  const pk = await me.post<PackReply>("/packs", BUILD_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "SpawnNoGm",
    rulesetVersionId: rs.body.versionId,
    tableMode: "gmless",
  });
  const owner = connect({ auth: { campaignId: made.body.campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const spawn = (key: string) =>
    ({ type: "actor.spawn", packVersionId: pk.body.versionId, key, count: 1 }) as ActionInput;
  // ember-wisp is a gm entry: refused exactly as a key the pack lacks.
  refused(await owner.send(spawn("ember-wisp")), "entryNotInPack");
  refused(await owner.send(spawn("no-such-key")), "entryNotInPack");
  owner.socket.close();
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
  refused(await owner.send(spawn({ count: 51 })), /too big|<=50|50/);
  refused(await owner.send(spawn({ count: 0 })), /too small|>=1|1/);
  refused(await owner.send(spawn({ name: " " })), "badRequest");
  refused(await owner.send(spawn({ name: "x".repeat(81) })), "badRequest");
  refused(await owner.send(spawn({ visibility: "stats" })), "badRequest");

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

  // A name in the entry's place, numbered the same way; fifty at once (house decision #75).
  ok(await owner.send(spawn({ count: 2, name: " Cinder " })));
  ok(await owner.send(spawn({ count: 50 })));
  const named = await owner.until((x) => x.actors.filter((a) => a.kind === "creature").length === 57);
  const names = named.actors.map((a) => a.name);
  assert.ok(["Cinder 1", "Cinder 2", "Ember Wisp 6", "Ember Wisp 55"].every((n) => names.includes(n)));

  // One alone under a name takes it bare; once that name is carried, the next is numbered after the highest; one
  // without a name is numbered as before (house decision #78).
  ok(await owner.send(spawn({ count: 1, name: "Brute" })));
  ok(await owner.send(spawn({ count: 1, name: "Brute" })));
  ok(await owner.send(spawn({ count: 1, name: "Cinder" })));
  ok(await owner.send(spawn({ count: 1, name: "Cinder" })));
  ok(await owner.send(spawn({ count: 1 })));
  const lone = await owner.until((x) => x.actors.filter((a) => a.kind === "creature").length === 62);
  const loneNames = lone.actors.map((a) => a.name);
  assert.ok(
    ["Brute", "Brute 1", "Cinder", "Cinder 3", "Ember Wisp 56"].every((n) => loneNames.includes(n)),
    loneNames.join(", "),
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
  // The GM's mark stays home; a combatant's conditions are the ones the ruleset lets the table see (#67): every one
  // the GM reads here but `marked`, which is `gm`.
  assert.ok(enc.combatants.every((c) => !c.keep));
  const gmSide = (await owner.until((x) => x.stateVersion >= seen.stateVersion)).encounter!;
  for (const c of enc.combatants) {
    const all = gmSide.combatants.find((x) => x.id === c.id)!.conditions;
    assert.deepEqual(
      c.conditions,
      all.filter((x) => x.id !== "marked"),
    );
  }
  assert.ok(enc.combatants.some((c) => c.conditions.length > 0));
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
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", { ...SAMPLE_HARVEST, phases: undefined });
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

test("encounter: phases run a simultaneous plan phase on the phones, then act in turn; the GM moves on without waiting", async () => {
  const { owner, ownerDevice, campaignId } = await newRoom("Phases");
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", SAMPLE_HARVEST);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
  const actors: string[] = [];
  for (const name of ["Ana", "Ben", "Cy"])
    actors.push(ok(await owner.send({ type: "actor.create", kind: "pc", name, entityType: "player" })).id!);
  // Three phones, one character each.
  const phones = [];
  for (const actorId of actors) {
    const token = ok(await owner.send({ type: "token.issue", actorId })).token!;
    const phone = connect({ auth: { campaignId, token } });
    await phone.until((s) => s.actors.some((x) => x.id === actorId));
    phones.push(phone);
  }
  const [p1, p2, p3] = phones as [(typeof phones)[0], (typeof phones)[0], (typeof phones)[0]];
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: actors, side: "party", visibility: "full" }));
  const seated = await owner.until((s) => s.encounter?.combatants.length === 3 && s.encounter.firstId !== null);
  const [a, b, c] = seated.encounter!.combatants.map((x) => x.id) as [string, string, string];
  const at = (s: LiveState) =>
    [
      s.encounter?.round,
      s.encounter?.phaseId,
      s.encounter?.currentId,
      s.encounter?.firstId,
      s.encounter?.done.join(""),
    ].join("/");
  const want = (value: string) => owner.until((s) => at(s) === value);
  assert.equal(at(seated), `1/plan//${a}/`);

  // Plan: each phone marks its own character; another's is refused, and so is marking twice.
  refused(await p1.send({ type: "phase.done", actorId: actors[1]! }), "notYourCharacter");
  ok(await p1.send({ type: "phase.done", actorId: actors[0]! }));
  refused(await p1.send({ type: "phase.done", actorId: actors[0]! }), "alreadyDone");
  await want(`1/plan//${a}/${a}`);
  ok(await p2.send({ type: "phase.done", actorId: actors[1]! }));
  await want(`1/plan//${a}/${a}${b}`);
  // Back is refused in a phase played at once.
  refused(await owner.send({ type: "turn.prev" }), "phaseStart");

  // The last one done moves the phase on in the same step; act starts from the first player.
  const auto = ok(await p3.send({ type: "phase.done", actorId: actors[2]! })).id!;
  await want(`1/act/${a}/${a}/`);
  refused(await p3.send({ type: "phase.done", actorId: actors[2]! }), "notSimultaneous");

  // One Undo takes the automatic phase change back, `done` included.
  assert.equal(ok(await owner.send({ type: "event.undo" })).id, auto);
  await want(`1/plan//${a}/${a}${b}`);
  ok(await p3.send({ type: "phase.done", actorId: actors[2]! }));
  await want(`1/act/${a}/${a}/`);

  // Act in turn; the end of the last turn of the last phase wraps the round and opens plan, first player moved on.
  refused(await owner.send({ type: "turn.prev" }), "phaseStart");
  for (const [who, next] of [
    [a, b],
    [b, c],
  ] as const) {
    ok(await owner.send({ type: "turn.next" }));
    await want(`1/act/${next}/${a}/`);
    assert.ok(who);
  }
  ok(await owner.send({ type: "turn.next" }));
  await want(`2/plan//${b}/`);

  // Round 2: one seat never marks; the GM moves on without waiting, and act starts from the new first player.
  ok(await p2.send({ type: "phase.done", actorId: actors[1]! }));
  await want(`2/plan//${b}/${b}`);
  ok(await owner.send({ type: "turn.next" }));
  await want(`2/act/${b}/${b}/`);

  // The last of the round's sequence (a) leaves while acting: the round wraps into plan, as the end of their turn would.
  ok(await owner.send({ type: "turn.next" }));
  ok(await owner.send({ type: "turn.next" }));
  await want(`2/act/${a}/${b}/`);
  ok(await owner.send({ type: "encounter.remove", combatantId: a }));
  await want(`3/plan//${c}/`);
  for (const s of [owner, ...phones]) s.socket.close();
});

test("game end: endMet reaches every seat, game.end ranks and closes, result.set re-ranks, one room's results are its own", async () => {
  const { owner, ownerDevice, campaignId } = await newRoom("Scoring");
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", SAMPLE_HARVEST);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
  const actors: string[] = [];
  for (const name of ["Ana", "Ben", "Cy"])
    actors.push(ok(await owner.send({ type: "actor.create", kind: "pc", name, entityType: "player" })).id!);
  const [ana, ben, cy] = actors as [string, string, string];
  // A typed actor starts with its resources (#23); only the name field is seeded here.
  for (const id of actors) await equip(id, "player", { fields: { name: "x" } });
  const phoneToken = ok(await owner.send({ type: "token.issue", actorId: ana })).token!;
  const phone = connect({ auth: { campaignId, token: phoneToken } });
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await phone.until((s) => s.actors.some((x) => x.id === ana));
  await tv.until(() => true);
  const give = async (who: string, resource: string, delta: number) => {
    if (delta !== 0) ok(await owner.send(adjust(who, resource, delta)));
  };
  const startGame = async () => {
    ok(await owner.send({ type: "encounter.start" }));
    ok(await owner.send({ type: "encounter.add", actorIds: actors, side: "party", visibility: "full" }));
    await owner.until((s) => s.encounter?.combatants.length === 3);
  };

  ok(await owner.send({ type: "session.start" }));
  // No encounter: nothing to end. A player cannot end a game.
  refused(await owner.send({ type: "game.end" }), "noEncounterRunning");
  await startGame();
  refused(await phone.send({ type: "game.end" }), "noPermission");

  // Game 1: Ana and Ben tie on 5 points, and the coin tiebreak puts Ben first.
  await give(ana, "vp", 5);
  await give(ben, "vp", 4);
  await give(ben, "coin", 3);
  await give(cy, "vp", 1);
  // Four rounds of plan (moved on without waiting) and act (three turns).
  for (let i = 0; i < 16; i++) ok(await owner.send({ type: "turn.next" }));
  const round = (r: number) => (s: LiveState) => s.encounter?.round === r;
  assert.deepEqual((await owner.until(round(5))).encounter!.endMet, [0]);
  assert.deepEqual((await phone.until(round(5))).encounter!.endMet, [0]);
  const five = await tv.until(round(5));
  assert.deepEqual(five.encounter!.endMet, [0]);
  // Nothing is ended for them: no result is sent while the game runs.
  assert.deepEqual(five.games, []);

  ok(await owner.send({ type: "game.end" }));
  const after = await tv.until((s) => s.encounter === null && s.games.length === 1);
  const rows = (s: LiveState) => s.games[0]!.rows.map((r) => [r.name, r.score, r.tiebreaks.join(), r.place, r.outcome]);
  assert.deepEqual(rows(after), [
    ["Ben", 5, "3", 1, null],
    ["Ana", 5, "0", 2, null],
    ["Cy", 1, "0", 3, null],
  ]);
  assert.equal(after.games[0]!.endedEarly, false);
  assert.equal(after.games[0]!.mode, "compete");
  assert.deepEqual(rows(await phone.until((s) => s.games.length === 1)), rows(after), "a phone is sent the same");
  const stored = await query<{ n: number }>("SELECT count(*)::int AS n FROM session_result WHERE campaign_id = $1", [
    campaignId,
  ]);
  assert.equal(stored[0]!.n, 3);
  refused(await owner.send({ type: "game.end" }), "noEncounterRunning");

  // Another room cannot touch this room's result, and a player cannot correct one.
  const benResult = after.games[0]!.rows[0]!.resultId;
  const cyResult = after.games[0]!.rows[2]!.resultId;
  const other = await newRoom("ScoringOther");
  refused(await other.owner.send({ type: "result.set", resultId: benResult, score: 99 }), "resultNotFound");
  refused(await phone.send({ type: "result.set", resultId: benResult, score: 99 }), "noPermission");

  // The table corrects Cy's score; the whole game ranks again.
  ok(await owner.send({ type: "result.set", resultId: cyResult, score: 9 }));
  const fixed = await tv.until((s) => s.games[0]?.rows.some((r) => r.name === "Cy" && r.score === 9) === true);
  assert.deepEqual(rows(fixed), [
    ["Cy", 9, "0", 1, null],
    ["Ben", 5, "3", 2, null],
    ["Ana", 5, "0", 3, null],
  ]);

  // Game 2 ends at once, with no trigger met; Ana and Ben tie on every value and share first place (1, 1, 3).
  await startGame();
  await give(ana, "coin", 3);
  await give(ben, "vp", 1);
  ok(await owner.send({ type: "game.end" }));
  const two = await tv.until((s) => s.encounter === null && s.games.length === 2);
  assert.equal(two.games[0]!.endedEarly, true);
  assert.deepEqual(
    two.games[0]!.rows.map((r) => [r.name, r.place]),
    [
      ["Ana", 1],
      ["Ben", 1],
      ["Cy", 3],
    ],
  );
  assert.equal(two.games[1]!.rows.length, 3, "the first game is kept");

  // A ruleset with no scoring cannot end a game.
  const bare = await newRoom("Unscored");
  const noScore = await caller(bare.ownerDevice).post<RulesetReply>("/rulesets", {
    ...SAMPLE_HARVEST,
    scoring: undefined,
    phases: undefined,
  });
  assert.equal(noScore.status, 201);
  ok(await bare.owner.send({ type: "campaign.setRuleset", rulesetVersionId: noScore.body.versionId }));
  const solo = ok(await bare.owner.send({ type: "actor.create", kind: "pc", name: "Dee", entityType: "player" })).id!;
  ok(await bare.owner.send({ type: "session.start" }));
  ok(await bare.owner.send({ type: "encounter.start" }));
  ok(await bare.owner.send({ type: "encounter.add", actorIds: [solo], side: "party", visibility: "full" }));
  refused(await bare.owner.send({ type: "game.end" }), "noScoring");
  for (const s of [owner, phone, tv, other.owner, bare.owner]) s.socket.close();
});

// The fixture, played with a GM, without one or alone (a cite for the rule, as outside homebrew the validator wants).
const NO_GM_RULESET = {
  ...FIXTURE_RULESET,
  id: "api-fixture-nogm",
  game: {
    title: "Fixture Table",
    players: { min: 1, max: 4 },
    modes: ["gm", "gmless", "solo"],
    cite: "Fixture p.9",
  },
} as typeof FIXTURE_RULESET;

test("a room without a GM: players run the table, nothing is kept for a GM, undo is yours or the owner's", async () => {
  const ownerDevice = await device("owner-NoGm");
  const plain = await caller(ownerDevice).post<RulesetReply>("/rulesets", FIXTURE_RULESET);
  const nogm = await caller(ownerDevice).post<RulesetReply>("/rulesets", NO_GM_RULESET);
  assert.equal(nogm.status, 201);
  // A game played with a GM only can't be run any other way, at creation or after.
  const bad = await post(
    "/campaigns",
    { name: "NoGm", rulesetVersionId: plain.body.versionId, tableMode: "gmless" },
    cookieOf(ownerDevice),
  );
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, "modeNotPlayed");

  const res = await post(
    "/campaigns",
    { name: "NoGm", rulesetVersionId: nogm.body.versionId, tableMode: "gmless" },
    cookieOf(ownerDevice),
  );
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  assert.equal((await owner.until((s) => s.campaign.name === "NoGm")).campaign.tableMode, "gmless");
  const me = (await (await get(`/campaigns/${campaignId}/me`, cookieOf(ownerDevice))).json()) as {
    tableMode: string;
    seat: { role: string };
  };
  assert.deepEqual([me.tableMode, me.seat.role], ["gmless", "player"], "the owner sits as a player");

  const anaDevice = await seatPlayer(owner, "ana-NoGm");
  const benDevice = await seatPlayer(owner, "ben-NoGm");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const ben = connect({ auth: { campaignId, cookie: benDevice } });
  const members = (await owner.until((s) => s.access.members.length === 3)).access.members;
  const heroOf = (name: string) => members.find((m) => m.userId === uid(`${name}-NoGm`))!.characterIds[0]!;
  const [lyra, bram] = [heroOf("ana"), heroOf("ben")];
  for (const [id, level] of [
    [lyra, 3],
    [bram, 1],
  ] as const) {
    await equip(id, "character", {
      fields: { level, "attr.con": 10, "attr.dex": 12, diary: "" },
      resources: { hp: 8, tempHp: 5 },
    });
  }
  ok(await ana.send({ type: "actor.rename", id: lyra, name: "Lyra" }));
  await ben.until((s) => s.actors.find((a) => a.id === lyra)?.entity === "character");

  // No GM seats: not by appointment, not by invite.
  refused(await owner.send({ type: "member.appoint", userId: uid("ana-NoGm"), role: "gm" }), "noGmSeats");
  refused(await owner.send({ type: "invite.create", mode: "room", role: "cogm", allowGuests: false }), "noGmSeats");

  // Any seat starts the session; any seat calls a Test for a character, and its target is shown, never hidden.
  ok(await ana.send({ type: "session.start" }));
  const check = (over: Record<string, unknown> = {}) =>
    ({
      type: "test.call",
      testId: "check",
      actorIds: [bram],
      inputs: { ability: "dex", dc: 12 },
      ...over,
    }) as ActionInput;
  refused(await ana.send(check({ hideTarget: true })), "testTargetShown");
  const id = ok(await ana.send(check())).id!;
  const benCall = callIn(await ben.until((s) => callIn(s, id) !== undefined), id)!;
  assert.deepEqual(
    [benCall.showTarget, benCall.targets[0]?.target, benCall.secretInputs],
    [true, 12, []],
    "the called player sees the target",
  );
  const lyraSees = callIn(await ana.until((s) => callIn(s, id) !== undefined), id)!;
  assert.equal(lyraSees.targets[0]?.target, 12, "and so does the caller, who holds another character");
  // The permission to call is not the permission to report for someone else.
  refused(
    await ana.send({ type: "test.report", callId: id, actorId: bram, roll: { kind: "faces", faces: [11] } }),
    "notYourCharacter",
  );
  ok(await ben.send({ type: "test.report", callId: id, actorId: bram, roll: { kind: "faces", faces: [11] } }));

  // Nothing is GM-only: a new entry is the party's, and revealing one to the GM is refused.
  const entry = ok(await ana.send({ type: "codex.save", kind: "npc", title: "The Warden" })).id!;
  refused(await ana.send({ type: "codex.save", id: entry, kind: "npc", gmNotes: "x" }), "needSecretsScope");
  await eventually(() => (ben.codex()?.entries.length ?? 0) > 0, "the entry to reach Ben");
  assert.equal(ben.codex()!.entries[0]!.visibility, "party");
  refused(await ana.send({ type: "codex.reveal", id: entry, visibility: "gm", audienceMode: "all" }), "noGmHere");
  assert.equal(
    ben.codex()!.entries.every((e) => e.visibility !== "gm" && e.gmNotes === ""),
    true,
  );

  // Two steps, Ana's then Ben's: each undoes their own, the owner undoes anyone's.
  ok(await ana.send({ type: "request.send", actorId: lyra, resourceId: "tempHp", amount: 2 }));
  ok(await ben.send({ type: "request.send", actorId: bram, resourceId: "tempHp", amount: 1 }));
  await owner.until((s) => s.actors.find((a) => a.id === bram)?.resources.tempHp === 4);
  assert.equal((await ana.until((s) => s.requests.length === 0)).requests.length, 0, "nothing is queued: it applied");
  refused(await ana.send({ type: "event.undo" }), "undoOthers");
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => s.actors.find((a) => a.id === bram)?.resources.tempHp === 5);
  ok(await ana.send({ type: "event.undo" }));
  await owner.until((s) => s.actors.find((a) => a.id === lyra)?.resources.tempHp === 5);
  refused(await ben.send({ type: "event.undo" }), /Nothing to undo/);

  // How the table sits changes between sessions, by the owner only; it kicks every seat so each resolves again.
  refused(await owner.send({ type: "campaign.setTableMode", mode: "gm" }), "changeBetweenSessions");
  ok(await ben.send({ type: "session.end" }));
  refused(await ana.send({ type: "campaign.setTableMode", mode: "gm" }), "noPermission");
  refused(await owner.send({ type: "campaign.setTableMode", mode: "solo" }), "soloOneSeat");
  ok(await owner.send({ type: "campaign.setTableMode", mode: "gm" }));
  await eventually(() => !owner.socket.connected, "the owner's socket to be dropped");
  const back = (await (await get(`/campaigns/${campaignId}/me`, cookieOf(ownerDevice))).json()) as {
    tableMode: string;
    seat: { role: string };
  };
  assert.deepEqual([back.tableMode, back.seat.role], ["gm", "gm"], "back with a GM, the owner is the GM");
  for (const c of [ana, ben]) c.socket.close();
});

// Freeform comes from the web as a constant and is imported into the owner's own library; a GM-less room runs on it.
test("Freeform: imported once into the library, listed with its game block, a GM-less room reports a Check as Partial", async () => {
  const ownerDevice = await device("owner-Freeform");
  const me = caller(ownerDevice);
  const first = await me.post<RulesetReply>("/rulesets", FREEFORM);
  assert.equal(first.status, 201);
  const again = await me.post<RulesetReply>("/rulesets", FREEFORM);
  assert.deepEqual([again.body.unchanged, again.body.versionId], [true, first.body.versionId], "once");
  const listed =
    await me.get<{ slug: string; versions: { id: string; modes: string[]; game: unknown }[] }[]>("/rulesets");
  assert.deepEqual(
    listed.body.map((r) => r.slug),
    ["freeform"],
  );
  assert.deepEqual(listed.body[0]!.versions[0]!.modes, ["gm", "gmless", "solo"]);
  assert.deepEqual(listed.body[0]!.versions[0]!.game, {
    title: "Freeform",
    genres: [],
    players: { min: 1, max: 12 },
  });

  const res = await post(
    "/campaigns",
    { name: "Freeform", rulesetVersionId: first.body.versionId, tableMode: "gmless" },
    cookieOf(ownerDevice),
  );
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  const anaDevice = await seatPlayer(owner, "ana-Freeform");
  const ana = connect({ auth: { campaignId, cookie: anaDevice } });
  const members = (await owner.until((s) => s.access.members.length === 2)).access.members;
  const hero = members.find((m) => m.userId === uid("ana-Freeform"))!.characterIds[0]!;
  await equip(hero, "character", { resources: { health: 10 } });
  ok(await owner.send({ type: "session.start" }));
  const id = ok(
    await owner.send({ type: "test.call", testId: "check", actorIds: [hero], inputs: {}, hideTarget: false }),
  ).id!;
  ok(await ana.send({ type: "test.report", callId: id, actorId: hero, outcome: "partial" }));
  assert.deepEqual(await query("SELECT outcome FROM test_report WHERE call_id = $1", [id]), [{ outcome: "partial" }]);
  for (const c of [owner, ana]) c.socket.close();
});

// Session Zero: lines and veils, and the anonymous X-Card.
const hearXCard = (c: ReturnType<typeof connect>) => {
  const payloads: unknown[] = [];
  c.socket.on("safety:xcard", (p: unknown) => payloads.push(p));
  return payloads;
};
const settle = () => new Promise((r) => setTimeout(r, 300));
const countOf = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0]!.n;

test("lines and veils: the GM sets them, a player suggests one without a name, every seat reads them", async () => {
  const { owner, campaignId } = await newRoom("Safety");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Safety") } });
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await ana.until(() => true);
  const fresh = (await owner.until(() => true)).campaign.safety;
  assert.deepEqual(fresh, { lines: [], veils: [], xCard: true });

  refused(await ana.send({ type: "campaign.setSafety", lines: ["x"], veils: [], xCard: true }), "noPermission");
  ok(await owner.send({ type: "campaign.setSafety", lines: [" Line one "], veils: [], xCard: true }));
  ok(await ana.send({ type: "safety.suggest", kind: "veil", text: "Veil one" }));
  refused(await owner.send({ type: "safety.suggest", kind: "veil", text: "x" }), "noPermission");
  refused(await tv.send({ type: "safety.suggest", kind: "veil", text: "x" }), "screenReadOnly");
  for (const c of [owner, ana, tv]) {
    const s = await c.until((x) => x.campaign.safety.veils.length === 1);
    assert.deepEqual(s.campaign.safety, { lines: ["Line one"], veils: ["Veil one"], xCard: true });
  }
  // Nothing stored says who suggested it.
  const [row] = await query("SELECT safety::text AS s FROM campaign WHERE id = $1", [campaignId]);
  assert.ok(!(row!.s as string).includes(uid("ana-Safety")));
  for (const c of [owner, ana, tv]) c.socket.close();
});

test("the X-Card reaches the GM and the screen, never the other player, and leaves no trace", async () => {
  const { owner, campaignId } = await newRoom("XCard");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-XCard") } });
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ben-XCard") } });
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await Promise.all([ana.until(() => true), ben.until(() => true), tv.until(() => true)]);
  const heard = { owner: hearXCard(owner), ana: hearXCard(ana), ben: hearXCard(ben), tv: hearXCard(tv) };
  const traces = async () => [
    await countOf("SELECT count(*)::int AS n FROM session_event WHERE campaign_id = $1", [campaignId]),
    await countOf("SELECT count(*)::int AS n FROM admin_event"),
  ];
  const before = await traces();

  ok(await ana.send({ type: "safety.xcard" }));
  await eventually(() => heard.owner.length === 1 && heard.tv.length === 1, "the GM and the screen hear it");
  await settle();
  assert.deepEqual([heard.ana.length, heard.ben.length], [0, 0]);
  assert.deepEqual([heard.owner[0], heard.tv[0]], [{}, {}], "the event names no one");
  assert.deepEqual(await traces(), before, "nothing is logged");

  // One touch per seat per ten seconds; another seat is its own.
  refused(await ana.send({ type: "safety.xcard" }), "xcardWait");
  ok(await ben.send({ type: "safety.xcard" }));
  refused(await owner.send({ type: "safety.xcard" }), "noPermission");
  // Switched off, it is refused.
  ok(await owner.send({ type: "campaign.setSafety", lines: [], veils: [], xCard: false }));
  const cy = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "cy-XCard") } });
  await cy.until(() => true);
  refused(await cy.send({ type: "safety.xcard" }), "xcardOff");
  for (const c of [owner, ana, ben, cy, tv]) c.socket.close();
});

test("without a GM the X-Card reaches every seat, and any player edits the lists", async () => {
  const ownerDevice = await device("owner-XCardNoGm");
  const ruleset = await caller(ownerDevice).post<RulesetReply>("/rulesets", {
    ...NO_GM_RULESET,
    id: "api-fixture-nogm-safety",
  });
  const res = await post(
    "/campaigns",
    { name: "XCardNoGm", rulesetVersionId: ruleset.body.versionId, tableMode: "gmless" },
    cookieOf(ownerDevice),
  );
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-XCardNoGm") } });
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await Promise.all([owner.until(() => true), ana.until(() => true), tv.until(() => true)]);
  const heard = [owner, ana, tv].map(hearXCard);

  ok(await ana.send({ type: "campaign.setSafety", lines: ["Line one"], veils: [], xCard: true }));
  ok(await ana.send({ type: "safety.xcard" }));
  await eventually(() => heard.every((h) => h.length === 1), "every seat hears it");
  assert.deepEqual(
    heard.map((h) => h[0]),
    [{}, {}, {}],
  );
  for (const c of [owner, ana, tv]) c.socket.close();
});

test("an @mention of a hidden entry reaches a player as the hidden form, never with its title", async () => {
  const { owner, campaignId } = await newRoom("Mention");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-mention") } });
  await ana.until(() => true);
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const secret = await save({ kind: "npc", title: "Veiled Duchess" });
  const body = (id: string, title: string) => `She answers to @[${title}](${id}).`;
  const ferry = await save({ kind: "handout", title: "Ferry", body: body(secret, "Veiled Duchess") });
  ok(await owner.send({ type: "codex.reveal", id: ferry, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(() => ana.codex()?.entries.some((e) => e.id === ferry) ?? false, "the player sees the Ferry");
  assert.equal(ana.codex()?.entries.find((e) => e.id === ferry)?.body, "She answers to @[…](hidden).");
  assert.ok(
    !JSON.stringify(ana.codex()).includes("Veiled Duchess"),
    "the hidden title is nowhere in the player's codex",
  );
  assert.equal(owner.codex()?.entries.find((e) => e.id === ferry)?.body, body(secret, "Veiled Duchess"));
  // Revealed, the mention reaches the player whole.
  ok(await owner.send({ type: "codex.reveal", id: secret, visibility: "party", audienceMode: "all", audience: [] }));
  await eventually(
    () => ana.codex()?.entries.find((e) => e.id === ferry)?.body === body(secret, "Veiled Duchess"),
    "the mention is whole once the entry is revealed",
  );
  owner.socket.close();
  ana.socket.close();
});

test("session:draftRecap: lines for a Test and a reveal; only the GM side may ask; nothing hidden is told", async () => {
  const { owner, ana, hero, call } = await testRoom("Draft");
  const draft = (s: { socket: { emitWithAck: (e: string) => Promise<unknown> } }) =>
    s.socket.emitWithAck("session:draftRecap") as Promise<{ ok: boolean; text?: string; code?: string }>;
  const save = async (a: Record<string, unknown>) => ok(await owner.send({ type: "codex.save", ...a } as never)).id!;
  const shown = await save({ kind: "handout", title: "The Old Map" });
  const hidden = await save({ kind: "handout", title: "The Betrayal" });
  ok(await owner.send({ type: "codex.reveal", id: shown, visibility: "party", audienceMode: "all", audience: [] }));
  ok(await owner.send({ type: "codex.reveal", id: hidden, visibility: "gm", audienceMode: "all", audience: [] }));
  const id = ok(await owner.send(call({ actorIds: [hero] }))).id!;
  ok(await ana.send(report(id, hero, [15])));
  ok(await owner.send({ type: "test.close", callId: id }));
  const reply = await draft(owner);
  assert.equal(reply.ok, true);
  assert.match(reply.text!, /^- Lyra's Check: /m);
  assert.match(reply.text!, /^- Revealed: The Old Map$/m);
  assert.ok(!reply.text!.includes("The Betrayal") && !reply.text!.includes(String(DN)), "nothing the table didn't see");
  const refusal = await draft(ana);
  assert.deepEqual([refusal.ok, refusal.code], [false, "noPermission"]);
  owner.socket.close();
  ana.socket.close();
});

test("random tables: the server rolls and deals, the party sees a roll, a phone only its own card, nobody undoes a deal", async () => {
  const { owner, ownerDevice, campaignId } = await newRoom("Tables");
  const res = await caller(ownerDevice).post<RulesetReply>("/rulesets", SAMPLE_HARVEST);
  assert.equal(res.status, 201);
  ok(await owner.send({ type: "campaign.setRuleset", rulesetVersionId: res.body.versionId }));
  const actors: string[] = [];
  for (const name of ["Ana", "Ben", "Cy"])
    actors.push(ok(await owner.send({ type: "actor.create", kind: "pc", name, entityType: "player" })).id!);
  const phones: ReturnType<typeof connect>[] = [];
  for (const actorId of actors) {
    const token = ok(await owner.send({ type: "token.issue", actorId })).token!;
    const phone = connect({ auth: { campaignId, token } });
    await phone.until((s) => s.actors.some((x) => x.id === actorId));
    phones.push(phone);
  }
  const tv = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  await tv.until(() => true);
  const caught = (s: LiveState) => s.stateVersion;
  const synced = async (version: number) => {
    await Promise.all([...phones, tv].map((c) => c.until((s) => s.stateVersion >= version)));
  };

  // A player may not roll; the GM rolls the party's Season, and the table sees it.
  refused(await phones[0]!.send({ type: "table.roll", tableId: "season" }), "noPermission");
  refused(await owner.send({ type: "table.roll", tableId: "nope" }), "tableNotFound");
  refused(await owner.send({ type: "table.roll", tableId: "role" }), "tableDealOnly");
  ok(await owner.send({ type: "table.roll", tableId: "season" }));
  const rolled = await owner.until((s) => s.rolls.length === 1);
  assert.ok(["Thaw", "Bloom", "Frost"].includes(rolled.rolls[0]!.label));
  assert.ok(rolled.rolls[0]!.value >= 1 && rolled.rolls[0]!.value <= 6);
  assert.equal((await tv.until((s) => s.rolls.length === 1)).rolls[0]!.id, rolled.rolls[0]!.id);
  await phones[1]!.until((s) => s.rolls.length === 1);

  // The GM's Omen is the GM's alone: the TV and the phones never learn of it.
  ok(await owner.send({ type: "table.roll", tableId: "omen" }));
  const omened = await owner.until((s) => s.rolls.length === 2);
  assert.equal(omened.rolls[0]!.visibility, "gm");
  await synced(caught(omened));
  for (const c of [tv, ...phones])
    assert.deepEqual(
      (await c.until(() => true)).rolls.map((r) => r.tableId),
      ["season"],
    );

  // Deal the Role deck (six cards) to the three characters: each phone holds exactly its own card.
  refused(await phones[0]!.send({ type: "table.deal", tableId: "role", actorIds: [actors[0]!] }), "noPermission");
  refused(
    await owner.send({ type: "table.deal", tableId: "role", actorIds: [actors[0]!, actors[0]!] }),
    /listed twice/,
  );
  ok(await owner.send({ type: "table.deal", tableId: "role", actorIds: actors }));
  const dealt = await owner.until((s) => s.dealt.length === 3);
  const deck = ["Farmer", "Miller", "Thief"];
  assert.ok(dealt.dealt.every((d) => d.visibility === "owner" && deck.includes(d.label)));
  for (const [i, phone] of phones.entries()) {
    const mine = await phone.until((s) => s.dealt.length === 1);
    assert.deepEqual(
      mine.dealt.map((d) => d.actorId),
      [actors[i]],
    );
    assert.equal(mine.dealt[0]!.label, dealt.dealt.find((d) => d.actorId === actors[i])!.label);
  }
  await synced(caught(dealt));
  assert.deepEqual((await tv.until(() => true)).dealt, []);
  refused(await owner.send({ type: "table.deal", tableId: "role", actorIds: [actors[1]!] }), "tableHeld");

  // A character of another room is not dealt to.
  const other = await newRoom("Tables2");
  const stranger = ok(await other.owner.send({ type: "actor.create", kind: "pc", name: "Zed" })).id!;
  refused(await owner.send({ type: "table.deal", tableId: "role", actorIds: [stranger] }), "characterNotFound");

  // Reshuffle takes every card back (the phones lose theirs), then the deck deals again. Undo has nothing to take back.
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "table.reshuffle", tableId: "role" }));
  await owner.until((s) => s.dealt.length === 0);
  for (const phone of phones) await phone.until((s) => s.dealt.length === 0);
  ok(await owner.send({ type: "table.deal", tableId: "role", actorIds: actors }));
  await owner.until((s) => s.dealt.length === 3);
  refused(await owner.send({ type: "event.undo" }), "nothingToUndo");
  assert.equal((await owner.until(() => true)).dealt.length, 3, "an undo does not take a deal back");
  assert.deepEqual(
    await query(
      `SELECT type FROM session_event WHERE campaign_id = $1 AND type LIKE 'table.%' ORDER BY created_at, id`,
      [campaignId],
    ),
    ["roll", "roll", "deal", "reshuffle", "deal"].map((k) => ({ type: `table.${k}` })),
  );
  for (const c of [owner, tv, other.owner, ...phones]) c.socket.close();
});

test("random tables without a GM: a GM-only table is refused, a deal stays with its holder, even from the owner", async () => {
  const ownerDevice = await device("owner-TablesNoGm");
  const ruleset = await caller(ownerDevice).post<RulesetReply>("/rulesets", {
    ...SAMPLE_HARVEST,
    id: "sample-harvest-nogm",
    game: { title: "Sample Harvest", players: { min: 1, max: 4 }, modes: ["gm", "gmless"], cite: "Sample p.1" },
  });
  assert.equal(ruleset.status, 201);
  const res = await post(
    "/campaigns",
    { name: "TablesNoGm", rulesetVersionId: ruleset.body.versionId, tableMode: "gmless" },
    cookieOf(ownerDevice),
  );
  assert.equal(res.status, 201);
  const { campaignId } = (await res.json()) as { campaignId: string };
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until((s) => s.campaign.name === "TablesNoGm");
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-TablesNoGm") } });
  const ben = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ben-TablesNoGm") } });
  const members = (await owner.until((s) => s.access.members.length === 3)).access.members;
  const heroOf = (name: string) => members.find((m) => m.userId === uid(`${name}-TablesNoGm`))!.characterIds[0]!;
  const [lyra, bram] = [heroOf("ana"), heroOf("ben")];
  await Promise.all([ana, ben].map((c) => c.until((s) => s.actors.length >= 2)));

  // Every seat runs the table, but nothing can be kept for a GM that is not there.
  refused(await ana.send({ type: "table.roll", tableId: "omen" }), "tableNoGm");
  ok(await ana.send({ type: "table.roll", tableId: "season" }));
  await ben.until((s) => s.rolls.length === 1);
  ok(await ben.send({ type: "table.deal", tableId: "role", actorIds: [lyra, bram] }));
  const mine = await ana.until((s) => s.dealt.length === 1);
  assert.equal(mine.dealt[0]!.actorId, lyra);
  assert.equal((await ben.until((s) => s.dealt.length === 1)).dealt[0]!.actorId, bram);
  // The owner runs the table and holds no character: they see neither card.
  const version = Math.max(mine.stateVersion, (await ben.until(() => true)).stateVersion);
  assert.deepEqual((await owner.until((s) => s.stateVersion >= version)).dealt, []);
  for (const c of [owner, ana, ben]) c.socket.close();
});

// ---- Harm that counts up, and mobs (house decision #66) ------------------------------------------------------------

const HARM_PACK = {
  id: "sample-harm-foes",
  version: "0.1.0",
  ruleset: { id: "sample-harm", range: "^0.1.0" },
  license: "private",
  sources: [{ id: "sample", title: "Sample Harm Rules", license: "private" }],
  entries: [
    { key: "ogre", type: "brute", name: "Ogre", tags: [], cite: "Sample p.20", visibility: "gm", body: { hide: 3 } },
    { key: "rats", type: "swarm", name: "Rats", tags: [], cite: "Sample p.21", visibility: "gm", body: {} },
  ],
};

const harm = (op: "hit" | "muster", input: Record<string, unknown>) =>
  ({ type: "rule.op", primitive: "health.harm", op, input }) as ActionInput;

test("health.harm: hit down, scarred, healed, destroyed, a mob thinned and mustered, Undo, and what each seat receives", async () => {
  const ownerDevice = await device("owner-Harm");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_HARM);
  const pk = await me.post<PackReply>("/packs", HARM_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Harm",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Harm") } });
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  // Grit 2: a wound limit of 5, a strain limit of 2, destroyed by one hit past 10.
  await equip(hero, "hero", { fields: { grit: 2 }, resources: { wounds: 3, strain: 0 } });
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Hal" }));
  await owner.until((s) => actorIn(s, hero)?.entity === "hero");

  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [hero], side: "party", visibility: "full" }));
  const spawn = { type: "actor.spawn", packVersionId: pk.body.versionId, count: 1, temporary: true } as const;
  ok(await owner.send({ ...spawn, key: "ogre", count: 2 }));
  refused(await owner.send({ ...spawn, key: "ogre", mob: 4 }), "noMobsHere");
  ok(await owner.send({ ...spawn, key: "rats", mob: 6 }));
  const fight = await owner.until((s) => s.encounter?.combatants.length === 4);
  const idOf = (name: string) => fight.actors.find((a) => a.name === name)!.id;
  const [ogre, lurker, rats] = [idOf("Ogre 1"), idOf("Ogre 2"), idOf("Rats ×6")];
  const cb = (s: LiveState, actorId: string) => s.encounter!.combatants.find((c) => c.actorId === actorId)!;
  ok(await owner.send({ type: "encounter.setVisibility", combatantId: cb(fight, ogre).id, visibility: "full" }));
  ok(await owner.send({ type: "encounter.setVisibility", combatantId: cb(fight, rats).id, visibility: "bar" }));
  assert.deepEqual(cb(fight, rats).members, { value: 6, max: 6 });

  // The plain stepper and a player's tap are refused; a brute never takes strain, and the refusal names it.
  refused(await owner.send(adjust(hero, "wounds", 1)), "hpThroughDamage");
  refused(await ana.send(harm("hit", { actorId: hero, wounds: 1 })), "noPermission");
  const never = await owner.send(harm("hit", { actorId: ogre, shock: 1 }));
  refused(never, "neverShocked");
  assert.equal(never.ok ? "" : never.error, "Ogre 1 never takes that");

  // Hal is hit down: past 5 wounds, Down laid in the same action.
  ok(await owner.send(harm("hit", { actorId: hero, wounds: 3 })));
  let s = await owner.until((x) => actorIn(x, hero)?.resources.wounds === 6);
  assert.deepEqual(actorIn(s, hero)?.conditions, ["down"]);
  assert.deepEqual(cb(s, hero).states, [{ id: "fallen", label: "Fallen" }]);
  assert.equal(cb(s, hero).bar, 0);
  assert.equal(cb(s, hero).hp, null);
  // A wound while down is a scar; healing while down stops at the limit.
  ok(await owner.send(harm("hit", { actorId: hero, wounds: 2 })));
  s = await owner.until((x) => actorIn(x, hero)?.fields.scars === 1);
  assert.equal(actorIn(s, hero)?.resources.wounds, 6);
  ok(await owner.send(harm("hit", { actorId: hero, wounds: -1 })));
  s = await owner.until((x) => actorIn(x, hero)?.resources.wounds === 5);
  assert.deepEqual(cb(s, hero).states, [{ id: "hurt", label: "Hurt" }]);

  // One hit past twice the Ogre's limit destroys it outright; its wounds do not move.
  ok(await owner.send(harm("hit", { actorId: ogre, wounds: 7 })));
  s = await owner.until((x) => actorIn(x, ogre)?.fields.gone === true);
  assert.equal(actorIn(s, ogre)?.resources.wounds, 0);

  // The swarm loses members, is mustered past its start, and Undo takes the last hit back.
  ok(await owner.send(harm("hit", { actorId: rats, wounds: 2 })));
  await owner.until((x) => cb(x, rats).members?.value === 4);
  ok(await owner.send(harm("muster", { actorId: rats, members: 8 })));
  s = await owner.until((x) => cb(x, rats).members?.value === 8);
  assert.deepEqual(cb(s, rats).members, { value: 8, max: 8 });
  assert.equal(actorIn(s, rats)?.fields.size, 8);
  ok(await owner.send(harm("hit", { actorId: rats, wounds: 3, shock: 3 })));
  s = await owner.until((x) => cb(x, rats).members?.value === 4);
  assert.equal(cb(s, rats).bar, 0.5);
  ok(await owner.send({ type: "event.undo" }));
  s = await owner.until((x) => cb(x, rats).members?.value === 8);
  assert.equal(cb(s, rats).bar, 1);

  // The player and the screen: no hidden Ogre, the swarm's bar and count without numbers, Hal's states.
  const version = s.stateVersion;
  for (const c of [ana, screen]) {
    const v = await c.until((x) => x.stateVersion >= version);
    assert.deepEqual(v.encounter!.combatants.map((x) => x.actorId).sort(), [hero, ogre, rats].sort());
    assert.equal(
      v.encounter!.combatants.some((x) => x.actorId === lurker),
      false,
    );
    assert.deepEqual(
      { hp: cb(v, rats).hp, bar: cb(v, rats).bar, members: cb(v, rats).members, states: cb(v, rats).states },
      { hp: null, bar: 1, members: { value: 8, max: 8 }, states: [] },
    );
    assert.deepEqual(cb(v, hero).states, [{ id: "hurt", label: "Hurt" }]);
    assert.equal(cb(v, hero).hp, null);
    // The condition the felling hit laid is `party` in the ruleset, so every seat reads it on the combatant (#67).
    assert.deepEqual(
      cb(v, hero).conditions.map((x) => x.id),
      ["down"],
    );
  }
  for (const c of [owner, ana, screen]) c.socket.close();
});

// Lookups (house decision #87) on sample-harm's Telling Blow: the GM types the result, the switch, the surge dice and
// the press; the server reads the line and applies it as one action, skips a condition its target is immune to, and
// never rolls a typed-only table. Any table also takes a typed result (I ROLLED).
test("lookups: a typed result applies its line as one undoable action, and I ROLLED on any table", async () => {
  const ownerDevice = await device("owner-Lookup");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_HARM);
  const pk = await me.post<PackReply>("/packs", HARM_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Lookup",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Lookup") } });
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  await equip(hero, "hero", { fields: { grit: 2 }, resources: { wounds: 0, strain: 0 } });
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Hal" }));
  await owner.until((s) => actorIn(s, hero)?.entity === "hero");
  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(
    await owner.send({ type: "actor.spawn", packVersionId: pk.body.versionId, key: "ogre", count: 1, temporary: true }),
  );
  const ogre = (await owner.until((s) => s.actors.some((a) => a.kind === "creature"))).actors.find(
    (a) => a.kind === "creature",
  )!;
  const blow = (actorId: string, result: number, inputs: Record<string, number | boolean> = {}) =>
    ({ type: "table.apply", tableId: "blow", result, actorId, inputs }) as ActionInput;
  const dazed = async (actorId: string) =>
    (
      await query<{ stacks: number }>(
        "SELECT stacks FROM actor_condition WHERE actor_id = $1 AND condition_id = 'dazed'",
        [actorId],
      )
    ).reduce((n, r) => n + r.stacks, 0);

  // Refused: the app never rolls a typed-only table, a result off the die, a bad input, a player, a table with no effects.
  refused(await owner.send({ type: "table.roll", tableId: "blow" }), "tableTypedOnly");
  refused(await owner.send(blow(hero, 17)), "tableResultOut");
  refused(await owner.send(blow(hero, 44, { surge: 9 })), "tableInput");
  refused(await ana.send(blow(hero, 44)), "noPermission");
  refused(await owner.send({ type: "table.apply", tableId: "aftermath", result: 4, actorId: hero }), "tableNoApply");

  // 44 past the hide with one press: Reel, 2 wounds and Dazed twice, in one action Undo takes back whole.
  const reel = ok(await owner.send(blow(hero, 44, { past: true, press: 1 })));
  assert.deepEqual(reel.roll, { entryId: "reel", value: 44, total: 44 });
  await owner.until((s) => actorIn(s, hero)?.resources.wounds === 2);
  assert.equal(await dazed(hero), 2);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((s) => actorIn(s, hero)?.resources.wounds === 0);
  assert.equal(await dazed(hero), 0);

  // Three surge dice lift 36 to 66: the open-ended Ruin line, which names the Aftermath table.
  const ruin = ok(await owner.send(blow(hero, 36, { surge: 3 })));
  assert.deepEqual(ruin.roll, { entryId: "ruin", value: 36, total: 66 });
  await owner.until((s) => actorIn(s, hero)?.resources.wounds === 1);

  // The Ogre is immune to Dazed: its wounds land, the condition is left out, and the answer says so.
  const immune = ok(await owner.send(blow(ogre.id, 44, { past: true, press: 2 })));
  assert.deepEqual(immune.notices, [{ code: "conditionSkipped", params: { name: ogre.name, condition: "Dazed" } }]);
  await owner.until((s) => actorIn(s, ogre.id)?.resources.wounds === 2);
  assert.equal(await dazed(ogre.id), 0);

  // I ROLLED on a plain table: the typed 5 reads Scar and is logged as a roll; a 7 is off a d6.
  const typed = ok(await owner.send({ type: "table.roll", tableId: "aftermath", result: 5 }));
  assert.deepEqual(typed.roll, { entryId: "scar", value: 5, total: 5 });
  const rolled = await owner.until((s) => s.rolls.length === 1);
  assert.deepEqual([rolled.rolls[0]!.label, rolled.rolls[0]!.value], ["Scar", 5]);
  refused(await owner.send({ type: "table.roll", tableId: "aftermath", result: 7 }), "tableResultOut");
  for (const c of [owner, ana]) c.socket.close();
});

// Held records (house decision #88) on sample-harm 0.1.3: the GM steps through the Omen to the Lesser Growths with one
// hero, and only the last line grants; the growth feeds the hero's wound limit on every seat, its holder and the GM read
// its name, another player reads "Unseen" and the same numbers; a duplicate asks for a roll again, and CUT OFF undoes.
test("held records: a chain ends in a grant, another player sees the numbers but not the name", async () => {
  const ownerDevice = await device("owner-Held");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_HARM);
  const pk = await me.post<PackReply>("/packs", {
    id: "sample-harm-growths",
    version: "0.1.0",
    ruleset: { id: "sample-harm", range: "^0.1.0" },
    license: "private",
    sources: [{ id: "sample", title: "Sample Harm Rules", license: "private" }],
    entries: SAMPLE_HARM_GROWTHS,
  });
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Held",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Held") } });
  const bo = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "bo-Held") } });
  const pcs = (await owner.until((s) => s.actors.filter((a) => a.kind === "pc").length === 2)).actors.filter(
    (a) => a.kind === "pc",
  );
  const [hero, other] = [pcs[0]!.id, pcs[1]!.id];
  for (const id of [hero, other]) await equip(id, "hero", { fields: { grit: 2 }, resources: { wounds: 0, strain: 0 } });
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Hal" }));
  await owner.until((s) => actorIn(s, hero)?.entity === "hero" && actorIn(s, other)?.entity === "hero");
  ok(await owner.send({ type: "session.start" }));

  // The Omen's 2 sends the GM to the Lesser table and grants nothing; its 23 grants Horn, the end of the chain.
  const omen = ok(await owner.send({ type: "table.roll", tableId: "omen", result: 2 }));
  assert.equal(omen.roll?.entryId, "faint");
  const grant = (result: number) =>
    ({ type: "table.apply", tableId: "lesser", result, actorId: hero, inputs: {} }) as ActionInput;
  const added = ok(await owner.send(grant(23)));
  assert.deepEqual(added.roll, { entryId: "horn", value: 23, total: 23 });
  const s = await owner.until((x) => (actorIn(x, hero)?.held ?? []).length === 1);
  assert.equal(actorIn(s, hero)?.derived.limit, 6);
  assert.deepEqual(
    actorIn(s, hero)?.held?.map((r) => [r.name, r.key]),
    [["Horn", "horn"]],
  );
  // Holding one adds 10: 23 reads 33, Horn again, which asks for a roll again.
  refused(await owner.send(grant(23)), "heldAlready");

  // Whose seat reads what: the holder by name, the other player the word and the same numbers, no name, key or cite.
  const version = s.stateVersion;
  const anaView = await ana.until((x) => x.stateVersion >= version);
  const mine = anaView.actors.find((a) => (a.held ?? []).length > 0);
  assert.equal(mine?.held?.[0]?.name, "Horn");
  const boView = await bo.until((x) => x.stateVersion >= version);
  const seen = boView.actors.find((a) => a.id === mine?.id);
  assert.deepEqual(seen?.held, [
    {
      kind: "growth",
      key: null,
      name: "Unseen",
      cite: null,
      effects: [{ path: "derived.limit", mode: "add", value: "1", phase: "derived" }],
    },
  ]);
  assert.equal(seen?.derived.limit, 6);
  const sent = JSON.stringify(boView.actors);
  for (const secret of ["Horn", '"horn"', "Sample p.14"]) assert.ok(!sent.includes(secret), secret);

  // CUT OFF is the GM's, logged, and Undo gives the growth back.
  refused(await ana.send({ type: "held.remove", actorId: mine!.id, held: "growth", entry: "horn" }), "noPermission");
  ok(await owner.send({ type: "held.remove", actorId: hero, held: "growth", entry: "horn" }));
  await owner.until((x) => (actorIn(x, hero)?.held ?? []).length === 0 && actorIn(x, hero)?.derived.limit === 5);
  ok(await owner.send({ type: "event.undo" }));
  await owner.until((x) => (actorIn(x, hero)?.held ?? []).length === 1);
  for (const c of [owner, ana, bo]) c.socket.close();
});

// START THE FIGHT on a prepared scene (house decision #75): the actions the Run view builds, sent one by one as it
// sends them, each its own action. A hidden line, a bar line under a name, and a mob at full under a name.
test("scene prep: START THE FIGHT starts it, seats the party and places each roster line at its view", async () => {
  const ownerDevice = await device("owner-Cellar");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_HARM);
  const pk = await me.post<PackReply>("/packs", HARM_PACK);
  assert.deepEqual([rs.status, pk.status], [201, 201]);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Cellar",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  ok(await owner.send({ type: "campaign.attachPack", packVersionId: pk.body.versionId }));
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Cellar") } });
  const pc = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find((a) => a.kind === "pc")!;
  await equip(pc.id, "hero", { fields: { grit: 2 }, resources: { wounds: 0, strain: 0 } });

  const roster = [
    { id: "h", pack: HARM_PACK.id, key: "ogre", count: 1 },
    { id: "b", pack: HARM_PACK.id, key: "ogre", count: 2, visibility: "bar" as const, label: "Brutes" },
    { id: "m", pack: HARM_PACK.id, key: "rats", count: 1, mob: 6, visibility: "full" as const, label: "Vermin" },
  ];
  const cellar = ok(await owner.send({ type: "codex.save", kind: "scene", title: "The cellar", prep: { roster } })).id!;
  await eventually(
    () => owner.codex()?.entries.find((e) => e.id === cellar)?.prep?.roster.length === 3,
    "the GM receives the roster",
  );

  ok(await owner.send({ type: "session.start" }));
  const spawn = { type: "actor.spawn", packVersionId: pk.body.versionId, temporary: true };
  const steps = [
    { type: "encounter.start" },
    { type: "encounter.add", actorIds: [pc.id], side: "party", visibility: "full" },
    { ...spawn, key: "ogre", count: 1, visibility: "hidden" },
    { ...spawn, key: "ogre", count: 2, visibility: "bar", name: "Brutes" },
    { ...spawn, key: "rats", count: 1, visibility: "full", mob: 6, name: "Vermin" },
  ];
  for (const step of steps) ok(await owner.send(step as ActionInput));
  const fight = await owner.until((s) => s.encounter?.combatants.length === 5);
  const views = Object.fromEntries(fight.encounter!.combatants.map((c) => [c.name, c.visibility]));
  assert.deepEqual(views, {
    [pc.name]: "full",
    "Ogre 1": "hidden",
    "Brutes 1": "bar",
    "Brutes 2": "bar",
    "Vermin ×6": "full",
  });
  // With the fight running the sequence sends no start: that one is refused there.
  refused(await owner.send({ type: "encounter.start" }), /already running/);

  // The player: nothing of the hidden one; the named bar ones without numbers; the mob with its count.
  const v = await ana.until((x) => x.stateVersion >= fight.stateVersion);
  const seen = new Map(v.encounter!.combatants.map((c) => [c.name, c]));
  assert.deepEqual([...seen.keys()].sort(), [pc.name, "Brutes 1", "Brutes 2", "Vermin ×6"].sort());
  for (const n of ["Brutes 1", "Brutes 2"]) {
    assert.equal(seen.get(n)?.hp, null);
    assert.equal(typeof seen.get(n)?.bar, "number");
  }
  assert.deepEqual(seen.get("Vermin ×6")?.members, { value: 6, max: 6 });
  assert.ok(!JSON.stringify(v).includes("Ogre 1"));
  for (const c of [owner, ana]) c.socket.close();
});

// House decision #74: a room document comes in over REST, whole or not at all, and its room is played like any other.
test("room document: a creator imports it, the GM reads all of it, an invited player only what is theirs", async () => {
  const ownerDevice = await device("roomdoc-owner");
  const me = caller(ownerDevice);
  const doc = d20Document();
  assert.equal((await me.post("/campaigns/import", doc)).status, 422, "nothing it expects is imported yet");
  assert.equal((await me.post("/rulesets", ROOM_D20)).status, 201);
  assert.equal((await me.post("/packs", SAMPLE_PACK)).status, 201);
  assert.equal((await me.post("/worlds", SAMPLE_WORLD)).status, 201);

  assert.equal((await post("/campaigns/import", doc)).status, 401);
  const plain = await device("roomdoc-plain");
  await withDb((c) => c.query("update app_user set role = 'user' where id = $1", [uid("roomdoc-plain")]));
  assert.equal((await post("/campaigns/import", doc, cookieOf(plain))).status, 403);

  // A dangling reference is refused by its path, and makes nothing.
  const dangling = d20Document();
  dangling.codex![6]!.prep!.reveals![0]!.entryId = "00000000-0000-4000-8000-000000000999";
  const refused = await me.post<RoomImportRefusal>("/campaigns/import", dangling);
  assert.equal(refused.status, 422);
  assert.deepEqual([refused.body.path, refused.body.code], ["codex[6].prep.reveals[0].entryId", "roomNoSuchEntry"]);
  const dry = await me.post<RoomImportReply>("/campaigns/import?dryRun=1", doc);
  assert.equal(dry.status, 200);
  assert.equal(dry.body.campaignId, null);
  assert.deepEqual(dry.body.counts.entries, {
    location: 2,
    npc: 1,
    handout: 1,
    quest: 1,
    adventure: 1,
    scene: 2,
    lore: 1,
    faction: 1,
  });
  assert.ok(dry.body.expects.every((e) => e.imported));
  const lobby = (await (await get("/lobby", cookieOf(ownerDevice))).json()) as Lobby;
  assert.equal(lobby.mine.length, 0, "neither the refusal nor the dry run made a room");

  const made = await me.post<RoomImportReply>("/campaigns/import", doc);
  assert.equal(made.status, 201);
  const campaignId = made.body.campaignId!;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  const s = await owner.until((x) => x.campaign.name === "Harbour Watch");
  assert.equal(s.access.members.length, 1, "no seat comes with it");
  const mara = s.actors.find((a) => a.name === "Mara")!;
  assert.equal(mara.resources.hp, 8);
  await eventually(() => owner.codex()?.entries.length === 10, "the GM reads every entry");
  const gm = (title: string) => owner.codex()!.entries.find((e) => e.title === title)!;
  assert.equal(gm("Quay").parentId, gm("Harbour town").id);
  assert.deepEqual(gm("Trouble on the quay").prep?.reveals, [{ id: "v1", entryId: gm("Notice").id }]);
  assert.deepEqual(gm("Trouble on the quay").prep?.tests[0]?.actorIds, [mara.id]);
  assert.match(gm("Notice").body, new RegExp(`\\(${gm("Quay").id}\\)`), "the mention points at the room's entry");
  assert.ok(!JSON.stringify(owner.codex()).includes(IDS.quay), "no id of the document is left");

  // Mara's player joins by invite, as in any room, and reads her handout and the shown picture, never the GM's.
  const code = ok(await owner.send({ type: "invite.create", mode: "character", actorId: mara.id })).token!;
  const maraDevice = await device("roomdoc-mara");
  const accepted = await post(
    `/invites/${code}/accept`,
    {},
    { ...cookieOf(maraDevice), "cf-connecting-ip": nextSocketIp() },
  );
  assert.equal(accepted.status, 200);
  const player = connect({ auth: { campaignId, cookie: maraDevice } });
  await eventually(() => player.codex()?.entries.some((e) => e.title === "Notice") ?? false, "Mara reads her notice");
  const seen = (title: string) => player.codex()!.entries.find((e) => e.title === title);
  assert.equal(seen("Quay")?.imageRevealed, true);
  assert.deepEqual(seen("Quay")?.fields, { district: "Docks" });
  assert.equal(seen("Old tides"), undefined, "a GM entry stays the GM's");
  assert.equal(seen("Harbourmaster Oyle")?.gmNotes, "");
  assert.equal(seen("Trouble on the quay"), undefined, "an unrevealed scene stays home");
  owner.socket.close();
  player.socket.close();
});

// House decision #81 on the invented sides fixture: reminder lines reach the combat side only, a whole side is barred
// in one action, an immune foe refuses a condition, a rated condition shows its stacks to every seat, and a long rest
// is refused while downed and skips the downed in a party rest.
test("sides fixture: reminders, a side barred at once, immunity, stacks and a refused rest", async () => {
  const ownerDevice = await device("owner-Skirmish");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_SKIRMISH);
  assert.equal(rs.status, 201);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Skirmish",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-Skirmish") } });
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const hero = (await owner.until((s) => s.actors.some((a) => a.kind === "pc"))).actors.find(
    (a) => a.kind === "pc",
  )!.id;
  ok(await owner.send({ type: "actor.rename", id: hero, name: "Hal" }));
  // Level 3, Grit 10: 14 Vigour at most, 2 left, so below half.
  const stats = { "attr.str": 10, "attr.dex": 10, "attr.con": 10, guard: 1 };
  await equip(hero, "character", { fields: { level: 3, ...stats }, resources: { hp: 2 } });
  const brute = ok(await owner.send({ type: "actor.create", kind: "creature", name: "Brute" })).id!;
  await equip(brute, "creature", { fields: { level: 6, "attr.con": 10 }, resources: { hp: 20 } });
  const imp = ok(await owner.send({ type: "actor.create", kind: "creature", name: "Imp" })).id!;
  await equip(imp, "creature", { fields: { level: 1, "attr.con": 10 }, resources: { hp: 5 } });
  const sides = (op: string, input: object) =>
    owner.send({ type: "rule.op", primitive: "initiative.sides", op, input } as ActionInput);

  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [hero, brute, imp], visibility: "full" }));
  await owner.until((s) => s.encounter?.combatants.length === 3);
  const cb = (s: LiveState, actorId: string) => s.encounter!.combatants.find((c) => c.actorId === actorId)!;

  // Setup: the raiders barred at once, then freed, and the Imp alone; a side the ruleset lacks is refused.
  ok(await sides("bar", { side: "raiders", barred: true }));
  await owner.until((s) => cb(s, brute).barred === true && cb(s, imp).barred === true);
  refused(await sides("bar", { side: "nobody", barred: true }), "badInput");
  ok(await sides("bar", { side: "raiders", barred: false }));
  ok(await sides("bar", { id: imp, barred: true }));
  let s = await owner.until((x) => cb(x, brute).barred === false && cb(x, imp).barred === true);
  assert.equal(s.encounter!.reminders, undefined, "nothing is due before the fight begins");
  ok(await sides("begin", {}));

  // Hal's turn: below half and burning at its start, the footing line at its end.
  ok(await owner.send({ type: "condition.add", actorId: hero, condition: "burning" }));
  ok(await sides("pick", { id: hero }));
  s = await owner.until((x) => x.encounter?.currentId === cb(x, hero).id && (x.encounter.reminders?.length ?? 0) === 3);
  assert.deepEqual(
    s.encounter!.reminders!.map((r) => [r.at, r.id, r.actorIds]),
    [
      ["turnStart", "rally", [hero]],
      ["turnStart", "burning", [hero]],
      ["turnEnd", "footing", []],
    ],
  );
  // A player and the screen never receive a line.
  for (const c of [ana, screen]) {
    const v = await c.until((x) => x.stateVersion >= s.stateVersion);
    assert.equal(v.encounter!.reminders, undefined);
  }

  // The Brute is immune to Reeling by name; Hal takes it twice and every seat reads the stacks.
  const immune = await owner.send({ type: "condition.add", actorId: brute, condition: "reeling" });
  refused(immune, "conditionImmune");
  assert.equal(immune.ok ? "" : immune.error, "Brute is immune to Reeling");
  ok(await owner.send({ type: "condition.add", actorId: hero, condition: "reeling" }));
  ok(await owner.send({ type: "condition.add", actorId: hero, condition: "reeling" }));
  s = await owner.until((x) => cb(x, hero).conditions.some((k) => k.id === "reeling" && k.stacks === 2));
  // Added during Hal's own turn: two ticks, so it outlasts this turn.
  assert.equal(cb(s, hero).conditions.find((k) => k.id === "reeling")?.left, 2);
  const seen = await ana.until((x) => x.stateVersion >= s.stateVersion);
  assert.equal(cb(seen, hero).conditions.find((k) => k.id === "reeling")?.stacks, 2);

  // The Brute holds; the Imp is still barred: the round's end names each.
  ok(await sides("pick", { id: brute }));
  ok(await sides("hold", {}));
  s = await owner.until(
    (x) => x.encounter?.currentId === null && x.encounter.reminders?.some((r) => r.at === "roundEnd") === true,
  );
  assert.deepEqual(
    s.encounter!.reminders!.map((r) => [r.id, r.actorIds]),
    [
      ["heldLost", [brute]],
      ["offGuardEnds", [imp]],
    ],
  );
  assert.equal(cb(s, hero).conditions.find((k) => k.id === "reeling")?.left, 1, "Hal's turn end took one tick");

  // Downed, Hal takes no long rest; the party's rests everyone else and names him.
  await query("UPDATE actor_resource SET value = 0 WHERE actor_id = $1 AND resource_id = 'hp'", [hero]);
  const one = await owner.send({ type: "actor.rest", event: "longRest", actorId: hero });
  refused(one, "restRefused");
  assert.equal(one.ok ? "" : one.error, "Hal can't rest while Downed");
  const all = ok(await owner.send({ type: "actor.rest", event: "longRest" }));
  assert.deepEqual(all.notices, [{ code: "restSkipped", params: { names: "Hal", count: 1 } }]);
  s = await owner.until((x) => actorIn(x, imp)?.resources.hp === 7);
  assert.equal(actorIn(s, hero)?.resources.hp, 0);
  for (const c of [owner, ana, screen]) c.socket.close();
});

// House decision #82 on the invented sides fixture: TURN BACK takes back the last turn step with every hit since and
// what a paid start cost, tells only the side running the fight what it would take, and refuses as a whole.
test("sides fixture: TURN BACK takes the last turn step and the hits since, and is refused whole", async () => {
  const ownerDevice = await device("owner-TurnBack");
  const me = caller(ownerDevice);
  const rs = await me.post<RulesetReply>("/rulesets", SAMPLE_SKIRMISH);
  assert.equal(rs.status, 201);
  const made = await me.post<{ campaignId: string }>("/campaigns", {
    name: "Turn back",
    rulesetVersionId: rs.body.versionId,
  });
  const { campaignId } = made.body;
  const owner = connect({ auth: { campaignId, cookie: ownerDevice } });
  await owner.until(() => true);
  const ana = connect({ auth: { campaignId, cookie: await seatPlayer(owner, "ana-TurnBack") } });
  await seatPlayer(owner, "bea-TurnBack");
  const screen = connect({ auth: { campaignId, token: ok(await owner.send({ type: "screen.issue" })).token! } });
  const pcs = (await owner.until((s) => s.actors.filter((a) => a.kind === "pc").length === 2)).actors.filter(
    (a) => a.kind === "pc",
  );
  const [hal, bea] = [pcs[0]!.id, pcs[1]!.id];
  ok(await owner.send({ type: "actor.rename", id: hal, name: "Hal" }));
  ok(await owner.send({ type: "actor.rename", id: bea, name: "Bea" }));
  const stats = { level: 3, "attr.str": 10, "attr.dex": 10, "attr.con": 10, guard: 1 };
  await equip(hal, "character", { fields: stats, resources: { hp: 14 } });
  await equip(bea, "character", { fields: stats, resources: { hp: 14 } });
  const brute = ok(await owner.send({ type: "actor.create", kind: "creature", name: "Brute" })).id!;
  await equip(brute, "creature", { fields: { level: 6, "attr.con": 10 }, resources: { hp: 20 } });
  const sides = (op: string, input: object) =>
    owner.send({ type: "rule.op", primitive: "initiative.sides", op, input } as ActionInput);
  const cb = (s: LiveState, actorId: string) => s.encounter!.combatants.find((c) => c.actorId === actorId)!;
  const momentum = (s: LiveState) => s.pools.find((p) => p.id === "momentum")?.value;
  const hp = (s: LiveState) => actorIn(s, brute)?.resources.hp;

  ok(await owner.send({ type: "session.start" }));
  ok(await owner.send({ type: "encounter.start" }));
  ok(await owner.send({ type: "encounter.add", actorIds: [hal, bea, brute], visibility: "full" }));
  ok(await sides("begin", {}));
  refused(await owner.send({ type: "event.turnBack" }), "nothingToTurnBack");
  ok(
    await owner.send({
      type: "rule.op",
      primitive: "resource.capped",
      op: "adjustPool",
      input: { resource: "momentum", delta: 2 },
    }),
  );
  ok(await sides("pick", { id: hal }));
  ok(await sides("next", {}));
  // A step with hits after it: Bea starts out of turn for a point of momentum, the Brute takes two hits and burns.
  const step = async () => {
    ok(await sides("seize", { id: bea }));
    ok(await owner.send(hpStep(brute, "hp", -3)));
    ok(await owner.send({ type: "condition.add", actorId: brute, condition: "burning" }));
    ok(await owner.send(hpStep(brute, "hp", -2)));
    return owner.until((x) => x.encounter?.currentId === cb(x, bea).id && hp(x) === 15 && momentum(x) === 1);
  };
  let s = await step();
  assert.deepEqual(s.encounter!.turnBack, { kind: "turnStart", name: "Bea", round: 1, later: 3 });
  for (const c of [ana, screen]) {
    const v = await c.until((x) => x.stateVersion >= s.stateVersion);
    assert.equal(v.encounter!.turnBack, undefined, "only the side running the fight is told");
  }

  // One press takes the paid start back with everything since; the next takes the step before.
  ok(await owner.send({ type: "event.turnBack" }));
  s = await owner.until((x) => x.encounter?.currentId === null && hp(x) === 20);
  assert.equal(momentum(s), 2);
  assert.deepEqual(cb(s, brute).conditions, []);
  assert.deepEqual(s.encounter!.turnBack, { kind: "turnEnd", name: "Hal", round: 1, later: 0 });
  ok(await owner.send({ type: "event.turnBack" }));
  s = await owner.until((x) => x.encounter?.currentId === cb(x, hal).id);
  assert.deepEqual(s.encounter!.turnBack, { kind: "turnStart", name: "Hal", round: 1, later: 0 });

  // A condition changed outside the log: its add can't be taken back, so the whole step is refused and nothing moves.
  ok(await sides("next", {}));
  s = await step();
  await query("DELETE FROM actor_condition WHERE actor_id = $1", [brute]);
  const blocked = await owner.send({ type: "event.turnBack" });
  refused(blocked, "turnBackRefused");
  assert.match(blocked.ok ? "" : blocked.error, /action 2 of 4/);
  ok(await owner.send({ type: "encounter.keep", combatantId: cb(s, brute).id, keep: true })); // a fresh state to read
  s = await owner.until((x) => cb(x, brute).keep);
  assert.equal(s.encounter!.currentId, cb(s, bea).id);
  assert.equal(hp(s), 15);
  assert.equal(momentum(s), 1);
  for (const c of [owner, ana, screen]) c.socket.close();
});
