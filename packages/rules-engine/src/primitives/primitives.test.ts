import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { compileRuleset, type CompiledRuleset } from "../compile.ts";
import type { FieldValue } from "../derived.ts";
import { SAMPLE_D20 } from "../fixtures/sample-d20.ts";
import { resolveSumVsTarget } from "./dice-sum-vs-target.ts";
import { HealthTracksParams } from "./health-tracks.ts";
import { rankOrder } from "./initiative-ranked.ts";
import {
  checkDeltas,
  defineOp,
  type Delta,
  type Primitive,
  type ResourceState,
  type RuleState,
  type TurnState,
} from "./primitive.ts";
import { PRIMITIVES, runOp } from "./registry.ts";
import { clampResource } from "./resource-capped.ts";

function compiled(): CompiledRuleset {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}
const C = compiled();
const CHECK = C.tests.check?.def;
const INIT = C.initiative.def;
const HEALTH = HealthTracksParams.parse(C.ruleset.health);

function actor({
  id = "pc1",
  hp = { value: 10, min: 0, max: 15 },
  tempHp,
  fields = {},
}: {
  id?: string;
  hp?: ResourceState;
  tempHp?: ResourceState;
  fields?: Record<string, FieldValue>;
}): RuleState {
  const resources: Record<string, ResourceState> = { hp, ...(tempHp === undefined ? {} : { tempHp }) };
  return { actors: { [id]: { id, fields, resources } }, turn: null };
}

function deltas(args: Parameters<typeof runOp>[0]): Delta[] {
  const r = runOp(args);
  if (!r.ok) throw new Error(`${r.refusal.code}: ${r.refusal.message}`);
  return r.deltas;
}

function refusal(args: Parameters<typeof runOp>[0]): string {
  const r = runOp(args);
  assert.equal(r.ok, false, "should be refused");
  return r.ok ? "" : r.refusal.code;
}

/** Applies deltas to a copy of the state, the way the pipeline would write them. */
function applyDeltas(state: RuleState, list: readonly Delta[]): RuleState {
  const actors = structuredClone(state.actors) as Record<
    string,
    { id: string; fields: Record<string, FieldValue>; resources: Record<string, ResourceState> }
  >;
  let turn: TurnState | null = state.turn === null ? null : { ...state.turn };
  for (const d of list) {
    const t = d.target;
    if ("turn" in t) {
      turn ??= { round: 0, currentId: null, order: [] };
      if (t.turn === "round" && typeof d.value === "number") turn.round = d.value;
      if (t.turn === "currentId" && (typeof d.value === "string" || d.value === null)) turn.currentId = d.value;
      if (t.turn === "order" && Array.isArray(d.value)) turn.order = d.value;
      continue;
    }
    if (!("actorId" in t)) continue;
    const a = actors[t.actorId];
    assert.ok(a !== undefined);
    if ("resource" in t) {
      const res = a.resources[t.resource];
      assert.ok(res !== undefined && typeof d.value === "number");
      res.value = d.kind === "add" ? res.value + d.value : d.value;
    } else a.fields[t.field] = d.value;
  }
  return { actors, turn };
}

// dice.sumVsTarget

test("sumVsTarget: faces plus modifier against the target", () => {
  assert.ok(CHECK !== undefined);
  const resolve = (input: Parameters<typeof resolveSumVsTarget>[0]["input"]) =>
    resolveSumVsTarget({ params: CHECK, input });
  const base = { target: 12, modifier: 2, advantage: "none" as const };
  assert.deepEqual(resolve({ ...base, roll: { kind: "faces", faces: [10] } }), {
    natural: 10,
    total: 12,
    outcome: "success",
  });
  assert.equal(resolve({ ...base, roll: { kind: "faces", faces: [9] } }).outcome, "failure");
  assert.equal(resolve({ ...base, roll: { kind: "faces", faces: [20] } }).outcome, "critical");
  // A reported total already holds the modifier; a natural is needed to read a crit.
  assert.deepEqual(resolve({ ...base, roll: { kind: "total", total: 15 } }), {
    natural: null,
    total: 15,
    outcome: "success",
  });
  assert.equal(resolve({ ...base, roll: { kind: "total", total: 3, natural: 20 } }).outcome, "critical");
  // The tie rule is the manifest's.
  const beat = { ...CHECK, ties: "beat" as const };
  assert.equal(
    resolveSumVsTarget({ params: beat, input: { ...base, roll: { kind: "faces", faces: [10] } } }).outcome,
    "failure",
  );
});

