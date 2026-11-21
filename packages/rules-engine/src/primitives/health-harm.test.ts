import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { actorScope, deriveValues, resourceBounds, type FieldValue } from "../derived.ts";
import { SAMPLE_HARM } from "../fixtures/sample-harm.ts";
import { HealthHarmParams } from "./health-harm.ts";
import type { ActorState, Delta, ResourceState, RuleState } from "./primitive.ts";
import { applyDeltas, deltas, refusal } from "./test-helpers.ts";

// House decision #66 on an invented ruleset: heroes fall past their wound limit, brutes take no strain, swarms are mobs.
const compiled = compileRuleset(SAMPLE_HARM);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
const C = compiled.compiled;
const HARM = HealthHarmParams.parse(C.ruleset.health.harm);

/** One actor as the api builds it: resources with their bounds, the scope, its type and conditions. */
function actor({
  id = "a",
  entity,
  fields,
  values,
  conditions = [],
}: {
  id?: string;
  entity: string;
  fields: Record<string, FieldValue>;
  values: Record<string, number>;
  conditions?: string[];
}): ActorState {
  const derived = deriveValues({ compiled: C, entity, values: { fields, resources: values, conditions } });
  const scope = actorScope({ fields, derived, resources: values });
  const resources: Record<string, ResourceState> = {};
  for (const [r, value] of Object.entries(values)) {
    const b = resourceBounds({ compiled: C, resource: r, scope });
    resources[r] = { value, min: b.min, max: b.capped ? b.max : null, limit: b.max };
  }
  const rows = conditions.map((c, i) => ({
    id: `${id}${i}`,
    conditionId: c,
    expiresOn: "manual" as const,
    expiresAfter: null,
  }));
  return { id, entity, fields, resources, scope, conditions: rows };
}

const state = (...actors: ActorState[]): RuleState => ({
  actors: Object.fromEntries(actors.map((a) => [a.id, a])),
  turn: null,
});

// grit 2: wound limit 5, strain limit 2, destroyed above 10.
const hero = (wounds = 0, strain = 0, conditions: string[] = [], scars = 0) =>
  state(actor({ entity: "hero", fields: { grit: 2, scars }, values: { wounds, strain }, conditions }));
const brute = (wounds = 0) => state(actor({ entity: "brute", fields: { hide: 4 }, values: { wounds, strain: 0 } }));
const swarm = (members: number, size = 6) =>
  state(actor({ entity: "swarm", fields: { size }, values: { wounds: 0, strain: 0, members } }));

const hit = (s: RuleState, input: object, params: unknown = HARM): Delta[] =>
  deltas({ primitive: "health.harm", op: "hit", params, state: s, input: { actorId: "a", ...input } });
const refused = (s: RuleState, input: object, op = "hit", params: unknown = HARM): string =>
  refusal({ primitive: "health.harm", op, params, state: s, input: { actorId: "a", ...input } });
const res = (s: RuleState, r: string) => s.actors.a?.resources[r]?.value;
const add = (resource: string, value: number): Delta => ({ target: { actorId: "a", resource }, kind: "add", value });

test("the sample compiles, and a ruleset without the block keeps its shape", () => {
  assert.equal(C.ruleset.health.harm?.profiles.length, 3);
  const { spends: _spends, ...rest } = SAMPLE_HARM; // its spends run the block's ops
  const without = compileRuleset({ ...rest, health: { states: [] }, tables: undefined });
  assert.ok(without.ok && !("harm" in without.compiled.ruleset.health));
});

test("wounds and strain count up, and never below zero", () => {
  assert.deepEqual(hit(hero(1, 1), { wounds: 2, shock: 1 }), [add("strain", 1), add("wounds", 2)]);
  assert.deepEqual(hit(hero(1, 1), { wounds: -5, shock: -3 }), [add("strain", -1), add("wounds", -1)]);
  assert.deepEqual(hit(hero(0, 0), { wounds: -1 }), []);
});

test("strain on a spent hero becomes wounds; healing strain never does", () => {
  // Over the strain limit by the expression, or holding the condition.
  assert.deepEqual(hit(hero(0, 3), { shock: 2 }), [add("wounds", 2)]);
  assert.deepEqual(hit(hero(0, 0, ["winded"]), { wounds: 1, shock: 2 }), [add("wounds", 3)]);
  assert.deepEqual(hit(hero(0, 2), { shock: 1 }), [add("strain", 1)], "at the limit is not past it");
  assert.deepEqual(hit(hero(0, 3), { shock: -1 }), [add("strain", -1)]);
});

