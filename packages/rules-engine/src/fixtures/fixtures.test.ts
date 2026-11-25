import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "../compile.ts";
import { canonicalJson, sha256Hex } from "../pack-hash.ts";
import {
  CODEX_0_1_7,
  NOTICE_RESOURCES,
  SAMPLE_D20,
  SAMPLE_D20_0_1_8,
  SAMPLE_D20_0_1_9,
  SAMPLE_D20_BEFORE_WIDGETS,
} from "./sample-d20.ts";
import { SAMPLE_DUEL } from "./sample-duel.ts";
import {
  SAMPLE_HARM,
  SAMPLE_HARM_BEFORE_GENERATORS,
  SAMPLE_HARM_BEFORE_HELD,
  SAMPLE_HARM_BEFORE_SHOWS,
  SAMPLE_HARM_BEFORE_STRIKES,
} from "./sample-harm.ts";
import { SAMPLE_HARVEST } from "./sample-harvest.ts";
import { SAMPLE_NO_ORDER } from "./sample-no-order.ts";
import { SAMPLE_POOL } from "./sample-pool.ts";
import {
  SAMPLE_SKIRMISH,
  SAMPLE_SKIRMISH_BEFORE_CHECKLIST,
  SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND,
  SAMPLE_SKIRMISH_BEFORE_SPAWN,
} from "./sample-skirmish.ts";

// An imported ruleset version is immutable: the api refuses the same version with a different normalized manifest, so
// a sample (or an engine default) changed under the same version breaks `bun run seed` on every local database. Bump
// the sample's version, then the hash here. The hash is the one the importer compares (apps/api-go internal/ruleset/import.go).
const PINNED_0_1_5 = "0b4ebbea1f60b3883b9f88e058ac3f6900c5e37bb146a0dc46522f4e9cb58c5d";
const PINNED_0_1_7 = "93d53cec5fc119d49a50ca0753d25cec00a698b0627b6078db971258f709c6bf";
const PINNED: Record<string, string> = {
  "sample-d20@0.1.10": "a425b9fb13540762c37cb12a90bb07b1f718c9b678873f373e32dd99a8058df7",
  "sample-skirmish@0.1.8": "ebb0ba142aea02aaf98b884d2987b33315ff124745c4f582588c362f87391d34",
  "sample-pool@0.1.3": "bb15d7ea7a1c37f42a4dccb05b17797292d22640470049a57e8c149202d76cbb",
  "sample-harvest@0.1.2": "2fc820d7848a9f7f3651808f01cc37beba01b47789f7464ca119f41578755fb0",
  "sample-no-order@0.1.0": "8c5906793a4476288d19981208416984e5515cdfeb3be0531e71718fbf2850e9",
  "sample-harm@0.1.6": "c7e19354792885f3b496d296d0ab4725987b0e440733083c796be6113e66a561",
  "sample-duel@0.1.0": "509f85209788bc47bdd6722b2772e741248a4a35876b1e16d5c8c3e1a782a09f",
};

