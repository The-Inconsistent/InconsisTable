import assert from "node:assert/strict";
import { test } from "node:test";

import type { Combatant, Encounter } from "@inconsistable/core-schema";

import { endingThisTurn } from "./reminders.ts";

const combatant = (id: string, conditions: Combatant["conditions"]): Combatant => ({
  id,
  actorId: `actor-${id}`,
  name: id,
  side: "ally",
  ord: 0,
  initiative: null,
  visibility: "full",
  keep: false,
  hp: null,
  bar: null,
  states: [],
  members: null,
  conditions,
});

const fight = (currentId: string | null): Encounter =>
  ({
    currentId,
    conditionDefs: [
      { id: "dazed", label: "Dazed", duration: "ownTurnEnd" },
      { id: "slowed", label: "Slowed", duration: "ownTurnEnd" },
    ],
    combatants: [
      combatant("a", [
        { id: "dazed", left: 1, expiresOn: "ownTurnEnd" },
        { id: "slowed", left: 2, expiresOn: "ownTurnEnd" },
        { id: "marked", left: 1, expiresOn: "roundEnd" },
        { id: "bound", left: null, expiresOn: "manual" },
      ]),
      combatant("b", [{ id: "slowed", left: 1, expiresOn: "ownTurnEnd" }]),
    ],
  }) as unknown as Encounter;

test("an own-turn condition with one turn left ends with the acting combatant's turn", () => {
  assert.deepEqual(endingThisTurn(fight("a")), ["Dazed"]);
  assert.deepEqual(endingThisTurn(fight("b")), ["Slowed"]);
});

test("nothing ends between turns", () => {
  assert.deepEqual(endingThisTurn(fight(null)), []);
});
