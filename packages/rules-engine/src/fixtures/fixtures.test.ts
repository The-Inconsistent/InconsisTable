import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { SAMPLE_D20 } from "./sample-d20.ts";
import { SAMPLE_HARVEST } from "./sample-harvest.ts";
import { SAMPLE_PACK } from "./sample-pack.ts";
import { SAMPLE_POOL } from "./sample-pool.ts";

// An imported version is immutable, so a sample edited under the same version leaves every local database holding the
// old content: `bun run seed` refuses the re-import and the old copy may no longer compile. Bump the version, then the
// hash here.
const PINNED: Record<string, string> = {
  "sample-d20@0.1.1": "ec3d2aa301115d82",
  "sample-pool@0.1.1": "edfc78beeec9a18c",
  "sample-harvest@0.1.0": "ad3aba3273eaf24b",
  "sample-bestiary@0.1.0": "12b548ad1e1f590c",
};

const hash = (fixture: unknown) => createHash("sha256").update(JSON.stringify(fixture)).digest("hex").slice(0, 16);

test("a sample's content changes only with its version", () => {
  for (const fixture of [SAMPLE_D20, SAMPLE_POOL, SAMPLE_HARVEST, SAMPLE_PACK]) {
    const key = `${fixture.id}@${fixture.version}`;
    assert.equal(hash(fixture), PINNED[key], `${key} changed: bump its version, then pin the new hash`);
  }
});
