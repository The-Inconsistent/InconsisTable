import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { clampCount, creatureTypes } from "./creatures.ts";

test("creatures are the actor types the builder does not build", () => {
  assert.deepEqual(creatureTypes(Ruleset.parse(SAMPLE_D20)), ["creature"]);
});

test("the count stays between 1 and 20", () => {
  assert.deepEqual([0, 1, 7, 20, 21].map(clampCount), [1, 1, 7, 20, 20]);
});
