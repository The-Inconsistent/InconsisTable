import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_PERMS, Action } from "./actions.ts";
import { Permission, SEAT_GRANTS, canActOnMember, canGrantRole, canInCampaign, type Target } from "./permissions.ts";
import type { CogmScope, Ctx, Seat } from "./seat.ts";

// The permission matrix of docs/design.md §3.6, one seat per column.
const OWNER = "u-owner";
const ctxOf = ({ seat, userId = null }: { seat: Seat; userId?: string | null }): Ctx => ({
  campaignId: "c1",
  userId,
  campaignOwnerId: OWNER,
  seat,
});
const owner = ctxOf({ userId: OWNER, seat: { kind: "member", role: "gm", scopes: [], characterIds: [] } });
const gm = ctxOf({ userId: "u-gm", seat: { kind: "member", role: "gm", scopes: [], characterIds: [] } });
const cogm = (scopes: CogmScope[]) =>
  ctxOf({ userId: "u-co", seat: { kind: "member", role: "cogm", scopes, characterIds: [] } });
const player = ctxOf({
  userId: "u-pl",
  seat: { kind: "member", role: "player", scopes: [], characterIds: ["a1", "a1-pet"] },
});
const guest = ctxOf({ seat: { kind: "token", role: "player", characterIds: ["a2"] } });
const screen = ctxOf({ seat: { kind: "token", role: "screen", characterIds: [] } });
const admin = ctxOf({ userId: "u-admin", seat: { kind: "admin" } });

const can = (ctx: Ctx, perm: Permission, target?: Target) => canInCampaign({ ctx, perm, target });

test("owner-only actions: delete, transfer, ruleset, appoint", () => {
  for (const perm of ["campaign:delete", "campaign:transfer", "campaign:ruleset", "member:appoint"] as const) {
    assert.equal(can(owner, perm), true, perm);
    assert.equal(can(admin, perm), true, perm);
    for (const other of [gm, cogm(["party", "session", "combat", "codex", "codex.secrets"]), player, guest, screen])
      assert.equal(can(other, perm), false, perm);
  }
});

test("an owner-less room: nobody but an admin holds owner powers", () => {
  const orphan: Ctx = { ...gm, campaignOwnerId: null };
  assert.equal(can(orphan, "campaign:delete"), false);
  const guestOfOrphan: Ctx = { ...guest, campaignOwnerId: null };
  assert.equal(can(guestOfOrphan, "campaign:transfer"), false); // null userId never matches a null owner
});

test("only an admin seats a user", () => {
  assert.equal(can(admin, "member:seat"), true);
  for (const other of [owner, gm, cogm(["party"]), player, guest, screen])
    assert.equal(can(other, "member:seat"), false);
});

test("archive and settings: owner and GMs, never a co-GM", () => {
  for (const perm of ["campaign:archive", "campaign:update"] as const) {
    assert.equal(can(owner, perm), true);
    assert.equal(can(gm, perm), true);
    assert.equal(can(cogm(["party", "session", "combat", "codex", "codex.secrets"]), perm), false);
    assert.equal(can(player, perm), false);
  }
});

test("a co-GM holds a GM permission only through its scope", () => {
  const cases: [Permission, CogmScope][] = [
    ["member:invite", "party"],
    ["member:remove", "party"],
    ["character:edit:any", "party"],
    ["session:run", "session"],
    ["test:call", "session"],
    ["encounter:run", "combat"],
    ["codex:write", "codex"],
    ["codex:reveal", "codex"],
    ["codex:read_secret", "codex.secrets"],
  ];
  for (const [perm, scope] of cases) {
    assert.equal(can(cogm([scope]), perm), true, `${perm} with ${scope}`);
    assert.equal(can(cogm([]), perm), false, `${perm} without scopes`);
    const others = (["combat", "codex", "codex.secrets", "party", "session"] as const).filter((s) => s !== scope);
    assert.equal(can(cogm(others), perm), false, `${perm} with every other scope`);
    assert.equal(can(gm, perm), true, `${perm} for a GM`);
  }
  // Codex scope alone never reveals the GM notes.
  assert.equal(can(cogm(["codex"]), "codex:read_secret"), false);
});

