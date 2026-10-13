import { test } from "node:test";
import assert from "node:assert/strict";
import { toSeatEncounter, type Combatant, type Encounter } from "./encounter.ts";
import type { Ctx } from "./seat.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({ campaignId: "c1", userId: "u", campaignOwnerId: "owner", seat });
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const coCombat = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
const coCodex = ctx({ kind: "member", role: "cogm", scopes: ["codex"], characterIds: [] });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const bran = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

const combatant = (id: string, visibility: Combatant["visibility"]): Combatant => ({
  id,
  actorId: `a-${id}`,
  name: id,
  side: "foe",
  ord: 0,
  initiative: 10,
  visibility,
  keep: true,
  hp: { value: 3, max: 7 },
  bar: 3 / 7,
  conditions: [{ id: "dazed", left: 2, expiresOn: "roundEnd" }],
});
const encounter = (currentId: string): Encounter => ({
  id: "e",
  round: 2,
  currentId,
  health: null,
  conditionDefs: [{ id: "dazed", label: "Dazed", duration: "roundEnd" }],
  combatants: [combatant("sneak", "hidden"), combatant("wisp", "bar"), combatant("boss", "full")],
});

test("the combat side sees the whole encounter", () => {
  for (const seat of [gm, coCombat])
    assert.deepEqual(toSeatEncounter({ encounter: encounter("wisp"), ctx: seat }), encounter("wisp"));
});

test("everyone else loses hidden combatants, and the numbers of `bar` ones", () => {
  for (const seat of [lyra, bran, screen, coCodex]) {
    const v = toSeatEncounter({ encounter: encounter("wisp"), ctx: seat })!;
    assert.deepEqual(
      v.combatants.map((x) => x.id),
      ["wisp", "boss"],
      "the hidden combatant is absent",
    );
    assert.equal(v.combatants[0]?.hp, null, "a bar shows no numbers");
    assert.equal(v.combatants[0]?.bar, 3 / 7);
    assert.deepEqual(v.combatants[1]?.hp, { value: 3, max: 7 }); // full: the api narrows it by the viewer view
    assert.ok(v.combatants.every((x) => !x.keep && x.conditions.length === 0));
    assert.equal(v.round, 2);
    assert.deepEqual(v.conditionDefs, []);
    assert.equal(v.currentId, "wisp");
  }
});

test("a hidden combatant's turn is not announced, and no encounter stays none", () => {
  assert.equal(toSeatEncounter({ encounter: encounter("sneak"), ctx: lyra })?.currentId, null);
  assert.equal(toSeatEncounter({ encounter: null, ctx: lyra }), null);
});
