import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkFieldValue,
  FieldValueInput,
  MAX_LIST_ITEM_CHARS,
  MAX_LIST_ITEMS,
  MAX_TEXT_CHARS,
} from "./field-value.ts";
import type { FieldDef } from "./manifest.ts";

const base = { label: "F", visibility: "gm", editableBy: "gm" } as const;
const text: FieldDef = { ...base, type: "text" };
const list: FieldDef = { ...base, type: "list" };
const int: FieldDef = { ...base, type: "int" };

test("text over the default cap is refused, at the cap is fine", () => {
  assert.equal(checkFieldValue({ def: text, value: "x".repeat(MAX_TEXT_CHARS) }), null);
  assert.notEqual(checkFieldValue({ def: text, value: "x".repeat(MAX_TEXT_CHARS + 1) }), null);
});

test("a list with too many items or an over-long item is refused", () => {
  assert.equal(checkFieldValue({ def: list, value: Array(MAX_LIST_ITEMS).fill("a") }), null);
  assert.notEqual(checkFieldValue({ def: list, value: Array(MAX_LIST_ITEMS + 1).fill("a") }), null);
  assert.notEqual(checkFieldValue({ def: list, value: ["x".repeat(MAX_LIST_ITEM_CHARS + 1)] }), null);
});

test("an int outside int4 is refused", () => {
  assert.equal(checkFieldValue({ def: int, value: 2_147_483_647 }), null);
  assert.notEqual(checkFieldValue({ def: int, value: 2_147_483_648 }), null);
  assert.notEqual(checkFieldValue({ def: int, value: -2_147_483_649 }), null);
});

test("a pack body value is bounded like a stored one", () => {
  assert.ok(FieldValueInput.safeParse("x".repeat(MAX_TEXT_CHARS)).success);
  assert.ok(!FieldValueInput.safeParse("x".repeat(MAX_TEXT_CHARS + 1)).success);
  assert.ok(!FieldValueInput.safeParse(Array(MAX_LIST_ITEMS + 1).fill("a")).success);
  assert.ok(!FieldValueInput.safeParse(["x".repeat(MAX_LIST_ITEM_CHARS + 1)]).success);
  assert.ok(FieldValueInput.safeParse(2_147_483_647).success);
  assert.ok(!FieldValueInput.safeParse(2_147_483_648).success);
});
