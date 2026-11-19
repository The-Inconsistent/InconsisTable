import { test } from "node:test";
import assert from "node:assert/strict";
import { keepTakers, takers } from "./takers.ts";

const actors = [
  { id: "a", entity: "character" },
  { id: "b", entity: "npc" },
  { id: "c", entity: "" },
];

test("a Test that names no types keeps every built actor", () => {
  assert.deepEqual(
    takers({ actors, def: {} }).map((a) => a.id),
    ["a", "b"],
  );
});

test("a Test that names types keeps only matching actors", () => {
  assert.deepEqual(
    takers({ actors, def: { entities: ["npc"] } }).map((a) => a.id),
    ["b"],
  );
});

test("picked actors the Test does not take are dropped", () => {
  assert.deepEqual(keepTakers({ picked: ["a", "b"], actors, def: { entities: ["npc"] } }), ["b"]);
  assert.deepEqual(keepTakers({ picked: ["a", "b"], actors, def: {} }), ["a", "b"]);
});
