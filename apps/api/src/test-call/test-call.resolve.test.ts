import { test } from "node:test";
import assert from "node:assert/strict";
import { actorScope, compileRuleset, type CompiledTest } from "@inconsistable/rules-engine";
// Our own sample ruleset (no book text) lives with the engine; a relative import keeps it out of the engine's public API.
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { checkInputs, evaluateCall, resolveRoll, targetInputs } from "./test-call.resolve.ts";

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
});

test("the modifier and the target come from the character's values and the call's inputs", () => {
  const scope = actorScope({ fields: { "attr.dex": 14, "attr.str": 8 } });
  const dex = evaluateCall({ test: check, scope, inputs: { ability: "dex", dc: 15 } });
  assert.deepEqual(dex, { ok: true, modifier: 2, target: 15 });
  const str = evaluateCall({ test: check, scope, inputs: { ability: "str", dc: 9 } });
  assert.deepEqual(str, { ok: true, modifier: -1, target: 9 });
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
