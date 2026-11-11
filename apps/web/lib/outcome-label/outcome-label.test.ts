import assert from "node:assert/strict";
import { test } from "node:test";

import { outcomeLabel } from "./outcome-label.ts";

const outcomes = [
  { id: "clean", label: "Clean" },
  { id: "missed", label: "Missed" },
];

test("the label of a listed outcome, the id of an unlisted one, nothing when hidden", () => {
  assert.equal(outcomeLabel({ outcomes, id: "missed" }), "Missed");
  assert.equal(outcomeLabel({ outcomes, id: "gone" }), "gone");
  assert.equal(outcomeLabel({ outcomes, id: null }), null);
});
