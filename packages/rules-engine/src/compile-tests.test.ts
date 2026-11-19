import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRuleset } from "./compile.ts";
import { healthStatesOf } from "./derived.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_SCOPED } from "./fixtures/sample-scoped.ts";

// A Test's modifier and target number are told to a player only as far as the values they read are visible to that
// character's owner (docs/p1-plan.md G). The compiler works it out per actor type, like a derived value's taint.
test("a Test's modifier and target carry the visibility of what they read, per actor type", () => {
  const r = compileRuleset(SAMPLE_D20);
  assert.ok(r.ok);
  const check = r.compiled.tests["check"];
  // `mod(attr[ctx.ability])`: a character's scores are `party`, a creature's are undeclared and so `gm`.
  assert.deepEqual(check?.modifierVisibility, { character: "party", creature: "gm" });
  // `ctx.dc` is whatever the caller supplied.
  assert.deepEqual(check?.targetVisibility, { character: "public", creature: "public" });
});

// House decision #50: a Test or a health state that names its actor types is checked against those alone.
test("a Test and a health state that name their actor types are checked against those types only", () => {
  const r = compileRuleset(SAMPLE_SCOPED);
  assert.ok(r.ok);
  // `derived.initBonus` exists on a character only, and only a character is told anything about the Test.
  assert.deepEqual(r.compiled.tests["brace"]?.modifierVisibility, { character: "party" });
  assert.deepEqual(
    r.compiled.healthStates.map((s) => s.entities),
    [null, ["character"]],
  );

  const everyType = structuredClone(SAMPLE_SCOPED);
  delete everyType.tests?.["brace"]?.entities;
  const refused = compileRuleset(everyType);
  assert.ok(!refused.ok);
  assert.deepEqual(refused.problems, [
    { path: "tests.brace.modifier", message: 'unknown identifier "derived.initBonus"' },
  ]);
});

test("a named actor type must exist and be an actor", () => {
  const bad = structuredClone(SAMPLE_SCOPED);
  const brace = bad.tests?.["brace"];
  assert.ok(brace);
  brace.entities = ["gear", "ghost"];
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  assert.deepEqual(r.problems, [
    { path: "tests.brace.entities[0]", message: '"gear" is not an actor entity' },
    { path: "tests.brace.entities[1]", message: 'unknown entity "ghost"' },
  ]);
});

test("a health state never holds for an actor type it does not name", () => {
  const r = compileRuleset(SAMPLE_SCOPED);
  assert.ok(r.ok);
  const scope = { derived: { defense: 20, maxHp: 10 }, res: { hp: 10 } };
  assert.deepEqual(healthStatesOf({ compiled: r.compiled, entity: "character", scope }), ["guarded"]);
  assert.deepEqual(healthStatesOf({ compiled: r.compiled, entity: "creature", scope }), []);
});
