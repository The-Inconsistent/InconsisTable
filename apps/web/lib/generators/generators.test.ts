import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { rollChain } from "./generators.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);

test("a roll step's chain goes on through a line's next, and stops where a line sends nowhere (house decision #98)", () => {
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: [] }), { trail: [], next: "warren" });
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["built"] }), {
    trail: [{ title: "Warrens", label: "Built warren" }],
    next: "builders",
  });
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["built", "monks"] }).next, undefined);
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["burrowed"] }).next, undefined);
});
