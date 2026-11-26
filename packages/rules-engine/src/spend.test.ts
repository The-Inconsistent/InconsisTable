import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { actorScope, deriveValues } from "./derived.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { SAMPLE_HARM } from "./fixtures/sample-harm.ts";
import { SAMPLE_SKIRMISH, SAMPLE_SKIRMISH_BEFORE_PANELS } from "./fixtures/sample-skirmish.ts";
import type { RulesetInput } from "./manifest.ts";
import { isRefusal, type ActorState, type RuleState } from "./primitives/primitive.ts";
import { runOp } from "./primitives/registry.ts";
import { planSpend, spendThenHolds } from "./spend.ts";

// House decision #84: spends on the invented fixtures.

const compiled = (input: RulesetInput) => {
  const r = compileRuleset(input);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problems));
  return r.compiled;
};
const HARM = compiled(SAMPLE_HARM);
const SKIRMISH = compiled(SAMPLE_SKIRMISH);

const res = (value: number, min = 0, max: number | null = null) => ({ value, min, max });

const hero = (values: { wounds: number; strain: number; resolve: number }, grit = 2): ActorState => ({
  id: "h1",
  entity: "hero",
  fields: { grit },
  resources: { wounds: res(values.wounds), strain: res(values.strain), resolve: res(values.resolve, 0, 3) },
  conditions: [],
  scope: { grit, derived: { limit: grit + 3, strainCap: grit }, res: values, party: { characters: 1 } },
});

const state = (a: ActorState, extra: Partial<RuleState> = {}): RuleState => ({
  actors: { [a.id]: a },
  turn: null,
  ...extra,
});

test("a costed spend with no effect costs its resource and runs nothing", () => {
  const a = hero({ wounds: 0, strain: 0, resolve: 1 });
  const plan = planSpend({ ruleset: HARM.ruleset, spendId: "retry", actor: a, state: state(a), inputs: {} });
  assert.deepEqual(plan, { costs: [{ resource: "resolve", amount: 1, byRun: false }], run: [] });
  const broke = hero({ wounds: 0, strain: 0, resolve: 0 });
  const refused = planSpend({ ruleset: HARM.ruleset, spendId: "retry", actor: broke, state: state(broke), inputs: {} });
  assert.ok(isRefusal(refused) && refused.code === "cannotPay");
});

test("a spend reads its if and an op input by expression", () => {
  const a = hero({ wounds: 1, strain: 3, resolve: 2 }, 2);
  const plan = planSpend({ ruleset: HARM.ruleset, spendId: "steady", actor: a, state: state(a), inputs: {} });
  assert.deepEqual(plan, {
    costs: [{ resource: "resolve", amount: 1, byRun: false }],
    run: [{ primitive: "health.harm", op: "hit", input: { actorId: "h1", shock: -2 } }],
  });
  const calm = hero({ wounds: 0, strain: 0, resolve: 2 });
  const notNow = planSpend({ ruleset: HARM.ruleset, spendId: "steady", actor: calm, state: state(calm), inputs: {} });
  assert.ok(isRefusal(notNow) && notNow.code === "spendNotNow");
});

test("an input is checked against its range, and an unknown one refused", () => {
  const a = hero({ wounds: 4, strain: 0, resolve: 0 }, 2);
  const plan = (inputs: Record<string, unknown>) =>
    planSpend({ ruleset: HARM.ruleset, spendId: "endure", actor: a, state: state(a), inputs });
  assert.deepEqual(plan({ marks: 4 }), {
    costs: [],
    run: [{ primitive: "health.harm", op: "convert", input: { actorId: "h1", amount: 4 } }],
  });
  for (const bad of [{}, { marks: 0 }, { marks: 5 }, { marks: 1.5 }, { marks: 1, other: 1 }]) {
    const r = plan(bad);
    assert.ok(isRefusal(r) && r.code === "badInput", JSON.stringify(bad));
  }
});

test("a spend for another actor type, or unknown, is refused", () => {
  const a = { ...hero({ wounds: 0, strain: 0, resolve: 1 }), entity: "brute" };
  for (const spendId of ["retry", "nope"]) {
    const r = planSpend({ ruleset: HARM.ruleset, spendId, actor: a, state: state(a), inputs: {} });
    assert.ok(isRefusal(r) && r.code === "noSuchSpend");
  }
});

const fighter = (id: string): ActorState => ({
  id,
  entity: "character",
  fields: {},
  resources: {},
  scope: { party: { characters: 2 } },
});

test("a party pool pays a picked number, checked against the pool", () => {
  const a = fighter("c1");
  const s = (momentum: number) => state(a, { pools: { momentum: res(momentum, 0, 6) } });
  const plan = (momentum: number, dice: number) =>
    planSpend({ ruleset: SKIRMISH.ruleset, spendId: "rally", actor: a, state: s(momentum), inputs: { dice } });
  assert.deepEqual(plan(3, 2), { costs: [{ pool: "momentum", amount: 2, byRun: false }], run: [] });
  const short = plan(1, 2);
  assert.ok(isRefusal(short) && short.code === "cannotPay");
  const over = plan(6, 4);
  assert.ok(isRefusal(over) && over.code === "badInput");
});

