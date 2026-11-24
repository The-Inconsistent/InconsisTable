import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { groupSteps, isLookupTable, previewOf, targetsOf, typedOf } from "./lookup.ts";

const made = compileRuleset(SAMPLE_HARM);
assert.ok(made.ok);
const compiled = made.compiled;
const hal = {
  id: "h",
  name: "Hal",
  entity: "hero",
  fields: { grit: 2 },
  derived: { limit: 5, strainCap: 2 },
  resources: {},
};

test("a preview is the line the server will read, for the picked target", () => {
  const plan = previewOf({
    compiled,
    tableId: "blow",
    result: 44,
    inputs: { past: true, press: 1 },
    target: hal,
    characters: 1,
    campaign: {},
  });
  assert.ok(plan?.ok);
  assert.equal(compiled.ruleset.tables?.blow?.entries[plan.entry]?.id, "reel");
  assert.deepEqual(
    groupSteps(plan.steps).map((g) => [g.step.kind, g.count]),
    [
      ["harm", 1],
      ["condition", 2],
    ],
  );
  assert.equal(
    previewOf({ compiled, tableId: "blow", result: null, inputs: {}, target: hal, characters: 1, campaign: {} }),
    null,
  );
  assert.equal(
    previewOf({ compiled, tableId: "blow", result: 44, inputs: {}, target: undefined, characters: 1, campaign: {} }),
    null,
  );
});

test("targets: the fight first in its order, then everyone else with a type", () => {
  const a = { id: "a", entity: "hero" };
  const b = { id: "b", entity: "brute" };
  const c = { id: "c", entity: "" };
  assert.deepEqual(targetsOf({ actors: [a, b, c], fighting: ["b", "c"] }), { fighting: [b], others: [a] });
});

test("only a whole typed number counts, and a table is a lookup by what it declares", () => {
  assert.deepEqual(["44", " 7 ", "", "4.5", "x"].map(typedOf), [44, 7, null, null, null]);
  assert.equal(isLookupTable(compiled.ruleset.tables!.blow!), true);
  assert.equal(isLookupTable(compiled.ruleset.tables!.aftermath!), false);
});
