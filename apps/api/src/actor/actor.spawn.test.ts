import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnNames } from "./actor.spawn.ts";

test("spawned creatures are numbered from 1, and continue after the ones already there", () => {
  assert.deepEqual(spawnNames({ existing: [], base: "Goblin", count: 3 }), ["Goblin 1", "Goblin 2", "Goblin 3"]);
  assert.deepEqual(
    spawnNames({ existing: ["Goblin 1", "Goblin 4", "Goblin boss", "Hobgoblin 9"], base: "Goblin", count: 2 }),
    ["Goblin 5", "Goblin 6"],
  );
});

test("a base name with pattern characters matches literally, and a long one still fits", () => {
  assert.deepEqual(spawnNames({ existing: ["Orc (grunt) 2", "Orc xgrunt) 7"], base: "Orc (grunt)", count: 1 }), [
    "Orc (grunt) 3",
  ]);
  const [name] = spawnNames({ existing: [], base: "x".repeat(120), count: 1 });
  assert.ok(name !== undefined && name.length <= 100);
});
