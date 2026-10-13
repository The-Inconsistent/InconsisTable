import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import type { RulesEntry } from "@/lib/library/library";

import { canStep, entityFor, parseProblems, pointsSpent, previewBuild, problemsByStep, tableLeft } from "./builder.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const entries: RulesEntry[] = SAMPLE_PACK.entries.map((e) => ({
  pack: "sample-bestiary",
  key: e.key,
  type: e.type,
  name: e.name,
  level: null,
  tags: [],
  cite: e.cite ?? null,
  visibility: e.visibility ?? "gm",
  body: e.body ?? {},
}));

test("the server's refusal is read back into problems by step", () => {
  const error =
    'Those answers don\'t build a character\nscores.attr.dex: 15 is not left\nlineage[0]: no lineage "x"\ncalling: this step needs an answer';
  const problems = parseProblems(error);
  assert.equal(problems.length, 3);
  assert.deepEqual(problemsByStep(problems), {
    scores: ["attr.dex: 15 is not left"],
    lineage: ['[0]: no lineage "x"'.replace("[0]", "[0]")],
    calling: ["this step needs an answer"],
  });
  assert.deepEqual(parseProblems("Not your character"), []);
});

test("a table hands out each value once; a point buy stops at its budget", () => {
  assert.deepEqual(tableLeft({ values: [15, 12, 9], scores: { a: 12 } }), [15, 9]);
  assert.deepEqual(tableLeft({ values: [10, 10], scores: { a: 10 } }), [10]);
  const method = { kind: "pointBuy", budget: 3, min: 8, max: 11, costs: { "8": 0, "9": 1, "10": 2, "11": 4 } } as const;
  const scores = { a: 9, b: 9 };
  assert.equal(pointsSpent({ method, scores }), 2);
  assert.equal(canStep({ method, scores, field: "a", by: 1 }), true); // 10 costs 2 + 1 = 3
  assert.equal(canStep({ method, scores: { a: 10, b: 9 }, field: "b", by: 1 }), false); // 4 points, over budget
  assert.equal(canStep({ method, scores, field: "a", by: -1 }), true);
  assert.equal(canStep({ method, scores: { a: 8 }, field: "a", by: -1 }), false); // under the range
});

test("the preview runs the creation and derives the numbers; incomplete answers give problems, not numbers", () => {
  assert.equal(entityFor({ ruleset, entityType: "" }), "character");
  const done = {
    lineage: ["reedfolk"],
    calling: ["wayfinder"],
    scores: { "attr.str": 12, "attr.dex": 9, "attr.con": 15 },
    identity: { name: "Lyra" },
  };
  const made = previewBuild({ ruleset, entity: "character", answers: done, entries });
  assert.deepEqual(made.problems, []);
  assert.equal(made.fields?.guard, 3);
  // `level` isn't set by the sample's creation, so the formulas can't run yet.
  assert.deepEqual(made.derived, []);

  const partial = previewBuild({ ruleset, entity: "character", answers: { lineage: ["reedfolk"] }, entries });
  assert.equal(partial.fields, null);
  assert.ok(partial.problems.some((p) => p.path === "calling"));
});
