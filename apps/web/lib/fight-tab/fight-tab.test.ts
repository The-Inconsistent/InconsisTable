import assert from "node:assert/strict";
import { test } from "node:test";

import type { Combatant, Encounter } from "@inconsistable/core-schema";

import { fightTabOf } from "./fight-tab.ts";

const cb = (id: string, ord: number, over: Partial<Combatant> = {}): Combatant => ({
  id,
  actorId: `a-${id}`,
  name: id,
  side: "foe",
  ord,
  initiative: null,
  visibility: "full",
  keep: false,
  hp: null,
  bar: null,
  states: [],
  members: null,
  conditions: [],
  ...over,
});
const fight = (over: Partial<Encounter> = {}): Encounter => ({
  id: "e",
  round: 1,
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
  // Sent out of order: the order is the combatants' ord.
  combatants: [cb("wolf", 2), cb("me", 1), cb("rat", 0), cb("bat", 3)],
  ...over,
});

test("a classic order: the plate, YOU, and the others placed after the seat's combatant", () => {
  const f = fightTabOf({ encounter: fight({ currentId: "rat" }), held: ["a-me"] });
  assert.deepEqual(f.acting, { kind: "combatant", name: "rat", mine: false });
  assert.deepEqual([...f.mine], ["me"]);
  assert.deepEqual(f.after, { count: 2, of: 3 });
  assert.deepEqual(fightTabOf({ encounter: fight({ currentId: "me" }), held: ["a-me"] }).acting, {
    kind: "combatant",
    name: "me",
    mine: true,
  });
});

test("a hidden combatant's turn is said, never named; nobody up is no plate", () => {
  assert.deepEqual(fightTabOf({ encounter: fight({ unseen: true }), held: [] }).acting, { kind: "unseen" });
  assert.equal(fightTabOf({ encounter: fight(), held: [] }).acting, null);
});

test("a seat with nobody in the fight has no after-you count", () => {
  const f = fightTabOf({ encounter: fight(), held: ["a-nobody"] });
  assert.equal(f.after, null);
  assert.equal(f.mine.size, 0);
});

test("a sides order counts the others still to act this round, not their place", () => {
  const sided = fight({
    begun: true,
    lastSide: null,
    outOfTurnSide: null,
    sideUp: "foe",
    currentId: "wolf",
    done: ["rat"],
    combatants: [
      cb("rat", 0, { held: false, barred: false, unable: false }),
      cb("me", 1, { side: "pc", held: false, barred: false, unable: false }),
      cb("wolf", 2, { held: false, barred: false, unable: false }),
      cb("bat", 3, { held: true, barred: false, unable: false }),
      cb("owl", 4, { held: false, barred: false, unable: true }),
    ],
  });
  // rat done, wolf acting, owl out: only the holding bat is still to act.
  assert.deepEqual(fightTabOf({ encounter: sided, held: ["a-me"] }).after, { count: 1, of: 4 });
});
