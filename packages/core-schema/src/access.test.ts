import { test } from "node:test";
import assert from "node:assert/strict";
import { Rename } from "./access.ts";

test("a display name is trimmed and 1 to 40 characters", () => {
  assert.deepEqual(Rename.parse({ name: "  Ana  " }), { name: "Ana" });
  assert.equal(Rename.safeParse({ name: "   " }).success, false);
  assert.equal(Rename.safeParse({ name: "" }).success, false);
  assert.equal(Rename.safeParse({ name: "x".repeat(41) }).success, false);
  assert.equal(Rename.safeParse({ name: "x".repeat(40) }).success, true);
  assert.equal(Rename.safeParse({}).success, false);
});
