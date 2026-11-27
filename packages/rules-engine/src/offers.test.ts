import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { evaluateBool, evaluateInt } from "./expr/expr.ts";
import { SAMPLE_POOL } from "./fixtures/sample-pool.ts";

// A Test's marks and offers (house decision #80): checked by the validator, `when` compiled over the result and the
// call, each change's `by` over the taker too.

const skill = SAMPLE_POOL.tests?.skill;
const withSkill = (over: object) => ({ ...SAMPLE_POOL, tests: { skill: { ...skill, ...over } } });
const problems = (over: object) => {
  const r = compileRuleset(withSkill(over));
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};

test("the fixture's offers compile, and read the result, the mark and the dice", () => {
  const r = compileRuleset(SAMPLE_POOL);
  assert.ok(r.ok);
  const [shaken, strain] = r.compiled.tests.skill?.offers ?? [];
  assert.ok(shaken && strain);
  const result = (over: object) => ({
    passed: false,
    outcome: "failure",
    total: 1,
    margin: -3,
    shifts: 0,
    natural: 0,
    target: 4,
    flags: { critical: false, complication: false },
    ...over,
  });
  const scope = (ctx: object, over: object = {}) => ({ ctx: { dread: false, ...ctx }, result: result(over) });
  assert.equal(evaluateBool({ expr: shaken.when, scope: scope({ dread: true }) }), true);
  assert.equal(evaluateBool({ expr: shaken.when, scope: scope({}) }), false);
  assert.equal(evaluateBool({ expr: shaken.when, scope: scope({ dread: true }, { passed: true }) }), false);
  const [gain] = strain.changes;
  assert.equal(gain?.resource, "tempHp");
  assert.ok(gain);
  assert.equal(evaluateInt({ expr: gain.by, scope: scope({}) }), 3);
  const doubled = scope({}, { flags: { critical: false, complication: true } });
  assert.equal(evaluateInt({ expr: gain.by, scope: doubled }), 6);
});

test("the validator refuses a bad mark or offer", () => {
  assert.deepEqual(problems({ marks: { ability: { label: "A" } } }), [
    'tests.skill.marks.ability: "ability" is also an input',
  ]);
  const offer = skill?.offers?.[0];
  assert.deepEqual(problems({ offers: [offer, offer] }), ['tests.skill.offers[1].id: duplicate id "shaken"']);
  assert.deepEqual(problems({ offers: [{ ...offer, cite: undefined }] }), [
    "tests.skill.offers[0].cite: a rule entry needs a cite",
  ]);
  const change = (c: object) => problems({ offers: [{ ...offer, changes: [c] }] });
  assert.deepEqual(change({ by: "1" }), ["tests.skill.offers[0].changes[0]: a change names one pool or one resource"]);
  assert.deepEqual(change({ pool: "hp", by: "1" }), [
    'tests.skill.offers[0].changes[0].pool: "hp" is not a shared pool',
  ]);
  assert.deepEqual(change({ resource: "luck", by: "1" }), [
    'tests.skill.offers[0].changes[0].resource: "luck" must be an entity-scoped resource',
  ]);
  assert.deepEqual(change({ pool: "nope", by: "1" }), [
    'tests.skill.offers[0].changes[0].pool: unknown resource "nope"',
  ]);
  // `when` reads the result and the call only, never the taker.
  assert.equal(problems({ offers: [{ ...offer, when: "attr.str > 1" }] }).length, 1);
});

test("a choice made while reporting is read by the target and the offers, not the modifier or the pool (#170)", () => {
  const r = compileRuleset(SAMPLE_POOL);
  assert.ok(r.ok);
  const steadied = r.compiled.tests.skill?.offers.find((o) => o.def.id === "steadied");
  assert.ok(steadied);
  assert.equal(evaluateBool({ expr: steadied.when, scope: { ctx: { steady: 1 }, result: {} } }), true);
  assert.equal(evaluateBool({ expr: steadied.when, scope: { ctx: { steady: 0 }, result: {} } }), false);
  assert.deepEqual(problems({ modifier: "ctx.steady" }), ['tests.skill.modifier: unknown identifier "ctx.steady"']);
  assert.deepEqual(problems({ choices: { dread: { label: "D", cite: "p" } } }), [
    'tests.skill.choices.dread: "dread" is also a mark',
  ]);
});