test("the fight's scope: an out-of-turn start needs the actor in the fight, a lift a bar", () => {
  const a = fighter("c1");
  const pools = { momentum: res(3, 0, 6) };
  const plan = (spendId: string, turn: RuleState["turn"]) =>
    planSpend({ ruleset: SKIRMISH.ruleset, spendId, actor: a, state: state(a, { pools, turn }), inputs: {} });
  const out = plan("jump", null);
  assert.ok(isRefusal(out) && out.code === "spendNotNow");
  const turn = { round: 1, currentId: null, order: ["c1", "r1"], barred: ["c1"] };
  assert.deepEqual(plan("jump", turn), {
    costs: [{ pool: "momentum", amount: 1, byRun: true }],
    run: [{ primitive: "initiative.sides", op: "seize", input: { id: "c1" } }],
  });
  assert.deepEqual(plan("shake", turn), {
    costs: [{ pool: "momentum", amount: 2, byRun: true }],
    run: [{ primitive: "initiative.sides", op: "lift", input: { id: "c1" } }],
  });
  const free = plan("shake", { ...turn, barred: [] });
  assert.ok(isRefusal(free) && free.code === "spendNotNow");
});

test("a spend limited per round counts its uses in the turn, round by round (house decision #91)", () => {
  const a: ActorState = { ...fighter("c1"), resources: { nerve: res(4, 0, 4) } };
  const plan = (turn: RuleState["turn"], push = 1) =>
    planSpend({ ruleset: SKIRMISH.ruleset, spendId: "channel", actor: a, state: state(a, { turn }), inputs: { push } });
  // Outside a fight, or in one the actor is not in, nothing is counted.
  assert.deepEqual(plan(null), { costs: [{ resource: "nerve", amount: 2, byRun: false }], run: [] });
  assert.deepEqual(plan({ round: 2, currentId: null, order: ["r1"] }), {
    costs: [{ resource: "nerve", amount: 2, byRun: false }],
    run: [],
  });
  // The round's first use writes itself beside the round's others; an earlier round's are left behind.
  const turn = { round: 2, currentId: null, order: ["c1", "r1"], used: ["1:c1:channel", "2:r1:channel"] };
  assert.deepEqual(plan(turn, 0), {
    costs: [{ resource: "nerve", amount: 1, byRun: false }],
    run: [],
    used: ["2:r1:channel", "2:c1:channel"],
  });
  const again = plan({ ...turn, used: ["2:r1:channel", "2:c1:channel"] });
  assert.ok(isRefusal(again) && again.code === "usedThisRound");
  assert.equal(again.message, '"Channel", round 2');
  // A new round clears it: the count is read from the round.
  assert.ok(!isRefusal(plan({ ...turn, round: 3, used: ["2:c1:channel"] })));
});

test("the validator checks a spend's limit and the table it opens next (house decision #91)", () => {
  const problems = (over: Record<string, unknown>) => {
    const channel = SAMPLE_SKIRMISH.spends?.find((s) => s.id === "channel");
    const r = compileRuleset({ ...SAMPLE_SKIRMISH_BEFORE_PANELS, spends: [{ ...channel, ...over }] });
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ then: { table: "nope", inputs: { extra: "nope" } } }), [
    'spends[0].then.table: unknown table "nope"',
    'spends[0].then.inputs.extra: "nope" is not an input of the spend',
  ]);
  assert.deepEqual(problems({ then: { table: "backlash", inputs: { extra: "push", heat: "push" } } }), [
    'spends[0].then.inputs.heat: "heat" is not an input of the table',
  ]);
  assert.equal(problems({ limit: { per: "turn", max: 1 } }).length, 1);
  assert.equal(problems({ limit: { per: "round", max: 0 } }).length, 1);
});

// House decision #169: the table a spend opens next, only while its own `if` holds.
test("a spend's next table has an `if` of its own, read in the spend's scope with the inputs picked", () => {
  const channel = SAMPLE_SKIRMISH.spends?.find((s) => s.id === "channel");
  assert.ok(channel);
  const spend = { ...channel, then: { ...channel.then!, if: "ctx.push == 2 && !ctx.fight.on" } };
  const a = fighter("c1");
  assert.equal(spendThenHolds({ spend, actor: a, state: state(a), inputs: { push: 2 } }), true);
  assert.equal(spendThenHolds({ spend, actor: a, state: state(a), inputs: { push: 1 } }), false);
  const turn = { round: 1, currentId: null, order: ["c1"], barred: [] };
  assert.equal(spendThenHolds({ spend, actor: a, state: state(a, { turn }), inputs: { push: 2 } }), false);
  // The fixture's own: a backlash only for a pushed use. Without one the table is always offered; an actor whose
  // values cannot be read is offered none.
  assert.equal(spendThenHolds({ spend: channel, actor: a, state: state(a), inputs: { push: 0 } }), false);
  assert.equal(spendThenHolds({ spend: channel, actor: a, state: state(a), inputs: { push: 1 } }), true);
  const plain = { then: { table: "backlash" } };
  assert.equal(spendThenHolds({ spend: plain, actor: a, state: state(a), inputs: {} }), true);
  assert.equal(
    spendThenHolds({ spend, actor: { ...a, scope: undefined }, state: state(a), inputs: { push: 2 } }),
    false,
  );

  const problems = (over: Record<string, unknown>) => {
    const r = compileRuleset({ ...SAMPLE_SKIRMISH_BEFORE_PANELS, spends: [{ ...channel, ...over }] });
    return r.ok ? [] : r.problems.map((p) => p.path);
  };
  assert.deepEqual(problems({ then: spend.then, clearOn: ["roundEnd", "encounterEnd"] }), []);
  assert.deepEqual(problems({ then: { ...spend.then, if: "ctx.push" } }), ["spends[0].then.if"]);
  assert.deepEqual(problems({ clearOn: ["roundStart"] }), ["spends[0].clearOn[0]"]);
});

