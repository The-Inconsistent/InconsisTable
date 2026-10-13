import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { entryLookup, type StoredEntry } from "./pack.lookup.ts";

const stored: StoredEntry[] = SAMPLE_PACK.entries.map((e) => ({
  packVersionId: "v1",
  key: e.key,
  type: e.type,
  name: e.name,
  level: e.level ?? null,
  tags: e.tags ?? [],
  cite: e.cite ?? null,
  visibility: e.visibility ?? "gm",
  body: e.body ?? {},
}));

test("a player's lookup never finds a gm entry; the GM side finds it", () => {
  const gm = entryLookup({ entries: stored, gm: true });
  const player = entryLookup({ entries: stored, gm: false });
  assert.equal(gm({ type: "creature", key: "ember-wisp" })?.name, "Ember Wisp");
  assert.equal(player({ type: "creature", key: "ember-wisp" }), undefined);
  assert.equal(player({ type: "lineage", key: "reedfolk" })?.body.size, "small"); // public
  assert.equal(player({ type: "gear", key: "coil-rope" })?.name, "Coil of Rope"); // party
});

test("a key is found only under its own type", () => {
  const gm = entryLookup({ entries: stored, gm: true });
  assert.equal(gm({ type: "calling", key: "reedfolk" }), undefined);
});
