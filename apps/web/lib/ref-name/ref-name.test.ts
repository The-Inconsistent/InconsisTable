import assert from "node:assert/strict";
import { test } from "node:test";

import type { RulesEntry } from "@/lib/library/library";

import { knownName, readName } from "./ref-name.ts";

const wisp = { pack: "sample-bestiary", key: "ember-wisp", type: "creature", name: "Ember Wisp" } as RulesEntry;

test("a ref is named from the entries the seat already holds, by type and key", () => {
  assert.equal(knownName({ known: [wisp], type: "creature", key: "ember-wisp" }), "Ember Wisp");
  assert.equal(knownName({ known: [wisp], type: "item", key: "ember-wisp" }), undefined);
  assert.equal(knownName({ known: [], type: "creature", key: "ember-wisp" }), undefined);
});

test("the rules read names a ref once per URL; a refused or empty read leaves the key", async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return [wisp];
  };
  assert.equal(await readName({ url: "/r?key=ember-wisp", key: "ember-wisp", read }), "Ember Wisp");
  assert.equal(await readName({ url: "/r?key=ember-wisp", key: "ember-wisp", read }), "Ember Wisp");
  assert.equal(reads, 1);
  // A seat that may not read the entry gets an empty answer; a refusal throws.
  assert.equal(await readName({ url: "/r?key=gm-only", key: "gm-only", read: async () => [] }), null);
  const refuse = async (): Promise<RulesEntry[]> => {
    throw new Error("No seat");
  };
  assert.equal(await readName({ url: "/r?key=refused", key: "refused", read: refuse }), null);
  // An answer for another key never names this one.
  assert.equal(await readName({ url: "/r?key=other", key: "other", read }), null);
});
