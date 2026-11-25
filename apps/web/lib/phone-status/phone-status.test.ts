import assert from "node:assert/strict";
import { test } from "node:test";

import type { Combatant, Encounter } from "@inconsistable/core-schema";

import { phoneStatusOf } from "./phone-status.ts";

const cb = (id: string): Combatant => ({
  id,
  actorId: `a-${id}`,
  name: id,
  side: "pc",
  ord: 0,
  initiative: null,
  visibility: "full",
  keep: false,
  hp: null,
  bar: null,
  states: [],
  members: null,
  conditions: [],
});
const fight = (over: Partial<Encounter> = {}): Encounter => ({
  id: "e",
  round: 3,
  currentId: null,
  firstId: null,
  phaseId: null,
  phases: [],
  done: [],
  firstPlayer: null,
  paused: false,
  health: null,
  conditionDefs: [],
  endMet: [],
  scoring: null,
  combatants: [cb("me"), cb("foe")],
  ...over,
});
const held = ["a-me"];

test("no fight", () => {
  assert.deepEqual(phoneStatusOf({ encounter: null, held, showRound: true }), { line: "noFight" });
});

test("your turn, but not in a paused fight", () => {
  const e = fight({ currentId: "me" });
  assert.deepEqual(phoneStatusOf({ encounter: e, held, showRound: false }), { line: "yourTurn" });
  assert.deepEqual(phoneStatusOf({ encounter: { ...e, paused: true }, held, showRound: true }), {
    line: "round",
    round: 3,
  });
});

test("done once the seat's character has ended its turn", () => {
  const e = fight({ currentId: "foe", done: ["me"] });
  assert.deepEqual(phoneStatusOf({ encounter: e, held, showRound: true }), { line: "done" });
});

test("the round only where the ruleset marks it", () => {
  const e = fight({ currentId: "foe" });
  assert.deepEqual(phoneStatusOf({ encounter: e, held, showRound: true }), { line: "round", round: 3 });
  assert.equal(phoneStatusOf({ encounter: e, held, showRound: false }), null);
});

test("a seat with no character in the order is never done", () => {
  assert.equal(phoneStatusOf({ encounter: fight({ done: ["foe"] }), held: ["a-x"], showRound: false }), null);
});
