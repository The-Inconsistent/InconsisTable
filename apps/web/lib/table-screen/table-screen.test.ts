import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20, SAMPLE_D20_0_1_11 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { screenCardsOf } from "./table-screen.ts";

const actor = (id: string, kind: Actor["kind"], entity: string) =>
  ({ id, kind, entity, name: id, fields: {}, resources: {}, derived: {}, conditions: [] }) as unknown as Actor;
const actors = [
  actor("ash", "pc", "character"),
  actor("wolf", "creature", "creature"),
  actor("rat", "creature", "creature"),
];
const encounter = {
  combatants: [
    { actorId: "wolf", visibility: "full" },
    { actorId: "rat", visibility: "bar" },
  ],
} as unknown as LiveState["encounter"];

test("the screen draws a card per party character and per creature shown in full, from the screen layout", () => {
  // The sample lays out no creature row (its creatures' most Vigour is the GM's), so this one adds a shared row.
  const layout = SAMPLE_D20.layout ?? {};
  const ruleset = Ruleset.parse({
    ...SAMPLE_D20,
    layout: { ...layout, sheet: { ...layout.sheet!, screen: [{ widget: "track", bind: { value: "res.hp" } }] } },
  });
  const cards = screenCardsOf({ ruleset, state: { actors, encounter } });
  assert.deepEqual(
    cards.party.map((c) => c.actor.id),
    ["ash"],
  );
  assert.deepEqual(
    cards.shown.map((c) => c.actor.id),
    ["wolf"],
  );
  assert.deepEqual(screenCardsOf({ ruleset, state: { actors, encounter: null } }).shown, []);
});

test("a ruleset without a screen layout draws no card", () => {
  const cards = screenCardsOf({ ruleset: Ruleset.parse(SAMPLE_D20_0_1_11), state: { actors, encounter } });
  assert.deepEqual(cards, { party: [], shown: [] });
  assert.deepEqual(screenCardsOf({ ruleset: null, state: { actors, encounter } }), { party: [], shown: [] });
});
