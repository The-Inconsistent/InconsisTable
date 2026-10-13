import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { actorScope, instantDeathAt, resetValues } from "../derived.ts";
import { SAMPLE_D20 } from "../fixtures/sample-d20.ts";
import type { ConditionState, RuleState } from "./primitive.ts";
import { actor, applyDeltas, C, deltas, INIT, refusal } from "./test-helpers.ts";

// health.tracks: what house decisions 7 and 13 leave to the ruleset

function withDeathRules(deathSaves: Record<string, number>, track: Record<string, unknown> = {}) {
  const [first] = C.ruleset.health.tracks;
  assert.ok(first?.deathSaves !== undefined);
  return { ...C.ruleset.health, tracks: [{ ...first, ...track, deathSaves: { ...first.deathSaves, ...deathSaves } }] };
}

function hit({ params, state, input }: { params: unknown; state: RuleState; input: Record<string, unknown> }) {
  return applyDeltas(state, deltas({ primitive: "health.tracks", op: "damage", params, state, input })).actors.pc1;
}

test("damage while dying: failures only when the ruleset declares them, a critical counts its own number", () => {
  const params = withDeathRules({ failuresOnDamage: 1, failuresOnCriticalDamage: 2 });
  const dying = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying", deathSaveFailures: 0 } });
  const one = hit({ params, state: dying, input: { actorId: "pc1", amount: 3 } });
  assert.equal(one?.fields.deathSaveFailures, 1);
  assert.equal(one?.fields.healthState, "dying");
  assert.equal(
    hit({ params, state: dying, input: { actorId: "pc1", amount: 3, critical: true } })?.fields.deathSaveFailures,
    2,
  );
  // The last failure kills.
  const last = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying", deathSaveFailures: 2 } });
  assert.equal(hit({ params, state: last, input: { actorId: "pc1", amount: 1 } })?.fields.healthState, "dead");
  // Temporary points that soak the whole hit leave no damage for the track: no failure.
  const soaked = actor({
    hp: { value: 0, min: 0, max: 15 },
    tempHp: { value: 5, min: 0, max: null },
    fields: { healthState: "dying", deathSaveFailures: 0 },
  });
  assert.equal(hit({ params, state: soaked, input: { actorId: "pc1", amount: 3 } })?.fields.deathSaveFailures, 0);
  // Without the parameter the P0 behaviour stands (decision 7): a hit on a dying actor changes nothing.
  const plain = { primitive: "health.tracks", op: "damage", params: C.ruleset.health, state: dying };
  assert.deepEqual(deltas({ ...plain, input: { actorId: "pc1", amount: 3 } }), []);
});

test("instant death: overflow at or past the threshold kills, below it starts dying (decision 13)", () => {
  const params = withDeathRules({}, { instantDeathOverflow: "derived.maxHp" });
  const five = actor({ hp: { value: 5, min: 0, max: 15, instantDeathAt: 15 } });
  // 5 hp left, 20 damage: overflow 15, equal to the threshold.
  const dead = hit({ params, state: five, input: { actorId: "pc1", amount: 20 } });
  assert.equal(dead?.fields.healthState, "dead");
  assert.equal(dead?.resources.hp?.value, 0);
  // Overflow 14: dying, not dead.
  assert.equal(hit({ params, state: five, input: { actorId: "pc1", amount: 19 } })?.fields.healthState, "dying");
  // At the minimum already, the whole hit is overflow.
  const dying = actor({ hp: { value: 0, min: 0, max: 15, instantDeathAt: 15 }, fields: { healthState: "dying" } });
  assert.equal(hit({ params, state: dying, input: { actorId: "pc1", amount: 15 } })?.fields.healthState, "dead");
  // Temporary points count as soaked, not overflow.
  const warded = actor({
    hp: { value: 5, min: 0, max: 15, instantDeathAt: 15 },
    tempHp: { value: 10, min: 0, max: null },
  });
  assert.equal(hit({ params, state: warded, input: { actorId: "pc1", amount: 24 } })?.fields.healthState, "dying");
  // No threshold evaluated by the caller: nothing is instant.
  const none = actor({ hp: { value: 5, min: 0, max: 15 } });
  assert.equal(hit({ params, state: none, input: { actorId: "pc1", amount: 500 } })?.fields.healthState, "dying");
});

