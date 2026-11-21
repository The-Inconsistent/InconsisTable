import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActorItem } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { boxKinds, cardKinds, hostsOf, itemLines } from "./items.ts";

const ruleset = (() => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  if (!r.ok) throw new Error("the ledger fixture compiles");
  return r.compiled.ruleset as Ruleset;
})();

const item = (id: string, kind: string, fittedTo: string | null = null, tags: string[] = []): ActorItem => ({
  id,
  kind,
  entry: null,
  name: id,
  cite: null,
  note: "",
  quantity: null,
  fittedTo,
  source: "hand",
  entryId: null,
  rev: 1,
  tags,
  effects: [],
});

const ITEMS = [
  item("bow", "arms"),
  item("lens", "fittings", "bow"),
  item("loose", "fittings", null, ["upgrade"]),
  item("rope", "kit"),
];

test("a cards variant draws its kinds, and the box lists the rest", () => {
  assert.deepEqual([...cardKinds({ ruleset, variant: "weapons" })], ["arms"]);
  assert.deepEqual([...boxKinds({ ruleset, drawn: new Set(["weapons"]) })], ["fittings", "stores", "kit"]);
});

test("a line is a loose item with what is fitted to it", () => {
  const lines = itemLines({ ruleset, items: ITEMS, kinds: new Set(["arms", "fittings"]) });
  assert.deepEqual(
    lines.map((l) => [l.item.id, l.fitted.map((x) => x.id)]),
    [
      ["bow", ["lens"]],
      ["loose", []],
    ],
  );
});

test("an item is offered the loose items of a kind it fits, and a GM's fitting only to the GM side", () => {
  const loose = ITEMS[2]!;
  assert.deepEqual(
    hostsOf({ ruleset, items: ITEMS, item: loose, gm: false }).map((x) => x.id),
    ["bow"],
  );
  assert.deepEqual(hostsOf({ ruleset, items: ITEMS, item: { ...loose, tags: ["upgrade", "pair"] }, gm: false }), []);
  assert.equal(hostsOf({ ruleset, items: ITEMS, item: { ...loose, tags: ["pair"] }, gm: true }).length, 1);
  assert.deepEqual(hostsOf({ ruleset, items: ITEMS, item: ITEMS[0]!, gm: true }), []);
});
