import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { canonicalJson, sha256Hex } from "../pack-hash.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";
import { SAMPLE_HARVEST } from "./sample-harvest.ts";
import { SAMPLE_NO_ORDER } from "./sample-no-order.ts";
import { SAMPLE_POOL } from "./sample-pool.ts";

// An imported ruleset version is immutable: the api refuses the same version with a different normalized manifest, so
// a sample (or an engine default) changed under the same version breaks `bun run seed` on every local database. Bump
// the sample's version, then the hash here. The hash is the one the importer compares (apps/api-go internal/ruleset/import.go).
const PINNED: Record<string, string> = {
  "sample-d20@0.1.2": "6e20d1e785dcfe5c6eae0d1bebf163bf41c00b438fea68b79453493244c0defa",
  "sample-pool@0.1.2": "57e50c011a1f73ee5c2e78f0546956686f5fcec64ecda3dbdda16b71b4803b0c",
  "sample-harvest@0.1.1": "e166afc269320775b0d1e455a2e7a5b10ca9b9c4f0d96f9fa473addb65b93f08",
  "sample-no-order@0.1.0": "8c5906793a4476288d19981208416984e5515cdfeb3be0531e71718fbf2850e9",
};

test("a sample ruleset's normalized manifest changes only with its version", () => {
  for (const fixture of [SAMPLE_D20, SAMPLE_POOL, SAMPLE_HARVEST, SAMPLE_NO_ORDER]) {
    const key = `${fixture.id}@${fixture.version}`;
    const result = compileRuleset(fixture);
    assert.ok(result.ok, `${key} compiles`);
    const hash = sha256Hex(canonicalJson(result.compiled.ruleset));
    assert.equal(hash, PINNED[key], `${key} changed: bump its version, then pin the new hash`);
  }
});