test("instantDeathOverflow compiles against the actor scope and instantDeathAt evaluates it", () => {
  const m = structuredClone(SAMPLE_D20);
  const track = m.health?.tracks?.[0];
  assert.ok(track !== undefined);
  track.instantDeathOverflow = "derived.maxHp + 1";
  const r = compileRuleset(m);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (!r.ok) return;
  const scope = actorScope({ fields: {}, derived: { maxHp: 12 } });
  assert.equal(instantDeathAt({ compiled: r.compiled, resource: "hp", scope }), 13);
  assert.equal(instantDeathAt({ compiled: r.compiled, resource: "tempHp", scope }), null);
  track.instantDeathOverflow = "derived.nope";
  const bad = compileRuleset(m);
  assert.ok(!bad.ok && bad.problems.some((p) => p.path === "health.tracks[0].instantDeathOverflow"));
});

// conditions.expire

function row(id: string, expiresOn: ConditionState["expiresOn"], expiresAfter: number | null): ConditionState {
  return { id, conditionId: id, expiresOn, expiresAfter };
}

function tableState(): RuleState {
  const hp = { value: 1, min: 0, max: 5 };
  return {
    turn: { round: 1, currentId: "b", order: ["b", "a"] },
    actors: {
      a: {
        id: "a",
        fields: {},
        resources: { hp },
        conditions: [row("a-dazed", "roundEnd", 2), row("a-stag", "ownTurnEnd", 1), row("a-marked", "manual", null)],
      },
      b: {
        id: "b",
        fields: {},
        resources: { hp },
        conditions: [
          row("b-stag", "ownTurnEnd", 2),
          row("b-brace", "encounterEnd", 3),
          row("b-dazed", "roundEnd", null),
        ],
      },
    },
  };
}

const expireOp = (op: string, state: RuleState, input: unknown = {}) =>
  deltas({ primitive: "conditions.expire", op, params: {}, state, input });

const ids = (state: RuleState, actorId: string) => state.actors[actorId]?.conditions?.map((c) => c.id);

test("conditions.expire: an own-turn condition counts down on its holder's turn end and goes at zero", () => {
  const s = tableState();
  // b has 2 turns left: one tick, still there.
  const first = expireOp("turnEnd", s, { actorId: "b" });
  assert.deepEqual(first, [{ target: { actorId: "b", condition: "b-stag" }, kind: "add", value: -1 }]);
  const mid = applyDeltas(s, first);
  assert.deepEqual(
    mid.actors.b?.conditions?.map((c) => [c.id, c.expiresAfter]),
    [
      ["b-stag", 1],
      ["b-brace", 3],
      ["b-dazed", null],
    ],
  );
  // The next turn end removes it; other expiries and other actors are untouched.
  const second = expireOp("turnEnd", mid, { actorId: "b" });
  assert.deepEqual(second, [{ target: { actorId: "b", condition: "b-stag" }, kind: "set", value: null }]);
  assert.deepEqual(ids(applyDeltas(mid, second), "b"), ["b-brace", "b-dazed"]);
  assert.equal(ids(applyDeltas(s, first), "a")?.length, 3);
  // An uncounted ownTurnEnd row (null) ends at the first (decision 14).
  const lone = actor({});
  const pc = lone.actors.pc1;
  assert.ok(pc !== undefined);
  const open: RuleState = { ...lone, actors: { pc1: { ...pc, conditions: [row("x", "ownTurnEnd", null)] } } };
  assert.deepEqual(expireOp("turnEnd", open, { actorId: "pc1" }), [
    { target: { actorId: "pc1", condition: "x" }, kind: "set", value: null },
  ]);
  assert.equal(
    refusal({ primitive: "conditions.expire", op: "turnEnd", params: {}, state: s, input: { actorId: "z" } }),
    "unknownActor",
  );
});

test("conditions.expire: round end counts rounds in initiative order; encounter end clears whatever count is left", () => {
  const s = tableState();
  // The order is b, a: b's uncounted row goes first, then a's counted row ticks.
  assert.deepEqual(expireOp("roundEnd", s), [
    { target: { actorId: "b", condition: "b-dazed" }, kind: "set", value: null },
    { target: { actorId: "a", condition: "a-dazed" }, kind: "add", value: -1 },
  ]);
  // A holder outside the order follows the ones in it.
  const loose: RuleState = { ...s, turn: { round: 1, currentId: null, order: ["a"] } };
  const holders = expireOp("roundEnd", loose).map((d) => ("actorId" in d.target ? d.target.actorId : ""));
  assert.deepEqual(holders, ["a", "b"]);
  assert.deepEqual(expireOp("encounterEnd", s), [
    { target: { actorId: "b", condition: "b-brace" }, kind: "set", value: null },
  ]);
  // `manual` never expires.
  const all = [...expireOp("roundEnd", s), ...expireOp("encounterEnd", s), ...expireOp("turnEnd", s, { actorId: "a" })];
  assert.ok(!all.some((d) => "condition" in d.target && d.target.condition === "a-marked"));
});

