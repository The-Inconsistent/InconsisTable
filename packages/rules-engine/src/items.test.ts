import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_LEDGER_PACK } from "./fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_ITEMS, SAMPLE_LEDGER_RULESET } from "./fixtures/sample-ledger-ruleset.ts";
import { itemKindOf } from "./manifest.ts";
import { validatePack } from "./pack.ts";

// Items a hero holds (house decision #95), on the ledger fixture.

const withItems = (items: unknown) =>
  compileRuleset({ ...SAMPLE_LEDGER_RULESET, items } as typeof SAMPLE_LEDGER_RULESET);
const problems = (items: unknown) => {
  const r = withItems(items);
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};

test("the ledger fixture's items compile, and its pack's gear falls into its kinds by tag", () => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  assert.ok(r.ok);
  const pack = validatePack({ input: SAMPLE_LEDGER_PACK, ruleset: r.compiled.ruleset });
  assert.ok(pack.ok);
  const kindOf = (key: string) => {
    const entry = pack.pack.entries.find((e) => e.key === key);
    assert.ok(entry, key);
    return itemKindOf({ items: r.compiled.ruleset.items, entry })?.id;
  };
  assert.equal(kindOf("wargear.hunting-bow"), "arms");
  assert.equal(kindOf("wargear.sight-lens"), "fittings");
  assert.equal(kindOf("wargear.rope"), "kit");
  assert.equal(kindOf("supply.pellets"), "stores");
});

test("an items block names real kinds, slots and a give field, and a counted kind is neither fitted nor given", () => {
  const [arms, fittings, stores, kit] = SAMPLE_LEDGER_ITEMS.kinds;
  assert.deepEqual(problems({ kinds: [{ ...arms, entry: "hero" }, fittings, stores, kit] }), [
    'items.kinds[0].entry: "hero" is an actor',
  ]);
  assert.deepEqual(problems({ kinds: [arms, { ...fittings, fits: { to: ["trinkets"], max: 2, slot: "nope" } }] }), [
    'items.kinds[1].fits.to[0]: unknown item kind "trinkets"',
    'items.kinds[1].fits.slot: wargear has no field "nope"',
  ]);
  assert.deepEqual(
    problems({
      kinds: [
        { ...arms, spend: true },
        { ...stores, fits: { to: ["arms"], max: 1 } },
      ],
    }),
    ["items.kinds[0].spend: only a counted kind is spent", "items.kinds[1].fits: a counted kind is not fitted"],
  );
  assert.deepEqual(problems({ kinds: [arms, stores], give: { ref: "of", loose: "stores" } }), [
    "items.give.loose: a counted kind is not given",
  ]);
  assert.deepEqual(problems({ kinds: [stores], give: { ref: "of", loose: "stores" } }), [
    "items.give.ref: not a ref to an item kind's entry type",
    "items.give.loose: a counted kind is not given",
  ]);
});
