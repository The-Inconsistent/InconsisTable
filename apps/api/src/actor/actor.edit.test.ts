import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActorKind, Ctx } from "@inconsistable/core-schema";
import type { EditableBy, Visibility } from "@inconsistable/rules-engine";
import { checkEditable } from "./actor.edit.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({ campaignId: "c", userId: "u", campaignOwnerId: "owner", seat });
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const coCombat = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
const coParty = ctx({ kind: "member", role: "cogm", scopes: ["party"], characterIds: [] });
const coCodex = ctx({ kind: "member", role: "cogm", scopes: ["codex", "session"], characterIds: [] });
const admin = ctx({ kind: "admin" });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const guest = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

const BY: EditableBy[] = ["gm", "owner", "ownerSpendOnly"];
const spend = { kind: "add", value: -1 } as const;
const gain = { kind: "add", value: 2 } as const;
const set = { kind: "set", value: "x" } as const;
const check = (
  c: Ctx,
  editableBy: EditableBy,
  actorId: string,
  delta: Parameters<typeof checkEditable>[0]["delta"],
  kind: ActorKind = "pc",
  visibility: Visibility = "gm",
) => checkEditable({ ctx: c, editableBy, actorId, kind, visibility, delta, what: "Focus" });

test("the GM side writes any value on any actor", () => {
  for (const c of [gm, admin, coParty])
    for (const by of BY) for (const d of [spend, gain, set]) assert.equal(check(c, by, "lyra", d), null);
  for (const c of [gm, admin, coCombat])
    for (const by of BY) for (const d of [spend, gain, set]) assert.equal(check(c, by, "ogre", d, "creature"), null);
});

// House decision #31: a co-GM writes a hidden value only where the scope that lets them see it covers it.
test("a co-GM writes Characters' values with the party scope and Creatures' and NPCs' with the combat scope", () => {
  assert.match(check(coCombat, "gm", "lyra", gain) ?? "", /Not your character/); // a Character's `gm` resource
  assert.equal(check(coCombat, "gm", "ogre", { kind: "add", value: -4 }, "creature"), null); // a Creature's HP
  assert.equal(check(coCombat, "gm", "guard", set, "npc"), null);
  assert.match(check(coParty, "gm", "ogre", gain, "creature") ?? "", /Not your character/);
  for (const kind of ["pc", "companion"] as const) assert.equal(check(coParty, "gm", "lyra", set, kind), null);
  for (const kind of ["creature", "npc"] as const) assert.match(check(coParty, "gm", "ogre", set, kind) ?? "", /Not/);
  // Scopes that cover neither write like a player who holds nothing...
  for (const kind of ["pc", "creature"] as const) assert.match(check(coCodex, "gm", "x", set, kind) ?? "", /Not/);
  // ...except what everyone sees, which the action's own permission already gates (combat damages a Character's HP).
  for (const visibility of ["public", "party"] as const) {
    assert.equal(check(coCombat, "gm", "lyra", { kind: "add", value: -4 }, "pc", visibility), null);
    assert.equal(check(coCodex, "gm", "lyra", set, "pc", visibility), null);
  }
  for (const visibility of ["owner", "gm"] as const)
    assert.match(check(coCombat, "gm", "lyra", gain, "pc", visibility) ?? "", /Not your character/);
});

test("a player writes only a character they hold, and 'gm' values never", () => {
  for (const by of BY) assert.match(check(lyra, by, "bran", spend) ?? "", /Not your character/);
  assert.match(check(lyra, "gm", "lyra", set) ?? "", /Only the GM/);
  assert.equal(check(lyra, "owner", "lyra", set), null);
  assert.equal(check(lyra, "owner", "lyra", gain), null);
});

test("ownerSpendOnly lets the holder spend, never gain or overwrite", () => {
  assert.equal(check(lyra, "ownerSpendOnly", "lyra", spend), null);
  assert.match(check(lyra, "ownerSpendOnly", "lyra", gain) ?? "", /only spend/);
  assert.match(check(lyra, "ownerSpendOnly", "lyra", { kind: "set", value: -5 }) ?? "", /only spend/);
});

test("a guest's token seat is a player seat, and a screen writes nothing", () => {
  assert.equal(check(guest, "owner", "bran", set), null);
  assert.match(check(guest, "owner", "lyra", set) ?? "", /Not your character/);
  for (const by of BY) assert.match(check(screen, by, "lyra", spend) ?? "", /Not your character/);
});