test("a turn change in the order decision 15 gives: advance, the turn's own expiries, then the round's", () => {
  // a is last in the order; `next` wraps to round 2.
  const s: RuleState = { ...tableState(), turn: { round: 1, currentId: "a", order: ["b", "a"] } };
  const next = deltas({ primitive: "initiative.ranked", op: "next", params: INIT, state: s, input: {} });
  const advanced = applyDeltas(s, next);
  assert.equal(advanced.turn?.round, 2);
  const end = expireOp("turnEnd", advanced, { actorId: "a" });
  assert.deepEqual(end, [{ target: { actorId: "a", condition: "a-stag" }, kind: "set", value: null }]);
  const rounds = expireOp("roundEnd", applyDeltas(advanced, end));
  assert.deepEqual(
    rounds.map((d) => ("condition" in d.target ? d.target.condition : "")),
    ["b-dazed", "a-dazed"],
  );
});

// rest

function restState(): RuleState {
  const pc = (id: string, focus: number, strain: number) => ({
    id,
    fields: {},
    resources: {
      hp: { value: 4, min: 0, max: 15, reset: { longRest: 15 } },
      focus: { value: focus, min: 0, max: 1, reset: { shortRest: 1, longRest: 1 } },
      strain: { value: strain, min: 1, max: 5, reset: { shortRest: 1 } },
    },
  });
  return {
    turn: null,
    actors: {
      pc1: pc("pc1", 0, 4),
      pc2: pc("pc2", 1, 1),
      pool: {
        id: "pool",
        fields: {},
        resources: { menace: { value: 3, min: 0, max: 6, reset: { encounterEnd: 0, sessionStart: 6 } } },
      },
    },
  };
}

const restOp = (state: RuleState, input: unknown) =>
  deltas({ primitive: "rest", op: "apply", params: {}, state, input });

test("rest: each resource resets to the value for the event, inside its bounds", () => {
  const s = restState();
  // Reset to max (focus) and to min (strain); hp has no short-rest reset, and pc2 is already there.
  assert.deepEqual(restOp(s, { event: "shortRest" }), [
    { target: { actorId: "pc1", resource: "focus" }, kind: "add", value: 1 },
    { target: { actorId: "pc1", resource: "strain" }, kind: "add", value: -3 },
  ]);
  // A long rest does not run the short-rest strain reset (decision 16); hp and focus go to max.
  assert.deepEqual(restOp(s, { event: "longRest", actorIds: ["pc1"] }), [
    { target: { actorId: "pc1", resource: "hp" }, kind: "add", value: 11 },
    { target: { actorId: "pc1", resource: "focus" }, kind: "add", value: 1 },
  ]);
  // A pool resets to its min on encounter end and to its max on session start.
  assert.deepEqual(restOp(s, { event: "encounterEnd" }), [
    { target: { actorId: "pool", resource: "menace" }, kind: "add", value: -3 },
  ]);
  assert.deepEqual(restOp(s, { event: "sessionStart" }), [
    { target: { actorId: "pool", resource: "menace" }, kind: "add", value: 3 },
  ]);
  // An event nobody answers to, and a second run: nothing to write.
  assert.deepEqual(restOp(s, { event: "sessionEnd" }), []);
  assert.deepEqual(restOp(applyDeltas(s, restOp(s, { event: "shortRest" })), { event: "shortRest" }), []);
  // A reset value outside the bounds is held inside them.
  const tight = actor({ hp: { value: 2, min: 1, max: 3, reset: { longRest: 9 } } });
  assert.deepEqual(restOp(tight, { event: "longRest" }), [
    { target: { actorId: "pc1", resource: "hp" }, kind: "add", value: 1 },
  ]);
  const bad = (input: unknown) => refusal({ primitive: "rest", op: "apply", params: {}, state: s, input });
  assert.equal(bad({ event: "longRest", actorIds: ["nobody"] }), "unknownActor");
  assert.equal(bad({ event: "naptime" }), "badInput");
});

test("resetValues evaluates a resource's resets for one holder", () => {
  const scope = actorScope({ fields: {}, derived: { maxHp: 12 }, party: { characters: 3 } });
  assert.deepEqual(resetValues({ compiled: C, resource: "hp", scope }), { longRest: 12 });
  assert.deepEqual(resetValues({ compiled: C, resource: "focus", scope }), { shortRest: 1, longRest: 1 });
  assert.deepEqual(resetValues({ compiled: C, resource: "luck", scope }), { sessionStart: 0 });
  assert.deepEqual(resetValues({ compiled: C, resource: "menace", scope }), { encounterEnd: 0 });
  assert.deepEqual(resetValues({ compiled: C, resource: "tempHp", scope }), {});
});
