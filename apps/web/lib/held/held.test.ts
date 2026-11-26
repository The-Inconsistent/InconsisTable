import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { heldChips, heldLists, ownPicks, withItem, withoutItem } from "./held.ts";

const ruleset = Ruleset.parse(SAMPLE_SKIRMISH);
const actor = (wards?: string[]) =>
  ({ id: "c1", entity: "creature", fields: wards ? { wards } : {} }) as unknown as Actor;

test("the ruleset's chip lists, with what the actor holds (house decision #91)", () => {
  assert.deepEqual(heldLists({ ruleset, actor: actor() }), [
    { field: "wards", label: "Holding", items: [], picks: { entity: "gear" }, max: 6, owner: true },
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

test("quick picks from the character's own sheet lines, and none read here for pack picks (house decision #171)", () => {
  const ledger = Ruleset.parse(SAMPLE_LEDGER_RULESET);
  const hero = {
    id: "h1",
    entity: "hero",
    fields: {},
    ledger: { sheet: { powers: [{ name: "Ward" }, { name: "Shove" }, { name: "Ward" }, "junk"] } },
  } as unknown as Actor;
  const [list] = heldLists({ ruleset: ledger, actor: hero });
  assert.ok(list);
  assert.deepEqual(ownPicks({ list, actor: hero }), ["Ward", "Shove"]);
  const [packList] = heldLists({ ruleset, actor: actor() });
  assert.ok(packList);
  assert.equal(ownPicks({ list: packList, actor: actor() }), null);
});
