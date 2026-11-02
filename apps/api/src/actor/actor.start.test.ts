import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRuleset, runCreation, type CompiledRuleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { entryLookup, type StoredEntry } from "../pack/pack.lookup.ts";
import { buildEntity } from "./actor.build.ts";
import { startingResources } from "./actor.start.ts";

const compiled: CompiledRuleset = (() => {
  const r = compileRuleset(SAMPLE_D20);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.problems));
  return r.compiled;
})();
const party = { characters: 2 };
const entries: StoredEntry[] = SAMPLE_PACK.entries.map((e) => ({
  packVersionId: "v1",
  key: e.key,
  type: e.type,
  name: e.name,
  level: null,
  tags: [],
  cite: e.cite ?? null,
  visibility: e.visibility ?? "gm",
  body: e.body ?? {},
}));

test("answers become fields and choices, and the resources start full (or at their floor)", () => {
  const lookup = entryLookup({ entries, gm: false });
  const built = runCreation({
    ruleset: compiled.ruleset,
    actor: "character",
    lookup,
    answers: {
      lineage: ["reedfolk"],
      calling: ["wayfinder"],
      scores: { "attr.str": 12, "attr.dex": 9, "attr.con": 15 },
      identity: { name: "Lyra", level: 2 },
    },
  });
  assert.ok(built.ok);
  assert.deepEqual(
    built.choices.map((c) => `${c.stepId}:${c.optionKey}`),
    ["lineage:reedfolk", "calling:wayfinder"],
  );
  assert.equal(built.fields.guard, 3); // copied from the calling

  const start = startingResources({ compiled, entity: "character", fields: built.fields, party });
  const by = Object.fromEntries(start.map((r) => [r.resource, r.value]));
  assert.equal(by.hp, 6 + 2 + 4); // base 6 + mod(15) + (level 2 - 1) * 4
  assert.equal(by.tempHp, 0); // no ceiling: its floor
  assert.equal(by.focus, 1);
  assert.equal("luck" in by, false); // party-scoped, not the actor's
});

test("a player's answers can't pick a gm entry; the entity of an untyped character is the one creation builds", () => {
  const bad = runCreation({
    ruleset: compiled.ruleset,
    actor: "character",
    lookup: entryLookup({ entries, gm: false }),
    answers: { lineage: ["ember-wisp"] },
  });
  assert.ok(!bad.ok);
  assert.equal(bad.problems.find((p) => p.path === "lineage[0]")?.message, 'no lineage "ember-wisp"');
  assert.equal(buildEntity({ compiled, entityType: "" }), "character");
  assert.equal(buildEntity({ compiled, entityType: "creature" }), "creature");
});
