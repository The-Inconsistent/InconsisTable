import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActorItem } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { boxKinds, buildLines, cardKinds, hostsOf, itemEntries, itemLines, lineHostsOf, withFitted } from "./items.ts";

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
    ["bow", "rope"], // fittings go on kit too (sample-ledger 0.1.6, house decision #176)
  );
  assert.deepEqual(hostsOf({ ruleset, items: ITEMS, item: { ...loose, tags: ["upgrade", "pair"] }, gm: false }), []);
  assert.equal(hostsOf({ ruleset, items: ITEMS, item: { ...loose, tags: ["pair"] }, gm: true }).length, 2);
  assert.deepEqual(hostsOf({ ruleset, items: ITEMS, item: ITEMS[0]!, gm: true }), []);
});

// House decision #102: a fitting goes on a line of the saved build as on an item, and changes its host's numbers.
test("a fitting is offered the build's lines of a kind it fits, and an item fitted to a line is not loose", () => {
  const sheet = { weapons: [{ name: "Staff" }, { name: "Staff" }, { name: "Sling" }], armour: { name: "Coat" } };
  assert.deepEqual(
    buildLines(sheet).map((l) => l.ref),
    ["weapons/Staff", "weapons/Sling", "armour/Coat"],
  );
  assert.deepEqual(buildLines({ weapons: [], armour: { name: "" } }), []);
  const actor = {
    entity: "hero",
    ledger: { build: null, sheet, draft: null, xpSpent: 0, xpAtAscension: 0, packageWaived: false },
  };
  const lens = ITEMS[2]!;
  assert.deepEqual(
    lineHostsOf({ ruleset, actor, item: lens, gm: false }).map((l) => l.ref),
    ["weapons/Staff", "weapons/Sling"],
  );
  assert.deepEqual(lineHostsOf({ ruleset, actor, item: ITEMS[0]!, gm: true }), []);
  const onLine = { ...lens, id: "on", fittedLine: "weapons/Staff" };
  assert.deepEqual(
    itemLines({ ruleset, items: [...ITEMS, onLine], kinds: new Set(["fittings"]) }).map((l) => l.item.id),
    ["loose"],
  );
});

test("the breakdown names an item's effects: a fitting's only while fitted, never its host's card", () => {
  const effect = (path: string) => ({ path, mode: "add", value: "1", phase: "derived" });
  const lens = (id: string, more: Partial<ActorItem>) => ({
    ...item(id, "fittings"),
    entry: "wargear.sight-lens",
    effects: [effect("derived.guard"), effect("host.ed")],
    ...more,
  });
  const entries = itemEntries({
    ruleset,
    items: [
      lens("loose", {}),
      lens("onLine", { fittedLine: "weapons/Staff" }),
      { ...item("note", "kit"), effects: [] },
    ],
  });
  assert.deepEqual(
    entries.map((e) => [e.name, e.effects.map((x) => x.path)]),
    [["onLine", ["derived.guard"]]],
  );
});

test("a card's numbers take what is fitted to it, naming what changed them", () => {
  const effect = (path: string) => ({ path, mode: "add" as const, value: "1", phase: "base" as const });
  const sharp = { name: "Sight", effects: [effect("host.ed")] };
  const guard = { name: "Lens", effects: [effect("derived.guard")] };
  assert.deepEqual(withFitted({ card: { name: "Bow", damage: 4, ed: 1, range: [8] }, fitted: [sharp, guard] }), {
    name: "Bow",
    damage: 4,
    ed: 2,
    range: [8],
    by: ["Sight"],
  });
  assert.deepEqual(withFitted({ card: { ed: "1d3" }, fitted: [sharp] }), { ed: "1d3", by: ["Sight"] });
});