test("a hit that brings a hero down lays the condition; one at the limit does not", () => {
  assert.deepEqual(hit(hero(3), { wounds: 2 }), [add("wounds", 2)]);
  assert.deepEqual(hit(hero(3), { wounds: 3 }), [
    add("wounds", 3),
    { target: { actorId: "a", applyCondition: "down" }, kind: "add", value: 1 },
  ]);
  assert.deepEqual(hit(hero(3, 0, ["down"]), { wounds: 3 }), [add("wounds", 3)], "already held");
});

test("a wound while down is a scar; healing while down lifts no higher than healTo", () => {
  const down = hero(7, 0, ["down"], 1);
  assert.deepEqual(hit(down, { wounds: 4 }), [{ target: { actorId: "a", field: "scars" }, kind: "set", value: 2 }]);
  assert.deepEqual(hit(down, { wounds: -1 }), [add("wounds", -2)], "healed to the limit, 5");
  assert.deepEqual(hit(down, { wounds: -4 }), [add("wounds", -4)]);
  assert.deepEqual(hit(hero(6), { wounds: -9 }), [add("wounds", -6)]);
});

test("one hit past twice the limit destroys outright and changes nothing else", () => {
  const gone = [{ target: { actorId: "a", field: "gone" }, kind: "set", value: true }];
  assert.deepEqual(hit(hero(0), { wounds: 11, shock: 2 }), gone);
  assert.deepEqual(hit(hero(0, 3), { wounds: 9, shock: 2 }), gone, "converted strain counts");
  assert.deepEqual(hit(hero(0), { wounds: 10 }), [
    add("wounds", 10),
    { target: { actorId: "a", applyCondition: "down" }, kind: "add", value: 1 },
  ]);
});

test("a brute never takes strain; a ruleset without strain refuses it", () => {
  assert.equal(refused(brute(), { shock: 1 }), "neverShocked");
  assert.deepEqual(hit(brute(), { wounds: 2 }), [add("wounds", 2)]);
  const noShock = { ...HARM, shock: undefined, mob: undefined };
  assert.equal(refused(hero(), { shock: 1 }, "hit", noShock), "badRequest");
  assert.equal(refused(hero(), { wounds: 0 }), "badInput");
});

test("a swarm loses a member a wound, one more for strain past its limit, and heals up to its size", () => {
  assert.deepEqual(hit(swarm(6), { wounds: 2 }), [add("members", -2)]);
  assert.deepEqual(hit(swarm(6), { wounds: 1, shock: 3 }), [add("members", -2)]);
  assert.deepEqual(hit(swarm(6), { shock: 2 }), [], "strain at the limit takes nobody");
  assert.deepEqual(hit(swarm(2), { wounds: 9 }), [add("members", -2)]);
  assert.deepEqual(hit(swarm(4), { wounds: -5 }), [add("members", 2)]);
});

test("mustering raises the start and sets the members; only a mob musters", () => {
  const muster = (s: RuleState, members: number) =>
    deltas({ primitive: "health.harm", op: "muster", params: HARM, state: s, input: { actorId: "a", members } });
  assert.deepEqual(muster(swarm(3), 8), [
    { target: { actorId: "a", field: "size" }, kind: "set", value: 8 },
    add("members", 5),
  ]);
  assert.deepEqual(muster(swarm(3), 4), [add("members", 1)]);
  assert.equal(refused(hero(), { members: 3 }, "muster"), "notAMob");
  assert.equal(refused(hero(), { members: -1 }, "muster"), "badInput");
});

test("an actor no profile holds takes no hits", () => {
  const stranger = state({ ...actor({ entity: "hero", fields: { grit: 2 }, values: { wounds: 0 } }), entity: "ghost" });
  assert.equal(refused(stranger, { wounds: 1 }), "noHarmHere");
  assert.equal(refused(state(), { wounds: 1 }), "unknownActor");
});

test("the hit that brings a hero down writes its wounds and its condition", () => {
  const s = applyDeltas(hero(4), hit(hero(4), { wounds: 3 }));
  assert.equal(res(s, "wounds"), 7);
  assert.deepEqual(
    s.actors.a?.conditions?.map((c) => c.conditionId),
    ["down"],
  );
});
