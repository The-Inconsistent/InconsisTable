import assert from "node:assert/strict";
import { test } from "node:test";

import { breakdownOf } from "./breakdown.ts";
import { compileRuleset } from "./compile.ts";
import { deriveValues } from "./derived.ts";
import { SAMPLE_LEDGER_RULESET } from "./fixtures/sample-ledger-ruleset.ts";

// The GM's override of a derived value (house decision #96), on the ledger fixture's Guard (armour + its mod), which
// the hero's guardSet field overrides.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  if (!r.ok) throw new Error("the ledger fixture compiles");
  return r.compiled;
})();
const fields = { armourRating: 2, "mod.guard": 1 };

test("an override replaces the worked-out value, and unset it is worked out again", () => {
  const guard = (more: Record<string, number>) =>
    deriveValues({ compiled, entity: "hero", values: { fields: { ...fields, ...more } } }).guard;
  assert.equal(guard({}), 3);
  assert.equal(guard({ guardSet: 9 }), 9);
  assert.equal(guard({ guardSet: 0 }), 0);
});

test("the breakdown shows the worked-out number, then the override by what it changes", () => {
  const lines = breakdownOf({
    compiled,
    entity: "hero",
    derivedId: "guard",
    values: { fields: { ...fields, guardSet: 9 } },
    total: 9,
  });
  assert.deepEqual(lines, [
    { source: "Guard", amount: 3, cite: null },
    { source: "Guard set by the GM", amount: 6, cite: null, override: true },
  ]);
});

test("an override names an int field of its entity, and makes the value as hidden as that field", () => {
  const withOverride = (override: string, visibility = "party") => {
    const m = structuredClone(SAMPLE_LEDGER_RULESET);
    const hero = m.entities[0]!;
    hero.derived = [{ ...hero.derived![0]!, override }];
    hero.fields = { ...hero.fields, guardSet: { type: "int", label: "G", visibility } as never };
    const r = compileRuleset(m);
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(withOverride("guardSet"), []);
  assert.deepEqual(withOverride("species"), ['entities[0].derived[0].override: "species" is not an int field of hero']);
  assert.deepEqual(withOverride("guardSet", "gm"), [
    'entities[0].derived[0].visibility: declared "party" but reads "gm" values',
  ]);
});
