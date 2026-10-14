import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { actorScope } from "../derived.ts";
import { evaluateInt } from "../expr/expr.ts";
import { SAMPLE_POOL } from "../fixtures/sample-pool.ts";
import { validateRuleset, type PoolSuccesses, type RulesetInput } from "../manifest.ts";
import { poolSize, type PoolResolveInput } from "./dice-pool-successes.ts";
import { runOp } from "./registry.ts";

// dice.poolSuccesses against the synthetic pool fixture: a d8 pool, 8 worth two, 5–7 worth one, one Omen die that
// flags 8 critical and 1 complication, the 8s shiftable.

const compiled = compileRuleset(SAMPLE_POOL);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
const skill = compiled.compiled.tests["skill"];
if (skill?.def.kind !== "poolSuccesses" || skill.pool === null) throw new Error("the pool fixture declares skill");
const SKILL: PoolSuccesses = skill.def;
const POOL = skill.pool;

const run = (input: PoolResolveInput, params: PoolSuccesses = SKILL) =>
  runOp({ primitive: "dice.poolSuccesses", op: "resolve", params, state: { actors: {}, turn: null }, input });

/** The outcome as the deltas set it, by Test key. */
function outcome(input: PoolResolveInput, params?: PoolSuccesses) {
  const r = run(input, params);
  if (!r.ok) throw new Error(r.refusal.message);
  return Object.fromEntries(r.deltas.map((d) => ["test" in d.target ? d.target.test : "?", d.value]));
}

function refused(input: unknown): string {
  const r = runOp({
    primitive: "dice.poolSuccesses",
    op: "resolve",
    params: SKILL,
    state: { actors: {}, turn: null },
    input,
  });
  assert.equal(r.ok, false, "should be refused");
  return r.ok ? "" : r.refusal.message;
}

const roll = (counts: Record<string, number>, special: number[]) => ({ kind: "pool" as const, counts, special });

test("the pool comes from the character's values, the call's modifier adds or removes dice, never below zero", () => {
  const scope = { ...actorScope({ fields: { "attr.dex": 14 } }), ctx: { ability: "dex", dn: 3, bonus: 0 } };
  const pool = evaluateInt({ expr: POOL, scope });
  assert.equal(pool, 4);
  assert.equal(poolSize({ pool, modifier: 2 }), 6);
  assert.equal(poolSize({ pool, modifier: -1 }), 3);
  assert.equal(poolSize({ pool, modifier: -9 }), 0);
});

test("a face can be worth double, and the special die scores like any other", () => {
  assert.deepEqual(outcome({ target: 3, pool: 6, roll: roll({ top: 1, hit: 2 }, [3]) }), {
    outcome: "success",
    total: 4,
    margin: 1,
    shifts: 0,
    flags: [],
  });
  assert.equal(outcome({ target: 3, pool: 6, roll: roll({ hit: 1 }, [8]) }).total, 3);
});

test("the special die flags a critical or a complication, whatever the outcome", () => {
  assert.deepEqual(outcome({ target: 9, pool: 4, roll: roll({}, [8]) }).flags, ["critical"]);
  const low = outcome({ target: 1, pool: 4, roll: roll({ top: 1 }, [1]) });
  assert.deepEqual([low.outcome, low.flags], ["success", ["complication"]]);
  // A pool too small for its special dice has fewer of them: none at all for an empty pool.
  assert.deepEqual(outcome({ target: 1, pool: 0, roll: roll({}, []) }), {
    outcome: "failure",
    total: 0,
    margin: -1,
    shifts: 0,
    flags: [],
  });
});

test("shifts: the dice of the shift band that can come off the score with the roll still passing", () => {
  // Two 8s and an Omen 8 score 6 + 1; against 3, two of the three 8s can go (7 → 5 → 3).
  assert.equal(outcome({ target: 3, pool: 6, roll: roll({ top: 2, hit: 1 }, [8]) }).shifts, 2);
  // Plenty of margin: no more shifts than dice in the band.
  assert.equal(outcome({ target: 0, pool: 6, roll: roll({ top: 1 }, [2]) }).shifts, 1);
  // A failure shifts nothing; nor does a ruleset without a shift band.
  assert.equal(outcome({ target: 9, pool: 6, roll: roll({ top: 2 }, [8]) }).shifts, 0);
  const { shift: _, ...noShift } = SKILL;
  assert.equal(outcome({ target: 0, pool: 6, roll: roll({ top: 2 }, [8]) }, noShift).shifts, 0);
});

test("pass or fail at the DN edge follows the manifest's tie rule", () => {
  const edge = { target: 4, pool: 5, roll: roll({ top: 1, hit: 1 }, [5]) };
  assert.deepEqual([outcome(edge).outcome, outcome(edge).margin], ["success", 0]);
  assert.equal(outcome({ ...edge, target: 5 }).outcome, "failure");
  assert.equal(outcome(edge, { ...SKILL, ties: "beat" }).outcome, "failure");
  assert.equal(outcome(edge, { ...SKILL, ties: "beat" }).shifts, 0);
});

test("an impossible report is refused with a reason", () => {
  assert.match(
    refused({ target: 3, pool: 3, roll: roll({ top: 2, hit: 1 }, [4]) }),
    /4 dice counted, but the pool is 3/,
  );
  assert.match(refused({ target: 3, pool: 6, roll: roll({ top: -1 }, [4]) }), /can't be negative/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({ six: 1 }, [4]) }), /no scoring band "six"/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({ top: 1 }, []) }), /expected 1 special die/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({ top: 1 }, [4, 5]) }), /expected 1 special die/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({}, [9]) }), /a d8 rolls 1–8/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({ constructor: 1 }, [4]) }), /no scoring band/);
  assert.match(refused({ target: 3, pool: 6, roll: roll({ top: 1.5 }, [4]) }), /counts/);
  assert.match(refused({ target: 3, pool: -1, roll: roll({}, []) }), /pool/);
});

test("the validator checks a Dice pool's bands, flags and shift band, and wants a cite", () => {
  const pool = (patch: Partial<PoolSuccesses>): RulesetInput => ({
    ...SAMPLE_POOL,
    tests: { skill: { ...SKILL, ...patch } },
  });
  const problems = (input: RulesetInput) => {
    const r = validateRuleset(input);
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(problems(pool({})), []);
  const bands = [
    { id: "top", from: 7, to: 8, worth: 2 },
    { id: "hit", from: 5, to: 7, worth: 1 },
  ];
  assert.deepEqual(problems(pool({ bands })), ["tests.skill.bands[1]: overlaps bands[0]"]);
  assert.deepEqual(problems(pool({ bands: [{ id: "top", from: 8, to: 9, worth: 1 }], shift: "top" })), [
    "tests.skill.bands[0].to: a d8 has no face 9",
  ]);
  assert.deepEqual(problems(pool({ shift: "gold" })), ['tests.skill.shift: no band "gold"']);
  const flags = { label: "Omen die", count: 1, flags: { critical: { from: 8, to: 7 } } };
  assert.deepEqual(problems(pool({ special: flags })), ["tests.skill.special.flags.critical.to: to is below from"]);
  assert.deepEqual(problems(pool({ cite: undefined })), ["tests.skill.cite: a rule entry needs a cite"]);
});

test("a Dice pool's dice are told as one number, so they are as hidden as the pool and the modifier", () => {
  // `attr[ctx.ability] / 3` reads a character's party scores; a creature's are undeclared, so gm.
  assert.deepEqual(skill.modifierVisibility, { character: "party", creature: "gm" });
  assert.deepEqual(skill.targetVisibility, { character: "public", creature: "public" });
});