test("a sample ruleset's normalized manifest changes only with its version", () => {
  for (const fixture of [
    SAMPLE_D20,
    SAMPLE_POOL,
    SAMPLE_HARVEST,
    SAMPLE_NO_ORDER,
    SAMPLE_HARM,
    SAMPLE_SKIRMISH,
    SAMPLE_DUEL,
  ]) {
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

test("a ruleset without held records hashes as it did before they existed (house decision #88)", () => {
  const result = compileRuleset(SAMPLE_HARM_BEFORE_HELD);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "fab23a29bd0f76bb1829545e6fde33a060d50eb2bc3e344c551de84d4dae5d16",
  );
});

test("a ruleset without lookups hashes as it did before they existed (house decision #87)", () => {
  const { tables: _tables, ...rest } = SAMPLE_HARM_BEFORE_HELD;
  const before = { ...rest, version: "0.1.1", conditions: rest.conditions?.filter((c) => c.id !== "dazed") };
  const hash = (input: typeof SAMPLE_HARM) => {
    const result = compileRuleset(input);
    assert.ok(result.ok);
    return sha256Hex(canonicalJson(result.compiled.ruleset));
  };
  // 0.1.1 is the sample as the spends layer left it (house decision #84).
  assert.equal(hash(before), "09609370573de54941facc653194713ce3dd0458e82eafb8fc9f20bd3746555a");
  // Without the spends layer's resource, spends and convert too, it is 0.1.0 as it was before either.
  const { spends: _spends, ...older } = before;
  const harm = older.health?.harm;
  assert.ok(harm);
  assert.equal(
    hash({
      ...older,
      version: "0.1.0",
      resources: older.resources?.filter((r) => r.id !== "resolve"),
      health: { ...older.health, harm: { ...harm, profiles: harm.profiles.map(({ convert: _convert, ...p }) => p) } },
    }),
    "609d21e286fdbea8fcd54621709a1e2831d7b40a8a5b224134e807f1eb5302e7",
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

test("a codex block without tags, rows or reminders hashes as it did before they existed (house decision #89)", () => {
  const hash = (x: unknown) => {
    const result = compileRuleset(x);
    assert.ok(result.ok);
    return sha256Hex(canonicalJson(result.compiled.ruleset));
  };
  assert.equal(hash({ ...SAMPLE_D20_0_1_8, version: "0.1.7", codex: CODEX_0_1_7 }), PINNED_0_1_7);
  assert.equal(
    hash({ ...SAMPLE_SKIRMISH_BEFORE_CHECKLIST, version: "0.1.2", codex: CODEX_0_1_7 }),
    "bf150933537f5ec88178be2b24a4b2fdd1db2fe8e32d0f744d0cbc169295a41d",
  );
});

test("a ruleset without a checklist hashes as it did before checklists existed (house decision #90)", () => {
  const result = compileRuleset(SAMPLE_SKIRMISH_BEFORE_CHECKLIST);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "088fd2f9b3bf74c03ca45437ca868cc9b36acff812691bcb56c7c2334ecf97d3",
  );
});

test("a ruleset without once-a-round uses or chips hashes as it did before they existed (house decision #91)", () => {
  const result = compileRuleset(SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "036bb829436a6a414e79117a233627bd7779fd636eae2c71df8a96904446f934",
  );
});

test("a ruleset without strikes hashes as it did before they existed (house decision #99)", () => {
  const result = compileRuleset(SAMPLE_HARM_BEFORE_STRIKES);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "eb88d1d6ba450f7140a53b4892dc72258cd290ba1958c55f34a5a11abc042f68",
  );
});

test("a strike without further numbers, text values or held items as means hashes as it did before they existed (house decision #99)", () => {
  const result = compileRuleset(SAMPLE_HARM_BEFORE_SHOWS);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "1a36605600dd4eb2f7872d6cb5a4ca7ed39173bffdae09772c9d06d143227a46",
  );
});

test("a ruleset without spawn options, adjustments or a budget hashes as it did before they existed (house decision #92)", () => {
  const result = compileRuleset(SAMPLE_SKIRMISH_BEFORE_SPAWN);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "9cd49772844ad39f62972811e3e371c92a864a41766f0a559b1ce58e7ebccaa5",
  );
});

test("a ruleset without entries from packs or rolled fields hashes as it did before them (house decision #97)", () => {
  const result = compileRuleset(SAMPLE_D20_0_1_8);
  assert.ok(result.ok);
  assert.equal(
    sha256Hex(canonicalJson(result.compiled.ruleset)),
    "d8016ed3e9769e73b8493a54d050377ab60869ccbddf67c18204bf47a2ab32a5",
  );
});

test("a ruleset without generators hashes as it did before them (house decision #98)", () => {
  const hash = (x: unknown) => {
    const result = compileRuleset(x);
    assert.ok(result.ok);
    return sha256Hex(canonicalJson(result.compiled.ruleset));
  };
  assert.equal(hash(SAMPLE_D20_0_1_9), "78ddf8b683a8baaeac8047da45e459b204fb3fa167d6c96113d73ebb2a8f3c96");
  assert.equal(hash(SAMPLE_HARM_BEFORE_GENERATORS), "f6a6542841fe98f3afb81e222ccfe23143f6632929dd19a345b8e5880bedceec");
});