test("a list held in play is counted from empty, raising a Test's target, and its picks name a type (#91)", () => {
  const fields = { level: 1, "attr.str": 10, "attr.dex": 10, "attr.con": 10, "attr.wis": 10 };
  const load = (more: Record<string, string[]>) =>
    deriveValues({ compiled: SKIRMISH, entity: "creature", values: { fields: { ...fields, ...more }, resources: {} } })
      .wardLoad;
  assert.equal(load({}), 0);
  assert.equal(load({ wards: ["a", "b"] }), 4);
  const target = SKIRMISH.tests.check?.target;
  assert.ok(target);
  const scope = actorScope({ fields, derived: { wardLoad: 4 }, ctx: { dc: 12, ability: "str" } });
  assert.equal(evaluate({ node: target.ast, scope }), 16);
  const entities = SAMPLE_SKIRMISH.entities.map((e) =>
    e.id !== "character"
      ? e
      : { ...e, fields: { ...e.fields, wards: { type: "list", label: "W", picks: { entity: "x" } } } },
  );
  const r = compileRuleset({ ...SAMPLE_SKIRMISH, entities } as RulesetInput);
  assert.ok(!r.ok && r.problems.some((p) => p.path === "entities[0].fields.wards.picks.entity"));
});

test("convert moves up to the amount from wounds to the second track, and refuses where it cannot", () => {
  const params = HARM.ruleset.health.harm;
  const run = (a: ActorState, amount: number, p: unknown = params) =>
    runOp({ primitive: "health.harm", op: "convert", params: p, state: state(a), input: { actorId: a.id, amount } });
  const moved = run(hero({ wounds: 2, strain: 0, resolve: 0 }), 5);
  assert.ok(moved.ok);
  assert.deepEqual(moved.deltas, [
    { target: { actorId: "h1", resource: "wounds" }, kind: "add", value: -2 },
    { target: { actorId: "h1", resource: "strain" }, kind: "add", value: 2 },
  ]);
  const none = run(hero({ wounds: 0, strain: 0, resolve: 0 }), 1);
  assert.ok(!none.ok && none.refusal.code === "wrongState");
  const spent = run(hero({ wounds: 1, strain: 5, resolve: 0 }, 2), 1);
  assert.ok(!spent.ok && spent.refusal.code === "wrongState");
  const brute: ActorState = { ...hero({ wounds: 1, strain: 0, resolve: 0 }), entity: "brute" };
  const notHere = run(brute, 1);
  assert.ok(!notHere.ok && notHere.refusal.code === "noConvertHere");
});

test("the validator checks a spend's costs, inputs and ops", () => {
  const bad = (spend: Record<string, unknown>) => {
    const r = compileRuleset({
      ...SAMPLE_SKIRMISH_BEFORE_PANELS,
      spends: [{ id: "x", label: "X", cite: "p.1", cost: [], ...spend }],
    });
    assert.ok(!r.ok);
    return r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(bad({ cost: [{ pool: "hp", amount: "1" }] }), [
    'spends[0].cost[0].pool: "hp" must be a shared pool',
  ]);
  assert.deepEqual(bad({ cost: [{ amount: "1" }] }), ["spends[0].cost[0]: a cost names a pool or a resource"]);
  assert.deepEqual(bad({ inputs: { self: { label: "S", min: 0, max: "1" } } }), [
    'spends[0].inputs.self: "self" is reserved',
  ]);
  assert.deepEqual(bad({ run: [{ primitive: "health.harm", op: "hit", input: {} }] }), [
    'spends[0].run[0].primitive: "health.harm" is not declared by this ruleset',
  ]);
  assert.deepEqual(bad({ run: [{ primitive: "initiative.sides", op: "fly", input: {} }] }), [
    'spends[0].run[0].op: "initiative.sides" has no op "fly"',
  ]);
  assert.deepEqual(bad({ run: [{ primitive: "initiative.sides", op: "seize", input: { who: "ctx.self" } }] }), [
    'spends[0].run[0].input.who: "who" is not an input',
  ]);
  assert.equal(bad({ if: "ctx.dice > 0" }).length, 1);
  assert.equal(bad({ cost: [{ pool: "momentum", amount: "true" }] }).length, 1);
});
