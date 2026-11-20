import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";

// The notices block (house decision #79): checked by the validator, its `if` compiled in the actor's scope.

const withNotices = (notices: unknown) => ({ ...SAMPLE_D20, notices });
const rule = (over: object = {}) => ({
  id: "low",
  when: "crossed",
  if: "res.hp < 3",
  text: "{name} is low",
  cite: "Sample p.1",
  ...over,
});

test("a notice rule compiles its `if` against the actor types it names, with who may be told it", () => {
  const r = compileRuleset(withNotices([rule(), rule({ id: "hidden", entities: ["creature"], if: "level > 2" })]));
  assert.ok(r.ok);
  const [low, hidden] = r.compiled.notices;
  assert.deepEqual(low?.visibility, { character: "party", creature: "party" });
  assert.equal(low?.entities, null);
  // A creature's level is the GM's, so only the GM side is told that one.
  assert.deepEqual(hidden?.visibility, { creature: "gm" });
  assert.equal(hidden?.when, "crossed");
});

test("the fixture's rules compile: points at a session's start, a step reached", () => {
  const r = compileRuleset(SAMPLE_D20);
  assert.ok(r.ok);
  assert.deepEqual(
    r.compiled.notices.map((n) => [n.id, n.when]),
    [
      ["unspent", "sessionStart"],
      ["renowned", "crossed"],
    ],
  );
});

test("the validator refuses a bad notice rule", () => {
  const problems = (notices: unknown) => {
    const r = compileRuleset(withNotices(notices));
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(problems([rule(), rule()]), ['notices[1].id: duplicate id "low"']);
  assert.deepEqual(problems([rule({ entities: ["gear"] })]), ['notices[0].entities[0]: "gear" is not an actor entity']);
  assert.deepEqual(problems([rule({ cite: undefined })]), ["notices[0].cite: a rule entry needs a cite"]);
  assert.equal(problems([rule({ when: "turnStart" })]).length, 1);
  assert.equal(problems([rule({ text: "x".repeat(121) })]).length, 1);
  assert.equal(problems([rule({ if: "level" })]).length, 1);
});
