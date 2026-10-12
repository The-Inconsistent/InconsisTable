import { test } from "node:test";
import assert from "node:assert/strict";
// Made up for the engine's own tests; not exported from the package.
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { checkRuleset } from "./ruleset.check.ts";
import { manifestForSeat } from "./ruleset.view.ts";

const checked = checkRuleset(SAMPLE_D20);
if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
const manifest = checked.ruleset;
const fieldsOf = (r: typeof manifest, entity: string) =>
  Object.keys(r.entities.find((e) => e.id === entity)?.fields ?? {});

test("a GM-side seat reads the whole manifest", () => {
  assert.equal(manifestForSeat({ ruleset: manifest, gm: true }), manifest);
});

test("any other seat loses the definitions whose visibility is gm (undeclared counts as gm)", () => {
  const seen = manifestForSeat({ ruleset: manifest, gm: false });
  assert.ok(fieldsOf(manifest, "character").includes("gmNote"));
  assert.equal(fieldsOf(seen, "character").includes("gmNote"), false);
  assert.ok(fieldsOf(seen, "character").includes("level"), "a party field stays");
  assert.ok(seen.entities.every((e) => e.derived.every((d) => d.visibility !== "gm")));
  assert.ok(seen.resources.every((r) => r.visibility !== "gm"));
  assert.ok(seen.conditions.every((c) => c.visibility !== "gm"));
});
