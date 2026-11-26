import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SAMPLE_GMLESS_MODULE,
  SAMPLE_MODULE,
  SAMPLE_NAMING_MODULE,
  SAMPLE_SKIRMISH_MODULE,
} from "./fixtures/sample-module.ts";
import { validateModule, moduleHash, MAX_MODULE_BYTES, MAX_MODULE_PACKS, type GameModuleInput } from "./module.ts";

const problems = (input: unknown) => {
  const r = validateModule(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path} | ${p.message}`);
};

const part = (slug: string) => ({ slug, version: "1.0.0" });
const named: GameModuleInput = { id: "m", version: "1.0.0", core: "^1.0.0", name: "M", ruleset: part("r"), packs: [] };

test("both sample modules and a module that only names its parts pass", () => {
  for (const m of [SAMPLE_MODULE, SAMPLE_SKIRMISH_MODULE, SAMPLE_GMLESS_MODULE, SAMPLE_NAMING_MODULE, named])
    assert.deepEqual(problems(m), []);
});

test("the hash leaves the carried documents out, so carrying and naming the same parts is one module", () => {
  const carried = validateModule(SAMPLE_MODULE);
  const naming = validateModule(SAMPLE_NAMING_MODULE);
  assert.ok(carried.ok && naming.ok);
  assert.equal(moduleHash(carried.module), moduleHash(naming.module));
  const other = validateModule({ ...SAMPLE_NAMING_MODULE, name: "Other" });
  assert.ok(other.ok);
  assert.notEqual(moduleHash(other.module), moduleHash(naming.module));
});

test("refusals by path: a pack named twice, a bad hash, an unknown key, too many packs, too large", () => {
  assert.deepEqual(problems({ ...named, packs: [part("a"), part("b"), part("a")] }), [
    'packs[2].slug | "a" is named twice',
  ]);
  assert.deepEqual(problems({ ...named, ruleset: { ...part("r"), hash: "ABC" } }), [
    "ruleset.hash | use the sha-256 hash in lower-case hex",
  ]);
  assert.match(problems({ ...named, extra: 1 })[0] ?? "", /^\(root\) \| Unrecognized key/);
  assert.match(problems({ ...named, documents: { rulesets: [] } })[0] ?? "", /^documents \| Unrecognized key/);
  const many = Array.from({ length: MAX_MODULE_PACKS + 1 }, (_, i) => part(`p${i}`));
  assert.match(problems({ ...named, packs: many })[0] ?? "", /^packs \| /);
  assert.match(
    problems({ ...named, pad: "x".repeat(MAX_MODULE_BYTES) })[0] ?? "",
    /^\(root\) \| \d+ bytes, over the cap/,
  );
});
