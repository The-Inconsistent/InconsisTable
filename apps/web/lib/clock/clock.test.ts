import { test } from "node:test";
import assert from "node:assert/strict";
import { clampFilled, wedgePath } from "./clock.ts";

test("the first wedge of four starts at twelve o'clock and ends at three", () => {
  assert.equal(wedgePath({ index: 0, segments: 4 }), "M50 50 L50 6 A44 44 0 0 1 94 50 Z");
});

test("every wedge is a distinct path", () => {
  const paths = new Set(Array.from({ length: 12 }, (_, index) => wedgePath({ index, segments: 12 })));
  assert.equal(paths.size, 12);
});

test("a count stays inside the clock", () => {
  assert.equal(clampFilled({ filled: 9, segments: 6 }), 6);
  assert.equal(clampFilled({ filled: -2, segments: 6 }), 0);
  assert.equal(clampFilled({ filled: 3, segments: 6 }), 3);
});