test("players: their own characters only, by seat, never by account", () => {
  assert.equal(can(player, "character:edit:own", { actorId: "a1" }), true);
  assert.equal(can(player, "character:edit:own", { actorId: "a1-pet" }), true); // a companion on the same seat
  assert.equal(can(player, "character:edit:own", { actorId: "a2" }), false);
  assert.equal(can(player, "character:edit:own"), false); // :own needs a target
  assert.equal(can(player, "character:edit:any"), false);
  // A guest has no account but still edits the character on their token.
  assert.equal(can(guest, "character:edit:own", { actorId: "a2" }), true);
  assert.equal(can(guest, "character:edit:own", { actorId: "a1" }), false);
  // Someone who left the room has no seat: no ctx is built for them, so there is nothing to grant.
  for (const ctx of [player, guest]) {
    assert.equal(can(ctx, "request:send"), true);
    assert.equal(can(ctx, "safety:signal"), true);
    assert.equal(can(ctx, "codex:read"), true);
    assert.equal(can(ctx, "codex:read_secret"), false);
    assert.equal(can(ctx, "session:run"), false);
    assert.equal(can(ctx, "member:invite"), false);
  }
});

test("the screen only reads", () => {
  for (const perm of Permission.options)
    assert.equal(can(screen, perm, { actorId: "a1" }), perm === "codex:read", perm);
});

test("GMs don't send player requests or safety signals", () => {
  for (const ctx of [owner, gm]) {
    assert.equal(can(ctx, "request:send"), false);
    assert.equal(can(ctx, "safety:signal"), false);
  }
});

test("members act only on lower seats, and never on the owner", () => {
  const target = (userId: string, role: "gm" | "cogm" | "player") => ({ userId, role });
  // The owner acts on every other seat.
  assert.equal(canActOnMember({ ctx: owner, target: target("u-gm", "gm") }), true);
  assert.equal(canActOnMember({ ctx: owner, target: target("u-co", "cogm") }), true);
  // A GM removes players and co-GMs, not another GM, and never the owner.
  assert.equal(canActOnMember({ ctx: gm, target: target("u-pl", "player") }), true);
  assert.equal(canActOnMember({ ctx: gm, target: target("u-co", "cogm") }), true);
  assert.equal(canActOnMember({ ctx: gm, target: target("u-gm2", "gm") }), false);
  assert.equal(canActOnMember({ ctx: gm, target: target(OWNER, "gm") }), false);
  // A co-GM removes players only; a player nobody.
  assert.equal(canActOnMember({ ctx: cogm(["party"]), target: target("u-pl", "player") }), true);
  assert.equal(canActOnMember({ ctx: cogm(["party"]), target: target("u-co2", "cogm") }), false);
  assert.equal(canActOnMember({ ctx: player, target: target("u-pl2", "player") }), false);
  assert.equal(canActOnMember({ ctx: guest, target: target("u-pl", "player") }), false);
  // Not even an admin removes the owner: the room is transferred instead.
  assert.equal(canActOnMember({ ctx: admin, target: target(OWNER, "gm") }), false);
  assert.equal(canActOnMember({ ctx: admin, target: target("u-gm", "gm") }), true);
});

test("invites grant at most what the inviter may", () => {
  assert.equal(canGrantRole({ ctx: owner, role: "gm" }), true);
  assert.equal(canGrantRole({ ctx: owner, role: "cogm" }), true);
  assert.equal(canGrantRole({ ctx: gm, role: "player" }), true);
  assert.equal(canGrantRole({ ctx: gm, role: "cogm" }), false);
  assert.equal(canGrantRole({ ctx: gm, role: "gm" }), false);
  assert.equal(canGrantRole({ ctx: cogm(["party"]), role: "player" }), true);
  assert.equal(canGrantRole({ ctx: cogm(["combat"]), role: "player" }), false);
  assert.equal(canGrantRole({ ctx: player, role: "player" }), false);
  assert.equal(canGrantRole({ ctx: admin, role: "gm" }), true);
});

test("every action declares a known permission", () => {
  const types = Action.options.map((o) => o.shape.type.value);
  assert.deepEqual(Object.keys(ACTION_PERMS).sort(), [...types].sort());
  for (const perm of Object.values(ACTION_PERMS)) if (perm !== null) assert.ok(Permission.options.includes(perm));
});

test("the GM grant set is a superset of what a co-GM can ever reach", () => {
  for (const perm of SEAT_GRANTS.cogm) assert.ok(SEAT_GRANTS.gm.has(perm), perm);
});
