import assert from "node:assert/strict";
import { test } from "node:test";

import { afterAnswer, afterSelect, refusalAt } from "./refusal.ts";

test("a refusal shows where its action came from, and nowhere else", () => {
  const fromPanel = afterAnswer({ result: { ok: false, error: "Fill in the sheet" }, from: "c1" });
  assert.equal(refusalAt({ refusal: fromPanel, at: "c1" }), "Fill in the sheet");
  assert.equal(refusalAt({ refusal: fromPanel, at: null }), null);
  assert.equal(refusalAt({ refusal: fromPanel, at: "c2" }), null);
  const fromTracker = afterAnswer({ result: { ok: false, error: "No fight" }, from: null });
  assert.equal(refusalAt({ refusal: fromTracker, at: null }), "No fight");
  assert.equal(refusalAt({ refusal: fromTracker, at: "c1" }), null);
});

test("a refusal clears when the next action succeeds or another combatant is selected", () => {
  const refusal = afterAnswer({ result: { ok: false, error: "No" }, from: "c1" });
  assert.equal(afterAnswer({ result: { ok: true }, from: "c1" }), null);
  assert.equal(afterSelect({ refusal, was: "c1", now: "c2" }), null);
  assert.deepEqual(afterSelect({ refusal, was: "c1", now: "c1" }), refusal);
  // The tracker's own line goes too: it may read as if it were about the new combatant.
  assert.equal(afterSelect({ refusal: { text: "No", from: null }, was: "c1", now: "c2" }), null);
});
