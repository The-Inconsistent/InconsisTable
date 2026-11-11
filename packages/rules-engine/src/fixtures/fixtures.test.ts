import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { canonicalJson, sha256Hex } from "../pack-hash.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";
import { SAMPLE_HARVEST } from "./sample-harvest.ts";
import { SAMPLE_POOL } from "./sample-pool.ts";

// An imported ruleset version is immutable: the api refuses the same version with a different normalized manifest, so
// a sample (or an engine default) changed under the same version breaks `bun run seed` on every local database. Bump
// the sample's version, then the hash here. The hash is the one the importer compares (apps/api-go internal/ruleset/import.go).
const PINNED: Record<string, string> = {
  "sample-d20@0.1.1": "97dcbec9f6dc1fdf79d5331a72529338092c0689f39652a7d32124df5d53c3e2",
  "sample-pool@0.1.1": "c290c0771da44ec15179be78fa851e70a8212d558c4447094280d740fe7a70eb",
  "sample-harvest@0.1.0": "103fc1d2cb1020a6eb0005e7cee0bc95e259fa393b7f36804868a33658a125ca",
};

test("a sample ruleset's normalized manifest changes only with its version", () => {
  for (const fixture of [SAMPLE_D20, SAMPLE_POOL, SAMPLE_HARVEST]) {
    const key = `${fixture.id}@${fixture.version}`;
    const result = compileRuleset(fixture);
    assert.ok(result.ok, `${key} compiles`);
    const hash = sha256Hex(canonicalJson(result.compiled.ruleset));
    assert.equal(hash, PINNED[key], `${key} changed: bump its version, then pin the new hash`);
  }
});
