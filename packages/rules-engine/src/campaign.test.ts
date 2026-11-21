import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { campaignValues, deriveValues } from "./derived.ts";
import { checkCampaignValue } from "./field-value.ts";
import { SAMPLE_D20_0_1_8 as SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_TIERED } from "./fixtures/sample-tiered.ts";
import { validateRuleset, type CampaignField, type RulesetInput } from "./manifest.ts";
import type { Problem } from "./problem.ts";

const DANGER: CampaignField = { type: "int", label: "Danger", min: 1, max: 5, default: 1, cite: "Sample p.14" };
const MOOD: CampaignField = {
  type: "enum",
  label: "Mood",
  values: ["calm", "tense"],
  default: "calm",
  cite: "Sample p.15",
};

function withCampaign(fields: unknown): unknown {
  return { ...structuredClone(SAMPLE_D20), campaignFields: fields };
}

function problems(input: unknown): Problem[] {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems;
}

function hasProblem(list: readonly Problem[], path: string, pattern: RegExp) {
  assert.ok(
    list.some((p) => p.path === path && pattern.test(p.message)),
    `expected ${path} ~ ${pattern}, got ${JSON.stringify(list)}`,
  );
}

function compile(input: RulesetInput = SAMPLE_TIERED) {
  const r = compileRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}

test("a manifest without campaignFields normalizes without the key", () => {
  const r = validateRuleset(structuredClone(SAMPLE_D20));
  assert.ok(r.ok);
  assert.equal("campaignFields" in r.ruleset, false);
});

test("a valid campaign block of each type is accepted", () => {
  const on = { type: "bool", label: "On", default: false, cite: "Sample p.1" };
  assert.deepEqual(problems(withCampaign({ danger: DANGER, mood: MOOD, on })), []);
});

test("a campaign field is checked", () => {
  hasProblem(
    problems(withCampaign({ danger: { ...DANGER, default: 6 } })),
    "campaignFields.danger.default",
    /the default is not allowed/,
  );
  hasProblem(
    problems(withCampaign({ danger: { ...DANGER, min: 6 } })),
    "campaignFields.danger.max",
    /max is below min/,
  );
  hasProblem(problems(withCampaign({ mood: { ...MOOD, default: "x" } })), "campaignFields.mood.default", /not allowed/);
  hasProblem(
    problems(withCampaign({ mood: { ...MOOD, values: ["a", "a"], default: "a" } })),
    "campaignFields.mood.values[1]",
    /duplicate id "a"/,
  );
  hasProblem(problems(withCampaign({ max: DANGER })), "campaignFields.max", /"max" is reserved for expressions/);
  hasProblem(
    problems(withCampaign({ danger: { ...DANGER, cite: undefined } })),
    "campaignFields.danger.cite",
    /needs a cite/,
  );
  hasProblem(problems(withCampaign({ danger: { ...DANGER, min: 0.5 } })), "campaignFields.danger.min", /.+/);
  hasProblem(problems(withCampaign({ danger: { ...DANGER, max: 1001 } })), "campaignFields.danger.max", /.+/);
  hasProblem(problems(withCampaign({ "a.b": DANGER })), "campaignFields.a.b", /.+/);
  hasProblem(problems(withCampaign({ n: { type: "text", label: "N" } })), "campaignFields.n.type", /.+/);
  const m = structuredClone(SAMPLE_D20);
  const character = m.entities[0];
  assert.ok(character?.fields !== undefined);
  character.fields["campaign.tier"] = { type: "int", label: "T" };
  hasProblem(problems(m), "entities[0].fields.campaign.tier", /"campaign" is reserved for expressions/);
});

test("a campaign field needs no cite in a homebrew ruleset", () => {
  const m = {
    ...(withCampaign({ danger: { ...DANGER, cite: undefined } }) as object),
    sources: [{ id: "sample", title: "T", license: "homebrew" }],
  };
  assert.deepEqual(problems(m), []);
});

test("campaign.x needs a declared field, and a public value cannot read it", () => {
  const bad = structuredClone(SAMPLE_D20);
  bad.entities[0]?.derived?.push({ id: "x", label: "X", expr: "campaign.danger" });
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  assert.ok(
    r.problems.some((p) => /unknown identifier "campaign"/.test(p.message)),
    JSON.stringify(r.problems),
  );

  const loud = structuredClone(SAMPLE_TIERED);
  const d = loud.entities[0]?.derived?.find((x) => x.id === "dangerHp");
  assert.ok(d !== undefined);
  d.visibility = "public";
  const out = compileRuleset(loud);
  assert.ok(!out.ok);
  assert.ok(out.problems.some((p) => /declared "public" but reads "party" values/.test(p.message)));
});

test("a derived value reads campaign.danger, by default and when stored", () => {
  const compiled = compile();
  const hero = { fields: { level: 1, guard: 10, "attr.con": 12, "attr.str": 10, "attr.dex": 10 } };
  const base = deriveValues({
    compiled,
    entity: "character",
    values: { ...hero, campaign: campaignValues({ compiled, stored: {} }) },
  });
  assert.equal(base.dangerHp, (base.maxHp ?? 0) + 1);
  const stored = campaignValues({ compiled, stored: { danger: 4 } });
  assert.equal(
    deriveValues({ compiled, entity: "character", values: { ...hero, campaign: stored } }).dangerHp,
    (base.maxHp ?? 0) + 4,
  );
});

test("campaignValues falls back to the default and drops unknown ids", () => {
  const compiled = compile();
  assert.deepEqual(campaignValues({ compiled, stored: { danger: 9 } }), { danger: 1 });
  assert.deepEqual(campaignValues({ compiled, stored: { danger: "3" } }), { danger: 1 });
  assert.deepEqual(campaignValues({ compiled, stored: { danger: 3, nope: 1 } }), { danger: 3 });
  assert.deepEqual(campaignValues({ compiled: compile(SAMPLE_D20), stored: { danger: 3 } }), {});
});

test("checkCampaignValue words its refusals like checkFieldValue", () => {
  const int = DANGER;
  assert.equal(checkCampaignValue({ def: int, value: 3 }), null);
  assert.equal(checkCampaignValue({ def: int, value: 1.5 }), "expected a whole number");
  assert.equal(checkCampaignValue({ def: int, value: 0 }), "below the minimum of 1");
  assert.equal(checkCampaignValue({ def: int, value: 6 }), "above the maximum of 5");
  assert.equal(checkCampaignValue({ def: MOOD, value: "x" }), "expected one of calm, tense");
  assert.equal(
    checkCampaignValue({ def: { type: "bool", label: "B", default: true }, value: 1 }),
    "expected true or false",
  );
});

test("at() on a creature picks the form the danger names", () => {
  const compiled = compile();
  const fields = { "form.f1": 11, "form.f3": 33, level: 1, "attr.con": 10 };
  const run = (danger: number) =>
    deriveValues({ compiled, entity: "creature", values: { fields, campaign: { danger } } }).formNow;
  assert.equal(run(1), 11);
  assert.equal(run(3), 33);
  assert.throws(() => run(2), /missing value "form\[2\]"/);
});
