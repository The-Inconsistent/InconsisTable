import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { actorScope } from "./derived.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import { validateRuleset } from "./manifest.ts";
import { armedTicks } from "./primitives/conditions-expire.ts";
import { runOp } from "./primitives/registry.ts";
import { applyDeltas, deltas, refusal } from "./primitives/test-helpers.ts";
import type { RuleState } from "./primitives/primitive.ts";
import { remindersOf, type ReminderActor } from "./reminders.ts";

// House decision #81 on the invented sides fixture: reminders, a condition's line, arming, immunity, refused rests.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problems));
  return r.compiled;
})();

const warden = (over: Partial<ReminderActor> & { hp?: number } = {}): ReminderActor => ({
  scope: actorScope({ fields: { level: 1 }, derived: { maxHp: 10 }, resources: { hp: over.hp ?? 10 } }),
  conditions: [],
  held: false,
  barred: false,
  ...over,
});

test("a turn's start shows the reminders that hold for whoever acts, then its conditions' lines", () => {
  const lines = (a: ReminderActor) =>
    remindersOf({ ruleset: compiled, at: "turnStart", actors: { w: a }, order: ["w"], round: 1 }).map((l) => l.id);
  assert.deepEqual(lines(warden()), []);
  assert.deepEqual(lines(warden({ hp: 4 })), ["rally"]);
  assert.deepEqual(lines(warden({ hp: 4, conditions: ["burning"] })), ["rally", "burning"]);
  // Values it cannot read hold for nobody.
  assert.deepEqual(lines(warden({ scope: null, conditions: ["burning"] })), ["burning"]);
});

test("a turn's end shows a reminder with no `if` naming nobody", () => {
  const lines = remindersOf({ ruleset: compiled, at: "turnEnd", actors: { w: warden() }, order: ["w"], round: 2 });
  assert.deepEqual(lines, [
    { source: "reminder", id: "footing", text: "Check footing on broken ground", cite: "Sample p.19", actorIds: [] },
  ]);
});

test("the round's end asks every combatant and names the ones each line holds for, once per line", () => {
  const actors = {
    a: warden({ held: true }),
    b: warden({ barred: true }),
    c: warden({ held: true, barred: true }),
  };
  const at = (round: number) =>
    remindersOf({ ruleset: compiled, at: "roundEnd", actors, order: ["a", "b", "c", "gone"], round }).map((l) => [
      l.id,
      l.actorIds,
    ]);
  assert.deepEqual(at(1), [
    ["heldLost", ["a", "c"]],
    ["offGuardEnds", ["b", "c"]],
  ]);
  assert.deepEqual(at(2), [["heldLost", ["a", "c"]]]);
});

test("a condition armed from the holder's next turn starts at 2 only when added during that holder's own turn", () => {
  const reeling = { duration: "ownTurnEnd" as const, from: "nextOwnTurn" as const };
  assert.equal(armedTicks({ def: reeling, holderActing: true, typed: null }), 2);
  assert.equal(armedTicks({ def: reeling, holderActing: false, typed: null }), null);
  assert.equal(armedTicks({ def: reeling, holderActing: true, typed: 4 }), 4);
  assert.equal(armedTicks({ def: { duration: "ownTurnEnd" }, holderActing: true, typed: null }), null);
});

test("the manifest checks each new declaration", () => {
  const problems = (over: object) => {
    const v = validateRuleset({ ...SAMPLE_SKIRMISH, ...over });
    return v.ok ? [] : v.problems.map((p) => `${p.path}: ${p.message}`);
  };
  const conditions = SAMPLE_SKIRMISH.conditions ?? [];
  assert.deepEqual(problems({}), []);
  assert.deepEqual(
    problems({ conditions: [...conditions, { id: "x", label: "X", duration: "manual", at: "turnEnd" }] }),
    ["conditions[6].cite: a rule entry needs a cite", "conditions[6]: a reminder needs both at and text"],
  );
  assert.deepEqual(
    problems({ conditions: [{ id: "x", label: "X", cite: "p", duration: "roundEnd", from: "nextOwnTurn" }] }),
    ["conditions[0].from: only an ownTurnEnd condition is armed from a turn"],
  );
  assert.deepEqual(problems({ reminders: [{ id: "r", at: "turnEnd", text: "Go" }] }), [
    "reminders[0].cite: a rule entry needs a cite",
  ]);
  assert.deepEqual(problems({ rests: [{ event: "longRest", refusedIn: ["asleep"], cite: "p" }] }), [
    'rests[0].refusedIn[0]: unknown health state "asleep"',
  ]);
  const notBool = compileRuleset({
    ...SAMPLE_SKIRMISH,
    reminders: [{ id: "r", at: "turnEnd", text: "Go", if: "level", cite: "p" }],
  });
  assert.equal(notBool.ok, false);
});

test("a whole side is barred at once, skipping who has acted or is acting, and freed at once", () => {
  const params = SAMPLE_SKIRMISH.initiative;
  const turn = {
    round: 1,
    currentId: "w2",
    order: ["w1", "w2", "w3", "r1"],
    sideOf: { w1: "wardens", w2: "wardens", w3: "wardens", r1: "raiders" },
    done: ["w3"],
    barred: ["r1"],
    begun: true,
  };
  const state: RuleState = { actors: {}, turn };
  const go = (input: object, s: RuleState = state) =>
    applyDeltas(s, deltas({ primitive: "initiative.sides", op: "bar", params, state: s, input }));
  const barred = go({ side: "wardens", barred: true });
  assert.deepEqual(barred.turn?.barred, ["r1", "w1"]);
  assert.deepEqual(go({ side: "raiders", barred: false }, barred).turn?.barred, ["w1"]);
  const why = (input: object, s: RuleState = state) => {
    const r = runOp({ primitive: "initiative.sides", op: "bar", params, state: s, input });
    return r.ok ? null : r.refusal.message;
  };
  assert.equal(why({ side: "nobody", barred: true }), '"nobody" is not a side');
  assert.equal(
    refusal({
      primitive: "initiative.sides",
      op: "bar",
      params,
      state,
      input: { side: "wardens", id: "w1", barred: true },
    }),
    "badInput",
  );
  assert.equal(
    refusal({ primitive: "initiative.sides", op: "bar", params, state, input: { barred: true } }),
    "badInput",
  );
  assert.equal(why({ side: "wardens", barred: true }, { ...state, turn: { ...turn, round: 2 } }), "barring is over");
});
