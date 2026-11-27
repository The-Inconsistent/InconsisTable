import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_LEDGER_RULESET } from "./fixtures/sample-ledger-ruleset.ts";
import { validateRuleset } from "./manifest.ts";
import type { Problem } from "./problem.ts";

// House decision #62: a ruleset picks the ledger builder for one actor type.

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests break the shape on purpose

const sample = (): Mutable => structuredClone(SAMPLE_LEDGER_RULESET) as Mutable;

function problems(input: unknown): Problem[] {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems;
}

function refused(input: unknown, path: string, message: string) {
  const list = problems(input);
  assert.ok(
    list.some((p) => p.path === path && p.message === message),
    `expected ${path}: ${message}, got ${JSON.stringify(list)}`,
  );
}

test("the sample compiles, and the compiled form holds the parsed params and the kinds", () => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (!r.ok) return;
  const b = r.compiled.build;
  assert.equal(b?.actor, "hero");
  assert.equal(b?.kinds["sub-factions"], "subFaction");
  // Parsed: the default of a mod's backgroundBonus is filled in.
  assert.equal(b?.params.vocabulary.mods[0]?.backgroundBonus, true);
  assert.equal(b?.params, r.compiled.ruleset.build?.params);
});

test("a ruleset without build compiles as before, with no build", () => {
  const r = compileRuleset(SAMPLE_D20);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.compiled.build, null);
});

test("a problem inside the params is reported under build.params", () => {
  const m = sample();
  m.build.params.tiers = { min: 3, max: 2 };
  refused(m, "build.params", "tiers.max is below tiers.min");
  const n = sample();
  n.build.params.startingXp.perTier = -1;
  refused(n, "build.params.startingXp.perTier", "Too small: expected number to be >=0");
});

test("build.actor is an actor entity", () => {
  const m = sample();
  m.build.actor = "wargear";
  refused(m, "build.actor", '"wargear" is not an actor entity');
});

test("every kind is an existing entity that is not an actor, and no two kinds share one", () => {
  const m = sample();
  m.build.kinds.powers = "nope";
  m.build.kinds.languages = "hero";
  m.build.kinds.wargear = "keyword";
  refused(m, "build.kinds.powers", 'unknown entity "nope"');
  refused(m, "build.kinds.languages", '"hero" is an actor entity, not a catalogue');
  refused(m, "build.kinds.wargear", '"keyword" already holds the keywords');
});

test("the sheet names one field of the fitting type for every Attribute, Skill and mod, each once", () => {
  const m = sample();
  delete m.build.sheet.attributes.MGT;
  m.build.sheet.skills.Juggle = "skill.lore";
  m.build.sheet.mods.grit = "nope";
  m.build.sheet.species = "xp";
  m.build.sheet.keywords = "speed";
  refused(m, "build.sheet.attributes", 'no field for "MGT"');
  refused(m, "build.sheet.skills.Juggle", '"Juggle" is not in the vocabulary');
  refused(m, "build.sheet.mods.grit", 'hero has no field "nope"');
  refused(m, "build.sheet.species", '"xp" is int, not text');
  refused(m, "build.sheet.keywords", '"speed" is int, not list');
  refused(m, "build.sheet.keywords", '"speed" is already named at build.sheet.speed');
});

test("wealth and corruption are entity resources the actor carries", () => {
  const m = sample();
  m.resources[0].entities = ["wargear"];
  m.build.sheet.corruption = "nope";
  refused(m, "build.sheet.wealth", '"wealth" is not an entity resource the hero carries');
  refused(m, "build.sheet.corruption", '"nope" is not an entity resource the hero carries');
});

test("the tier is an int campaign field within the params' tiers", () => {
  const m = sample();
  m.campaignFields.tier.max = 5;
  refused(m, "build.tier", '"tier" runs 1 to 5, outside the tiers 1 to 4');
  const n = sample();
  n.build.tier = "rank";
  refused(n, "build.tier", 'unknown campaign field "rank"');
  const o = sample();
  o.campaignFields.tier = { type: "bool", label: "Tier", default: false, cite: "Base p.2" };
  refused(o, "build.tier", '"tier" is bool, not int');
});

test("xp, when given, is an int field of the actor", () => {
  const m = sample();
  m.build.xp = "species";
  refused(m, "build.xp", '"species" is text, not int');
});

test("an actor type the ledger builder builds takes no creation steps", () => {
  const m = sample();
  m.creation = [{ id: "name", actor: "hero", kind: "fields", label: "Name", fields: ["species"], cite: "Base p.1" }];
  refused(m, "creation", "an actor type the ledger builder builds takes no creation steps");
});

// House decision #64: play after creation.

test("gone names health states the built actor type can be in", () => {
  const m = sample();
  m.entities.push({ id: "rival", label: "Rival", base: "actor", fields: {} });
  m.health.states.push({ id: "routed", when: "true", entities: ["rival"] });
  m.build.gone = ["lost", "nope", "routed"];
  refused(m, "build.gone[1]", 'unknown health state "nope"');
  refused(m, "build.gone[2]", 'unknown health state "routed"');
  assert.ok(!problems(m).some((p) => p.path === "build.gone[0]"));
});

test("the suggested awards lie within the max, ascending", () => {
  const m = sample();
  m.build.award = { max: 20, suggested: [5, 5, 3, 21], cite: "Base p.31" };
  refused(m, "build.award.suggested[1]", "5 does not come after 5");
  refused(m, "build.award.suggested[2]", "3 does not come after 5");
  refused(m, "build.award.suggested[3]", "21 is more than the max 20");
});

test("a ruleset without ascension, gone and award validates as before, with none of them", () => {
  const m = sample();
  delete m.build.ascension;
  delete m.build.gone;
  delete m.build.award;
  delete m.build.keep; // house decision #96
  delete m.build.libraryLine; // house decision #187
  const r = validateRuleset(m);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.ruleset.build ?? {}).slice(-3), ["tier", "xp", "cite"]);
});
