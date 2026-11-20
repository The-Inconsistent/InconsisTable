import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { canonicalJson, sha256Hex } from "../pack-hash.ts";
import { NOTICE_RESOURCES, SAMPLE_D20, SAMPLE_D20_BEFORE_WIDGETS } from "./sample-d20.ts";
import { SAMPLE_HARVEST } from "./sample-harvest.ts";
import { SAMPLE_NO_ORDER } from "./sample-no-order.ts";
import { SAMPLE_POOL } from "./sample-pool.ts";

// An imported ruleset version is immutable: the api refuses the same version with a different normalized manifest, so
// a sample (or an engine default) changed under the same version breaks `bun run seed` on every local database. Bump
// the sample's version, then the hash here. The hash is the one the importer compares (apps/api-go internal/ruleset/import.go).
const PINNED_0_1_5 = "0b4ebbea1f60b3883b9f88e058ac3f6900c5e37bb146a0dc46522f4e9cb58c5d";
const PINNED: Record<string, string> = {
  "sample-d20@0.1.7": "93d53cec5fc119d49a50ca0753d25cec00a698b0627b6078db971258f709c6bf",
  "sample-pool@0.1.3": "bb15d7ea7a1c37f42a4dccb05b17797292d22640470049a57e8c149202d76cbb",
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

test("a Test without marks or offers hashes as it did before they existed (house decision #80)", () => {
  const skill = SAMPLE_POOL.tests?.skill;
  assert.ok(skill);
  const { marks: _marks, offers: _offers, ...before } = skill;
  const result = compileRuleset({ ...SAMPLE_POOL, version: "0.1.2", tests: { skill: before } });
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "57e50c011a1f73ee5c2e78f0546956686f5fcec64ecda3dbdda16b71b4803b0c",
  );
});

test("a ruleset without widget rows hashes as it did before widgets existed (house decision #83)", () => {
  const result = compileRuleset(SAMPLE_D20_BEFORE_WIDGETS);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "8aa3ff0feffbc0f5289f3aa242204e10389fa957fdbdba437501fc450577b2a1",
  );
});

/** SAMPLE_D20 as it was before it declared notices and the values they read (house decision #79), at 0.1.5. */
function withoutNotices(): typeof SAMPLE_D20 {
  const { notices: _notices, ...before } = SAMPLE_D20_BEFORE_WIDGETS;
  return {
    ...before,
    version: "0.1.5",
    resources: before.resources?.filter((x) => !NOTICE_RESOURCES.includes(x.id)),
  };
}

test("a ruleset without notices hashes as it did before they existed (house decision #79)", () => {
  const result = compileRuleset(withoutNotices());
  assert.ok(result.ok);
  assert.equal(sha256Hex(canonicalJson(result.compiled.ruleset)), PINNED_0_1_5);
});

/** SAMPLE_D20 as it was before its Test had words (house decision #77). */
function withoutTestWords(): typeof SAMPLE_D20 {
  const d20 = withoutNotices();
  const worded = d20.tests?.check;
  assert.ok(worded);
  const { label: _label, inputLabels: _inputs, inputOptionLabels: _options, ...check } = worded;
  return { ...d20, tests: { ...d20.tests, check } };
}

test("a ruleset whose Tests have no words hashes as it did before they existed (house decision #77)", () => {
  const result = compileRuleset({ ...withoutTestWords(), version: "0.1.4" });
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "8e41f01ddc5cba93cc02c8869ae7702daca884840f7459b26535857364a2647a",
  );
});

test("a ruleset without a codex block hashes as it did before the block existed (house decision #71)", () => {
  const { codex: _codex, ...before } = { ...withoutTestWords(), version: "0.1.2" };
  const result = compileRuleset(before);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "6e20d1e785dcfe5c6eae0d1bebf163bf41c00b438fea68b79453493244c0defa",
  );
});

test("a codex block without links or tones hashes as it did before they existed (house decision #76)", () => {
  const codex = structuredClone(SAMPLE_D20_BEFORE_WIDGETS.codex);
  assert.ok(codex?.kinds.npc && codex.kinds.faction);
  const { home: _home, ...npc } = codex.kinds.npc.fields;
  const { seat: _seat, ...faction } = codex.kinds.faction.fields;
  const mood = npc.mood;
  assert.ok(mood?.type === "enum");
  delete mood.tones;
  const result = compileRuleset({
    ...withoutTestWords(),
    version: "0.1.3",
    codex: { kinds: { npc: { fields: npc }, faction: { fields: faction } } },
  });
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "ed6ec8736e93d4445951c4e2dadce6f2fa1902cf30852ada3b5809228073c5e5",
  );
});
