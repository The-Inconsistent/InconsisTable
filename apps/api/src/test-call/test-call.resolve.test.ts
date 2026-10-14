import { test } from "node:test";
import assert from "node:assert/strict";
import { actorScope, compileRuleset, type CompiledTest } from "@inconsistable/rules-engine";
// Our own sample ruleset (no book text) lives with the engine; a relative import keeps it out of the engine's public API.
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_POOL } from "../../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { checkInputs, evaluateCall, resolvePoolRoll, resolveRoll, targetInputs } from "./test-call.resolve.ts";

const compiled = compileRuleset(SAMPLE_D20);
if (!compiled.ok) throw new Error("the sample ruleset must compile");
const check: CompiledTest = compiled.compiled.tests["check"] as CompiledTest; // SAMPLE_D20 declares it

const roll = (over: Partial<Parameters<typeof resolveRoll>[0]>) =>
  resolveRoll({
    test: check,
    target: 15,
    modifier: 2,
    advantage: "none",
    roll: { kind: "faces", faces: [10] },
    ...over,
  });

test("inputs must be exactly the Test's declared ones, with the right types", () => {
  assert.equal(checkInputs({ test: check, inputs: { ability: "dex", dc: 15 } }), null);
  assert.match(checkInputs({ test: check, inputs: { ability: "dex" } }) ?? "", /dc/);
  assert.match(checkInputs({ test: check, inputs: { ability: "dex", dc: 15, extra: 1 } }) ?? "", /extra/);
  assert.match(checkInputs({ test: check, inputs: { ability: "dex", dc: "high" } }) ?? "", /whole number/);
  assert.match(checkInputs({ test: check, inputs: { ability: "dex", dc: 1.5 } }) ?? "", /whole number/);
  assert.match(checkInputs({ test: check, inputs: { ability: 4, dc: 15 } }) ?? "", /text/);
  assert.equal(
    checkInputs({ test: check, inputs: { ability: "2", dc: 15 } }),
    "ability: pick one of str, dex, con, wis",
  );
});

test("the modifier and the target come from the character's values and the call's inputs", () => {
  const scope = actorScope({ fields: { "attr.dex": 14, "attr.str": 8 } });
  const dex = evaluateCall({ test: check, scope, inputs: { ability: "dex", dc: 15 } });
  assert.deepEqual(dex, { ok: true, modifier: 2, target: 15, pool: null });
  const str = evaluateCall({ test: check, scope, inputs: { ability: "str", dc: 9 } });
  assert.deepEqual(str, { ok: true, modifier: -1, target: 9, pool: null });
  // An ability the character has no score for is a refusal the GM reads, not a crash.
  const bad = evaluateCall({ test: check, scope, inputs: { ability: "wis", dc: 9 } });
  assert.equal(bad.ok, false);
});

test("the inputs a hidden target reads are the ones to hide with it", () => {
  assert.deepEqual(targetInputs(check), ["dc"]);
});

test("the server resolves the reported dice: meet-or-beat, crit, advantage", () => {
  assert.deepEqual(roll({}), { ok: true, natural: 10, total: 12, outcome: "failure" });
  assert.deepEqual(roll({ roll: { kind: "faces", faces: [13] } }), {
    ok: true,
    natural: 13,
    total: 15,
    outcome: "success",
  });
  assert.deepEqual(roll({ roll: { kind: "faces", faces: [20] } }), {
    ok: true,
    natural: 20,
    total: 22,
    outcome: "critical",
  });
  const adv = roll({ advantage: "advantage", roll: { kind: "faces", faces: [3, 18] } });
  assert.deepEqual(adv, { ok: true, natural: 18, total: 20, outcome: "success" });
  const dis = roll({ advantage: "disadvantage", roll: { kind: "faces", faces: [3, 18] } });
  assert.deepEqual(dis, { ok: true, natural: 3, total: 5, outcome: "failure" });
});

test("a reported total is taken as it is", () => {
  assert.deepEqual(roll({ roll: { kind: "total", total: 16 } }), {
    ok: true,
    natural: null,
    total: 16,
    outcome: "success",
  });
  assert.equal(roll({ roll: { kind: "total", total: 14, natural: 12 } }).ok, true);
});

test("a roll the dice could not make is refused", () => {
  assert.equal(roll({ roll: { kind: "faces", faces: [21] } }).ok, false); // a d20
  assert.equal(roll({ roll: { kind: "faces", faces: [0] } }).ok, false);
  assert.equal(roll({ roll: { kind: "faces", faces: [4, 5] } }).ok, false); // two dice, no advantage
  assert.equal(roll({ advantage: "advantage", roll: { kind: "faces", faces: [4] } }).ok, false);
  assert.equal(roll({ advantage: "lucky" }).ok, false);
  assert.equal(roll({ roll: { kind: "nonsense" } }).ok, false);
});

// A Dice pool: the pool comes from the character and the call's modifier, the server counts the report.
const sample = compileRuleset(SAMPLE_POOL);
if (!sample.ok) throw new Error("the pool ruleset must compile");
const skill: CompiledTest = sample.compiled.tests["skill"] as CompiledTest; // SAMPLE_POOL declares it

test("a Dice pool call fixes the dice to roll: the pool plus the modifier, never below none", () => {
  const scope = actorScope({ fields: { "attr.dex": 14 } });
  const call = (bonus: number) => evaluateCall({ test: skill, scope, inputs: { ability: "dex", dn: 3, bonus } });
  assert.deepEqual(call(0), { ok: true, modifier: 0, target: 3, pool: 4 });
  assert.deepEqual(call(2), { ok: true, modifier: 2, target: 3, pool: 6 });
  assert.deepEqual(call(-9), { ok: true, modifier: -9, target: 3, pool: 0 });
  // A sum Test has no pool.
  assert.deepEqual(evaluateCall({ test: check, scope, inputs: { ability: "dex", dc: 5 } }), {
    ok: true,
    modifier: 2,
    target: 5,
    pool: null,
  });
});

test("the server counts a reported Dice pool and refuses one the pool could not make", () => {
  const pool = (over: Partial<Parameters<typeof resolvePoolRoll>[0]>) =>
    resolvePoolRoll({
      test: skill,
      target: 3,
      pool: 4,
      roll: { kind: "pool", counts: { top: 1, hit: 1 }, special: [8] },
      ...over,
    });
  assert.deepEqual(pool({}), { ok: true, score: 5, margin: 2, shifts: 1, flags: ["critical"], outcome: "success" });
  const over = pool({ pool: 2 });
  assert.deepEqual(over, { ok: false, message: "3 dice counted, but the pool is 2" });
  assert.equal(pool({ roll: { kind: "pool", counts: { top: -1 }, special: [3] } }).ok, false);
  assert.equal(pool({ roll: { kind: "faces", faces: [3] } }).ok, false);
});
