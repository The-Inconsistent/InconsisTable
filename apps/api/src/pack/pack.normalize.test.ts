import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePack, type PackInput } from "@inconsistable/rules-engine";
// Fixtures are made up for the engine's own tests; they are not exported from the package.
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { checkRuleset } from "../ruleset/ruleset.check.ts";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { normalizePack } from "./pack.normalize.ts";

const checked = checkRuleset(SAMPLE_D20);
if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
const ruleset = checked.ruleset;

function normalized(input: PackInput, rulesetVersionId = "rv1") {
  const r = validatePack({ input, ruleset });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return normalizePack({ pack: r.pack, rulesetVersionId });
}

test("checkRuleset returns the normalized manifest and the same hash for the same document", () => {
  const again = checkRuleset(structuredClone(SAMPLE_D20));
  assert.ok(again.ok);
  assert.equal(again.hash, checked.hash);
  assert.equal(again.ruleset.id, "sample-d20");
});

test("checkRuleset refuses an entry without a cite, with its path", () => {
  const bad = structuredClone(SAMPLE_D20);
  delete bad.resources?.[0]?.cite;
  const r = checkRuleset(bad);
  assert.ok(!r.ok);
  assert.ok(r.problems.some((p) => p.path === "resources[0].cite"));
});

test("a pack's problems come back by path: a missing cite, an unknown entity, an oversize body", () => {
  const bad = structuredClone(SAMPLE_PACK);
  delete bad.entries[0]?.cite;
  if (bad.entries[1]) bad.entries[1].type = "nope";
  if (bad.entries[2]) bad.entries[2].body = { name: "x".repeat(20_000) };
  const r = validatePack({ input: bad, ruleset });
  assert.ok(!r.ok);
  const paths = r.problems.map((p) => p.path);
  assert.ok(paths.includes("entries[0].cite"));
  assert.ok(paths.includes("entries[1].type"));
  assert.ok(paths.some((p) => p.startsWith("entries[2].body")));
});

test("the version hash is stable, and follows content, the ruleset version and nothing else", () => {
  const base = normalized(SAMPLE_PACK);
  const reordered = structuredClone(SAMPLE_PACK);
  reordered.entries.reverse();
  assert.equal(normalized(reordered).hash, base.hash, "entry order does not matter");
  assert.equal(normalized(SAMPLE_PACK, "rv2").hash === base.hash, false, "another ruleset version is a new version");

  const edited = structuredClone(SAMPLE_PACK);
  if (edited.entries[0]) edited.entries[0].name = "Reed Folk";
  assert.notEqual(normalized(edited).hash, base.hash);
  const changed = normalized(edited).entries.filter((e, i) => e.contentHash !== base.entries[i]?.contentHash);
  assert.deepEqual(
    changed.map((e) => e.entry.key),
    ["reedfolk"],
    "only the edited entry's content hash moves",
  );
});

test("a private pack's long text is a warning, never a refusal", () => {
  const long = structuredClone(SAMPLE_PACK);
  if (long.entries[0]) long.entries[0].body = { blurb: "word ".repeat(80) };
  const r = validatePack({ input: long, ruleset });
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => w.path === "entries[0].body.blurb"));
});
