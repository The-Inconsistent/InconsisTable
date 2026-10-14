import assert from "node:assert/strict";
import { test } from "node:test";

import type { PoolSpec } from "@inconsistable/core-schema";

import {
  countedIn,
  facesLabel,
  flagWord,
  marginText,
  ordinaryDiceOf,
  poolRoll,
  shiftsText,
  specialCountOf,
  stepCount,
} from "./pool-report.ts";

const spec: PoolSpec = {
  die: 6,
  bands: [
    { id: "top", from: 6, to: 6, worth: 2 },
    { id: "hit", from: 4, to: 5, worth: 1 },
  ],
  special: { label: "Omen die", count: 1 },
  shift: "top",
};

test("the pool splits into special dice and dice counted by band", () => {
  assert.deepEqual([specialCountOf({ spec, pool: 5 }), ordinaryDiceOf({ spec, pool: 5 })], [1, 4]);
  // An empty pool has no special die either.
  assert.deepEqual([specialCountOf({ spec, pool: 0 }), ordinaryDiceOf({ spec, pool: 0 })], [0, 0]);
  assert.equal(specialCountOf({ spec: { ...spec, special: null }, pool: 3 }), 0);
});

test("a band's faces read the way the table says them", () => {
  assert.deepEqual([facesLabel({ from: 6, to: 6 }), facesLabel({ from: 4, to: 5 })], ["6", "4–5"]);
});

test("steppers stop at none and at the dice still uncounted", () => {
  let counts: Record<string, number> = {};
  for (let i = 0; i < 6; i++) counts = stepCount({ counts, band: "top", delta: 1, ordinary: 4 });
  assert.deepEqual(counts, { top: 4 });
  counts = stepCount({ counts, band: "hit", delta: 1, ordinary: 4 });
  assert.equal(countedIn(counts), 4);
  assert.deepEqual(stepCount({ counts: {}, band: "top", delta: -1, ordinary: 4 }), { top: 0 });
});

test("the report waits for every special die and leaves out bands that counted none", () => {
  assert.equal(poolRoll({ counts: { top: 1 }, special: [null], expected: 1 }), null);
  assert.equal(poolRoll({ counts: {}, special: [], expected: 1 }), null);
  assert.deepEqual(poolRoll({ counts: { top: 1, hit: 0 }, special: [3], expected: 1 }), {
    kind: "pool",
    counts: { top: 1 },
    special: [3],
  });
  assert.deepEqual(poolRoll({ counts: {}, special: [], expected: 0 }), { kind: "pool", counts: {}, special: [] });
});

test("flags, margins and shifts are worded for the table", () => {
  assert.deepEqual(
    [flagWord("critical"), flagWord("complication"), flagWord("jackpot")],
    ["Critical", "Complication", null],
  );
  assert.deepEqual([marginText(2), marginText(-3), marginText(0)], ["+2", "−3", "on the number"]);
  assert.deepEqual([shiftsText(1), shiftsText(0), shiftsText(3)], ["1 shift", "0 shifts", "3 shifts"]);
});
