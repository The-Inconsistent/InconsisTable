import assert from "node:assert/strict";
import { test } from "node:test";

import { stepsFor } from "./enums.ts";

test("stepsFor: the GM side gets both, a player's by `editableBy`", () => {
  for (const editableBy of ["gm", "owner", "ownerSpendOnly"] as const)
    assert.deepEqual(stepsFor({ editableBy, gmSide: true }), { dec: true, inc: true });
  assert.deepEqual(stepsFor({ editableBy: "owner", gmSide: false }), { dec: true, inc: true });
  assert.deepEqual(stepsFor({ editableBy: "ownerSpendOnly", gmSide: false }), { dec: true, inc: false });
  assert.deepEqual(stepsFor({ editableBy: "gm", gmSide: false }), { dec: false, inc: false });
});
