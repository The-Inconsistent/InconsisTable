import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_DUEL } from "../../../../packages/rules-engine/src/fixtures/sample-duel.ts";
import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { stripCellsOf, stripPools } from "./phone-strip.ts";

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

test("a pools row draws a shared pool only when the seat was sent it, in the rows' order (#180)", () => {
  const pool = (id: string) =>
    ({
      id,
      label: id,
      scope: "party",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "party",
      editableBy: "gm",
    }) as const;
  const rows = ["pools.pressure", "res.hp", "pools.momentum"];
  assert.deepEqual(
    stripPools({ rows, pools: [pool("momentum")] }).map((p) => p.id),
    ["momentum"],
  );
  assert.deepEqual(
    stripPools({ rows, pools: [pool("momentum"), pool("pressure")] }).map((p) => p.id),
    ["pressure", "momentum"],
  );
});