test("sumVsTarget: advantage keeps the higher of two d20s, disadvantage the lower", () => {
  const out = deltas({
    primitive: "dice.sumVsTarget",
    op: "resolve",
    params: CHECK,
    state: actor({}),
    input: { target: 15, modifier: 1, advantage: "advantage", roll: { kind: "faces", faces: [4, 17] } },
  });
  assert.deepEqual(out, [
    { target: { test: "outcome" }, kind: "set", value: "success" },
    { target: { test: "total" }, kind: "set", value: 18 },
    { target: { test: "natural" }, kind: "set", value: 17 },
  ]);
  const low = deltas({
    primitive: "dice.sumVsTarget",
    op: "resolve",
    params: CHECK,
    state: actor({}),
    input: { target: 15, modifier: 1, advantage: "disadvantage", roll: { kind: "faces", faces: [4, 20] } },
  });
  assert.equal(low[0]?.value, "failure");
});

test("sumVsTarget: refuses faces that do not fit the dice", () => {
  const base = { primitive: "dice.sumVsTarget", op: "resolve", params: CHECK, state: actor({}) };
  assert.equal(refusal({ ...base, input: { target: 10, roll: { kind: "faces", faces: [4, 17] } } }), "badInput");
  assert.equal(refusal({ ...base, input: { target: 10, roll: { kind: "faces", faces: [21] } } }), "badInput");
  assert.equal(
    refusal({ ...base, input: { target: 10, advantage: "advantage", roll: { kind: "faces", faces: [3] } } }),
    "badInput",
  );
  assert.equal(refusal({ ...base, input: { target: 10, roll: { kind: "total", total: 9, natural: 0 } } }), "badInput");
  assert.equal(refusal({ ...base, input: { target: "ten", roll: { kind: "faces", faces: [3] } } }), "badInput");
  const noAdvantage = { ...CHECK, advantage: false };
  assert.equal(
    refusal({
      ...base,
      params: noAdvantage,
      input: { target: 10, advantage: "advantage", roll: { kind: "faces", faces: [3, 4] } },
    }),
    "badInput",
  );
});

// initiative.ranked

test("initiative: score, then tiebreaks, then id", () => {
  assert.deepEqual(
    rankOrder([
      { id: "b", score: 12, tiebreaks: [3] },
      { id: "c", score: 15, tiebreaks: [1] },
      { id: "a", score: 12, tiebreaks: [3] },
      { id: "d", score: 12, tiebreaks: [5] },
    ]),
    ["c", "d", "a", "b"],
  );
});

test("initiative: start, next through the round, wrap to the next round", () => {
  const run = (op: string, state: RuleState, input: unknown = {}) =>
    applyDeltas(state, deltas({ primitive: "initiative.ranked", op, params: INIT, state, input }));
  let s: RuleState = { actors: {}, turn: null };
  s = run("start", s, {
    combatants: [
      { id: "orc", score: 9, tiebreaks: [10] },
      { id: "pc1", score: 17, tiebreaks: [14] },
      { id: "pc2", score: 9, tiebreaks: [16] },
    ],
  });
  assert.deepEqual(s.turn, { round: 1, currentId: "pc1", order: ["pc1", "pc2", "orc"] });
  s = run("next", s);
  assert.equal(s.turn?.currentId, "pc2");
  s = run("next", s);
  s = run("next", s);
  assert.deepEqual(s.turn, { round: 2, currentId: "pc1", order: ["pc1", "pc2", "orc"] });
});

test("initiative: rerollEachRound clears the order at the wrap for a re-rank", () => {
  const params = { ...INIT, rerollEachRound: true };
  const state: RuleState = { actors: {}, turn: { round: 3, currentId: "b", order: ["a", "b"] } };
  const out = deltas({ primitive: "initiative.ranked", op: "next", params, state, input: {} });
  assert.deepEqual(applyDeltas(state, out).turn, { round: 4, currentId: null, order: [] });
  assert.equal(
    refusal({ primitive: "initiative.ranked", op: "next", params, state: applyDeltas(state, out), input: {} }),
    "wrongState",
  );
  const restarted = deltas({
    primitive: "initiative.ranked",
    op: "start",
    params,
    state: applyDeltas(state, out),
    input: { round: 4, combatants: [{ id: "a", score: 1, tiebreaks: [0] }] },
  });
  assert.ok(restarted.some((d) => "turn" in d.target && d.target.turn === "round" && d.value === 4));
});

