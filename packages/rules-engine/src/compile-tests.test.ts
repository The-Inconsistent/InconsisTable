import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";

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
