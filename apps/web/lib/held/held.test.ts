import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { heldChips, heldLists, withItem, withoutItem } from "./held.ts";

const ruleset = Ruleset.parse(SAMPLE_SKIRMISH);
const actor = (wards?: string[]) =>
  ({ id: "c1", entity: "creature", fields: wards ? { wards } : {} }) as unknown as Actor;

test("the ruleset's chip lists, with what the actor holds (house decision #91)", () => {
  assert.deepEqual(heldLists({ ruleset, actor: actor() }), [
    { field: "wards", label: "Holding", items: [], picks: "gear", max: 6, owner: true },
  ]);
  assert.deepEqual(heldChips({ ruleset, actor: actor(["Ash"]) }), [{ label: "Holding", item: "Ash" }]);
  assert.deepEqual(heldChips({ ruleset: null, actor: actor(["Ash"]) }), []);
});

test("adding skips a blank, a repeat and a full list; ending takes one out", () => {
  const [list] = heldLists({ ruleset, actor: actor(["Ash"]) });
  assert.ok(list);
  assert.deepEqual(withItem({ list, item: " Salt " }), ["Ash", "Salt"]);
  assert.equal(withItem({ list, item: "Ash" }), null);
  assert.equal(withItem({ list, item: " " }), null);
  assert.equal(withItem({ list: { ...list, max: 1 }, item: "Salt" }), null);
  assert.deepEqual(withoutItem({ list, item: "Ash" }), []);
});