test("initiative: remove", () => {
  const state: RuleState = { actors: {}, turn: { round: 2, currentId: "b", order: ["a", "b", "c"] } };
  const remove = (id: string, s: RuleState = state) =>
    applyDeltas(s, deltas({ primitive: "initiative.ranked", op: "remove", params: INIT, state: s, input: { id } }))
      .turn;
  // Someone else leaves: the current actor keeps the turn.
  assert.deepEqual(remove("a"), { round: 2, currentId: "b", order: ["b", "c"] });
  // The current actor leaves: the next one acts.
  assert.deepEqual(remove("b"), { round: 2, currentId: "c", order: ["a", "c"] });
  // The last of the round leaves while acting: the next round starts.
  const last: RuleState = { actors: {}, turn: { round: 2, currentId: "c", order: ["a", "b", "c"] } };
  assert.deepEqual(remove("c", last), { round: 3, currentId: "a", order: ["a", "b"] });
  // The only one leaves.
  const alone: RuleState = { actors: {}, turn: { round: 1, currentId: "a", order: ["a"] } };
  assert.deepEqual(remove("a", alone), { round: 1, currentId: null, order: [] });
  assert.equal(
    refusal({ primitive: "initiative.ranked", op: "remove", params: INIT, state, input: { id: "zz" } }),
    "badInput",
  );
  assert.equal(
    refusal({
      primitive: "initiative.ranked",
      op: "remove",
      params: INIT,
      state: { actors: {}, turn: null },
      input: { id: "a" },
    }),
    "noEncounter",
  );
});

test("initiative: refuses duplicates and a wrong tiebreak count", () => {
  const base = { primitive: "initiative.ranked", op: "start", params: INIT, state: { actors: {}, turn: null } };
  const dup = {
    combatants: [
      { id: "a", score: 1, tiebreaks: [0] },
      { id: "a", score: 2, tiebreaks: [0] },
    ],
  };
  assert.equal(refusal({ ...base, input: dup }), "badInput");
  assert.equal(refusal({ ...base, input: { combatants: [{ id: "a", score: 1 }] } }), "badInput");
});

// health.tracks

const health = (op: string, state: RuleState, input: unknown) =>
  deltas({ primitive: "health.tracks", op, params: C.ruleset.health, state, input });

test("damage: temporary points absorb first, then the track", () => {
  const s = actor({ hp: { value: 10, min: 0, max: 15 }, tempHp: { value: 4, min: 0, max: null } });
  assert.deepEqual(health("damage", s, { actorId: "pc1", amount: 6 }), [
    { target: { actorId: "pc1", resource: "tempHp" }, kind: "add", value: -4 },
    { target: { actorId: "pc1", resource: "hp" }, kind: "add", value: -2 },
  ]);
  // All of it soaked: the track is untouched.
  assert.deepEqual(health("damage", s, { actorId: "pc1", amount: 3 }), [
    { target: { actorId: "pc1", resource: "tempHp" }, kind: "add", value: -3 },
  ]);
  // No temp row at all is not an error.
  assert.deepEqual(health("damage", actor({}), { actorId: "pc1", amount: 1 }), [
    { target: { actorId: "pc1", resource: "hp" }, kind: "add", value: -1 },
  ]);
});

test("damage: overflow stops at the min and starts dying", () => {
  const s = actor({ hp: { value: 5, min: 0, max: 15 } });
  const out = health("damage", s, { actorId: "pc1", amount: 40 });
  const after = applyDeltas(s, out).actors.pc1;
  assert.equal(after?.resources.hp?.value, 0);
  assert.equal(after?.fields.healthState, "dying");
  assert.equal(after?.fields.deathSaveFailures, 0);
  // Already dying: more damage changes nothing the engine owns.
  const dying = applyDeltas(s, out);
  assert.deepEqual(health("damage", dying, { actorId: "pc1", amount: 3 }), []);
  // Without death saves there is no dying state.
  const plain = { ...C.ruleset.health, tracks: [{ resource: "hp" }] };
  const noSaves = deltas({
    primitive: "health.tracks",
    op: "damage",
    params: plain,
    state: s,
    input: { actorId: "pc1", amount: 40 },
  });
  assert.deepEqual(noSaves, [{ target: { actorId: "pc1", resource: "hp" }, kind: "add", value: -5 }]);
});

