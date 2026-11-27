import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkFieldValue,
  entryCells,
  followRow,
  FieldValueInput,
  MAX_LIST_ITEM_CHARS,
  MAX_LIST_ITEMS,
  MAX_TEXT_CHARS,
} from "./field-value.ts";
import type { CodexField, FieldDef } from "./manifest.ts";

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

test("a row filled from a pack entry follows it, the GM's cells over it; without the entry, only the GM's", () => {
  const def = {
    label: "R",
    visibility: "party",
    type: "rows",
    columns: [
      { id: "name", label: "N", type: "text", maxLength: 20 },
      { id: "threat", label: "T", type: "int", max: 10 },
      { id: "effect", label: "E", type: "text" },
    ],
    from: [{ entity: "creature", name: "name", values: { threat: "level", effect: "blurb" } }],
  } satisfies Extract<CodexField, { type: "rows" }>;
  const entry = { type: "creature", key: "wisp", name: "Wisp", cite: "p.2", body: { level: 40, blurb: "Burns" } };
  const row = { id: "r", from: { entity: "creature", key: "wisp", cite: "p.1" }, values: { effect: "Mine" } };
  // The level does not fit the threat column (above 10), so it is left out; the GM's effect wins; the cite is the entry's.
  assert.deepEqual(entryCells({ def, entry }), { name: "Wisp", effect: "Burns" });
  assert.deepEqual(followRow({ def, row, entry }), {
    id: "r",
    from: { entity: "creature", key: "wisp", cite: "p.2" },
    values: { name: "Wisp", effect: "Mine" },
  });
  // Gone, not served, or another entry: the row as stored.
  assert.equal(followRow({ def, row, entry: undefined }), row);
  assert.equal(followRow({ def, row, entry: { ...entry, key: "other" } }), row);
  const own = { id: "o", values: { name: "Own" } };
  assert.equal(followRow({ def, row: own, entry }), own);
});
