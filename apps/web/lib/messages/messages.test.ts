import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const load = (locale: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

// Every leaf of a messages tree as a dotted path.
function paths(tree: unknown, prefix = ""): string[] {
  if (typeof tree === "string") return [prefix];
  if (typeof tree !== "object" || tree === null) throw new Error(`${prefix}: a message is a string or a group`);
  return Object.entries(tree).flatMap(([k, v]) => paths(v, prefix === "" ? k : `${prefix}.${k}`));
}

test("vi.json has exactly the keys of en.json", () => {
  assert.deepEqual(paths(load("vi")).toSorted(), paths(load("en")).toSorted());
});