test("heal: capped at max, clears dying, refused when dead", () => {
  const s = actor({ hp: { value: 12, min: 0, max: 15 } });
  assert.deepEqual(health("heal", s, { actorId: "pc1", amount: 10 }), [
    { target: { actorId: "pc1", resource: "hp" }, kind: "add", value: 3 },
  ]);
  // Over a max that has since dropped: healing does not take any away.
  assert.deepEqual(health("heal", actor({ hp: { value: 18, min: 0, max: 15 } }), { actorId: "pc1", amount: 2 }), []);
  const dying = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying", deathSaveFailures: 2 } });
  const after = applyDeltas(dying, health("heal", dying, { actorId: "pc1", amount: 1 })).actors.pc1;
  assert.equal(after?.resources.hp?.value, 1);
  assert.equal(after?.fields.healthState, "ok");
  assert.equal(after?.fields.deathSaveFailures, 0);
  const dead = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dead" } });
  assert.equal(
    refusal({
      primitive: "health.tracks",
      op: "heal",
      params: C.ruleset.health,
      state: dead,
      input: { actorId: "pc1", amount: 5 },
    }),
    "wrongState",
  );
});

test("death saves: the manifest's thresholds make the actor stable or dead", () => {
  let s = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying" } });
  const save = (result: string) => {
    s = applyDeltas(s, health("deathSave", s, { actorId: "pc1", result }));
    return s.actors.pc1?.fields;
  };
  save("success");
  save("failure");
  save("success");
  assert.equal(s.actors.pc1?.fields.healthState, "dying");
  const fields = save("success");
  assert.deepEqual(
    [fields?.deathSaveSuccesses, fields?.deathSaveFailures, fields?.healthState],
    [HEALTH.tracks[0]?.deathSaves?.successes, 1, "stable"],
  );
  // Stable actors do not roll.
  assert.equal(
    refusal({
      primitive: "health.tracks",
      op: "deathSave",
      params: C.ruleset.health,
      state: s,
      input: { actorId: "pc1", result: "success" },
    }),
    "wrongState",
  );

  s = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying", deathSaveFailures: 1 } });
  // criticalFailureCounts is 2 in the sample: 1 + 2 reaches 3 failures.
  assert.equal(save("criticalFailure")?.healthState, "dead");
});

test("death saves: a critical success heals when the manifest says so, otherwise counts once", () => {
  const s = actor({ hp: { value: 0, min: 0, max: 15 }, fields: { healthState: "dying", deathSaveSuccesses: 1 } });
  const after = applyDeltas(s, health("deathSave", s, { actorId: "pc1", result: "criticalSuccess" })).actors.pc1;
  assert.equal(after?.resources.hp?.value, HEALTH.tracks[0]?.deathSaves?.criticalSuccessHeals);
  assert.equal(after?.fields.healthState, "ok");
  const counted = {
    ...C.ruleset.health,
    tracks: [{ resource: "hp", deathSaves: { successes: 2, failures: 2 } }],
  };
  const out = deltas({
    primitive: "health.tracks",
    op: "deathSave",
    params: counted,
    state: s,
    input: { actorId: "pc1", result: "criticalSuccess" },
  });
  assert.equal(applyDeltas(s, out).actors.pc1?.fields.healthState, "stable");
});

test("health: unknown actor, missing track and dead targets are refused", () => {
  const base = { primitive: "health.tracks", params: C.ruleset.health };
  assert.equal(
    refusal({ ...base, op: "damage", state: actor({}), input: { actorId: "nobody", amount: 1 } }),
    "unknownActor",
  );
  assert.equal(
    refusal({ ...base, op: "damage", state: actor({}), input: { actorId: "pc1", amount: 1, track: "mana" } }),
    "badParams",
  );
  assert.equal(refusal({ ...base, op: "damage", state: actor({}), input: { actorId: "pc1", amount: -1 } }), "badInput");
  const noHp: RuleState = { actors: { pc1: { id: "pc1", fields: {}, resources: {} } }, turn: null };
  assert.equal(
    refusal({ ...base, op: "damage", state: noHp, input: { actorId: "pc1", amount: 1 } }),
    "unknownResource",
  );
  const noSaves = { ...C.ruleset.health, tracks: [{ resource: "hp" }] };
  assert.equal(
    refusal({
      ...base,
      params: noSaves,
      op: "deathSave",
      state: actor({}),
      input: { actorId: "pc1", result: "success" },
    }),
    "badParams",
  );
});

// resource.capped

