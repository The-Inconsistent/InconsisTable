import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_DUEL } from "../../../../packages/rules-engine/src/fixtures/sample-duel.ts";
import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { stripCellsOf } from "./phone-strip.ts";

test("the strip reads each row's values, a track with its limit, and only what the seat was sent (#115)", () => {
  const duel = compileRuleset(SAMPLE_DUEL);
  assert.ok(duel.ok);
  const rows = duel.compiled.ruleset.layout.duelist?.phoneStrip ?? [];
  const duelist = { entity: "duelist", fields: { skill: 4, parry: 12 }, resources: { cuts: 1 }, derived: { limit: 5 } };
  assert.deepEqual(
    stripCellsOf({ ruleset: duel.compiled.ruleset, actor: duelist, rows }).map((c) => [c.row.id, c.max?.id ?? null]),
    [
      ["skill", null],
      ["parry", null],
      ["cuts", "limit"],
    ],
  );
  // A value the seat was not sent is left out.
  const hidden = { ...duelist, fields: { skill: 4 } };
  assert.equal(stripCellsOf({ ruleset: duel.compiled.ruleset, actor: hidden, rows }).length, 2);

  const skirmish = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(skirmish.ok);
  const warden = {
    entity: "character",
    fields: { name: "Ash", healthState: "ok" },
    resources: { hp: 7, nerve: 3 },
    derived: { maxHp: 9, defense: 12 },
  };
  assert.deepEqual(
    stripCellsOf({
      ruleset: skirmish.compiled.ruleset,
      actor: warden,
      rows: [...(skirmish.compiled.ruleset.layout.character?.phoneStrip ?? []), "res.nerve", "nope"],
    }).map((c) => c.row.id),
    ["name", "healthState", "hp", "nerve", "defense", "nerve"],
  );
});
