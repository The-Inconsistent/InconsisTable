import assert from "node:assert/strict";
import { test } from "node:test";

import { controlOf } from "./campaign-field";

test("a short int range is one chip per value", () => {
  assert.deepEqual(controlOf({ type: "int", label: "Danger", min: 1, max: 5, default: 1 }), {
    kind: "chips",
    options: [1, 2, 3, 4, 5],
  });
  assert.equal(controlOf({ type: "int", label: "X", min: 0, max: 9, default: 0 }).kind, "chips");
});

test("a long int range is a number input with its bounds", () => {
  assert.deepEqual(controlOf({ type: "int", label: "Gold", min: 0, max: 10, default: 0 }), {
    kind: "number",
    min: 0,
    max: 10,
  });
});

test("an enum is its values as they are", () => {
  assert.deepEqual(controlOf({ type: "enum", label: "Mood", values: ["calm", "grim"], default: "calm" }), {
    kind: "chips",
    options: ["calm", "grim"],
  });
});

test("a bool is a switch", () => {
  assert.deepEqual(controlOf({ type: "bool", label: "Hard", default: false }), { kind: "switch" });
});