test("resource.capped: clamps to [min, max]", () => {
  const s: RuleState = {
    actors: {
      pc1: {
        id: "pc1",
        fields: {},
        resources: { focus: { value: 1, min: 0, max: 2 }, tempHp: { value: 3, min: 0, max: null } },
      },
    },
    turn: null,
  };
  const adjust = (resource: string, delta: number) =>
    deltas({
      primitive: "resource.capped",
      op: "adjust",
      params: {},
      state: s,
      input: { actorId: "pc1", resource, delta },
    });
  assert.deepEqual(adjust("focus", 5), [{ target: { actorId: "pc1", resource: "focus" }, kind: "add", value: 1 }]);
  assert.deepEqual(adjust("focus", -5), [{ target: { actorId: "pc1", resource: "focus" }, kind: "add", value: -1 }]);
  assert.deepEqual(adjust("focus", 0), []);
  // No ceiling.
  assert.deepEqual(adjust("tempHp", 50), [{ target: { actorId: "pc1", resource: "tempHp" }, kind: "add", value: 50 }]);
  assert.equal(
    refusal({
      primitive: "resource.capped",
      op: "adjust",
      params: {},
      state: s,
      input: { actorId: "pc1", resource: "gold", delta: 1 },
    }),
    "unknownResource",
  );
});

test("resource.capped: a max below the min never makes an empty range", () => {
  assert.equal(clampResource({ res: { value: 4, min: 5, max: 2 }, delta: 0 }), 5);
  assert.equal(clampResource({ res: { value: 4, min: 5, max: 2 }, delta: 10 }), 5);
  assert.equal(clampResource({ res: { value: 4, min: 5, max: 2 }, delta: -10 }), 5);
});

// registry and contract

test("runOp refuses unknown primitives, ops and bad params", () => {
  const state = actor({});
  assert.equal(
    refusal({ primitive: "dice.poolSuccesses", op: "resolve", params: {}, state, input: {} }),
    "unknownPrimitive",
  );
  assert.equal(
    refusal({ primitive: "health.tracks", op: "revive", params: C.ruleset.health, state, input: {} }),
    "unknownOp",
  );
  assert.equal(
    refusal({ primitive: "health.tracks", op: "constructor", params: C.ruleset.health, state, input: {} }),
    "unknownOp",
  );
  assert.equal(
    refusal({ primitive: "initiative.ranked", op: "next", params: { strategy: "popcorn" }, state, input: {} }),
    "badParams",
  );
});

test("every op declares perm, touches and targets, and the registry is keyed by id", () => {
  for (const [id, prim] of Object.entries(PRIMITIVES)) {
    assert.equal(prim.id, id);
    for (const op of Object.values(prim.ops)) {
      assert.ok(op.perm.length > 0);
      assert.ok(["state", "codex", "both"].includes(op.touches));
    }
  }
  assert.deepEqual(healthTargets(), [
    { resource: "hp" },
    { resource: "tempHp" },
    { field: "healthState" },
    { field: "deathSaveSuccesses" },
    { field: "deathSaveFailures" },
  ]);
});

function healthTargets() {
  const op = PRIMITIVES["health.tracks"]?.ops.damage;
  assert.ok(op !== undefined);
  return op.targets({ params: HEALTH });
}

test("a delta outside the op's targets is refused", () => {
  assert.deepEqual(
    checkDeltas({
      deltas: [{ target: { actorId: "a", resource: "hp" }, kind: "add", value: 1 }],
      targets: [{ resource: "*" }],
    }),
    null,
  );
  const outside = checkDeltas({
    deltas: [{ target: { actorId: "a", field: "gmNote" }, kind: "set", value: "x" }],
    targets: [{ field: "healthState" }],
  });
  assert.equal(outside?.code, "outOfTargets");

  // A rogue op is caught by runOp itself.
  const rogue: Primitive<unknown> = {
    id: "test.rogue",
    params: z.strictObject({}),
    ops: {
      poke: defineOp<unknown, unknown>({
        input: z.strictObject({}),
        perm: "test:call",
        touches: "state",
        targets: () => [{ resource: "hp" }],
        apply: () => [{ target: { actorId: "a", resource: "gold" }, kind: "add", value: 1 }],
      }),
    },
  };
  const r = runOp({
    primitive: rogue.id,
    op: "poke",
    params: {},
    state: actor({}),
    input: {},
    registry: { [rogue.id]: rogue },
  });
  assert.equal(r.ok ? "ok" : r.refusal.code, "outOfTargets");
});
