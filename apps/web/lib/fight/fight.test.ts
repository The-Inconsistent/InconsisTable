import assert from "node:assert/strict";
import { test } from "node:test";

import type { Combatant, Encounter } from "@inconsistable/core-schema";
import { fightOf } from "@inconsistable/rules-engine";

import { afterYou, nextUp, turnOf, UNSEEN_ACTOR } from "./fight.ts";

const cb = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  actorId: `a-${id}`,
  name: id.toUpperCase(),
  side: "party",
  ord: 0,
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
const fight = (over: Partial<Encounter>, combatants: Combatant[]): Encounter => ({
  id: "e",
  round: 2,
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
  combatants,
  ...over,
});
const ranked = [cb("x", { ord: 0 }), cb("y", { ord: 1 }), cb("f", { ord: 2, side: "foe" })];

test("the fight as the engine reads it names the actor acting, the sides, who holds and the round's uses", () => {
  const e = fight({ currentId: "f" }, [cb("x", { held: true, used: ["rally"] }), cb("f", { side: "foe" })]);
  const t = turnOf(e);
  assert.deepEqual(t, {
    round: 2,
    currentId: "a-f",
    order: ["a-x", "a-f"],
    sideOf: { "a-x": "party", "a-f": "foe" },
    held: ["a-x"],
    barred: [],
    used: ["2:a-x:rally"],
  });
  assert.equal(fightOf({ turn: t }, "a-x").foeActing, true);
  assert.equal(fightOf({ turn: t }, "a-x").held, true);
  // Someone the seat is not sent acts: another side's (house decision #116).
  const unseen = turnOf(fight({ unseen: true }, [cb("x")]));
  assert.equal(unseen?.currentId, UNSEEN_ACTOR);
  assert.equal(fightOf({ turn: unseen }, "a-x").foeActing, true);
  assert.equal(turnOf(null), null);
});

test("on the seat's turn it counts who acts after it; off its turn nothing", () => {
  assert.deepEqual(afterYou({ encounter: fight({ currentId: "x" }, ranked), held: ["a-x"] }), { after: 2, of: 2 });
  assert.deepEqual(afterYou({ encounter: fight({ currentId: "y" }, ranked), held: ["a-y"] }), { after: 1, of: 2 });
  assert.equal(afterYou({ encounter: fight({ currentId: "y" }, ranked), held: ["a-x"] }), null);
  // A sides order counts the ones still ready or holding, wherever they sit.
  const sided = fight({ currentId: "y", begun: true, done: ["x"] }, [
    cb("x"),
    cb("y"),
    cb("f", { side: "foe", held: true }),
    cb("g", { side: "foe", unable: true }),
  ]);
  assert.deepEqual(afterYou({ encounter: sided, held: ["a-y"] }), { after: 1, of: 3 });
});

test("who acts next in a ranked order; none at the round's end or in a sides order", () => {
  assert.equal(nextUp(fight({ currentId: "x" }, ranked)), "Y");
  assert.equal(nextUp(fight({ currentId: "f" }, ranked)), null);
  assert.equal(nextUp(fight({ currentId: "x", begun: true }, ranked)), null);
});
