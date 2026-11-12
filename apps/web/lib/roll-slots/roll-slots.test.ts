import { test } from "node:test";
import assert from "node:assert/strict";
import { digitsOf, facesFrom, outcomeClass, outcomeKey, rollSlots, signed } from "./roll-slots.ts";

test("an outcome has a Theme class only when it is the engine's", () => {
  assert.equal(outcomeClass("critical"), "outcome-critical");
  assert.equal(outcomeClass("failure"), "outcome-failure");
  assert.equal(outcomeClass("criticalSuccess"), "outcome-criticalSuccess");
  assert.equal(outcomeKey("criticalFailure"), "criticalFailure");
  assert.equal(outcomeClass("nonsense"), "");
  assert.equal(outcomeClass(null), "");
});

test("one die is read once, or twice with advantage; dice that aren't plain NdX aren't read", () => {
  assert.deepEqual(rollSlots({ dice: "1d20", advantage: "none" }), { count: 1, sides: 20 });
  assert.deepEqual(rollSlots({ dice: "1d20", advantage: "advantage" }), { count: 2, sides: 20 });
  assert.deepEqual(rollSlots({ dice: "3d6", advantage: "none" }), { count: 3, sides: 6 });
  assert.equal(rollSlots({ dice: "2d6+3", advantage: "none" }), null);
  assert.equal(rollSlots({ dice: "nonsense", advantage: "none" }), null);
});

test("faces are sent only when every slot holds a face of the die", () => {
  assert.deepEqual(facesFrom({ typed: ["13"], sides: 20 }), [13]);
  assert.deepEqual(facesFrom({ typed: ["3", "18"], sides: 20 }), [3, 18]);
  for (const typed of [[""], ["0"], ["21"], ["1", ""], ["1.5"], ["-3"], ["abc"], []])
    assert.equal(facesFrom({ typed, sides: 20 }), null, JSON.stringify(typed));
});

test("modifiers and outcomes read as the table says them", () => {
  assert.deepEqual([signed(2), signed(0), signed(-1)], ["+2", "+0", "−1"]);
  assert.equal(outcomeKey("critical"), "critical");
  assert.equal(outcomeKey(null), null);
  assert.equal(outcomeKey("fumble"), null);
  assert.deepEqual([digitsOf(6), digitsOf(20), digitsOf(100)], [1, 2, 3]);
});
