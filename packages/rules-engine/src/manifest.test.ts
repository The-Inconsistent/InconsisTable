import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { MAX_FIELDS, MAX_MANIFEST_BYTES, validateRuleset, type FieldDef, type RulesetInput } from "./manifest.ts";
import type { Problem } from "./problem.ts";

function sample(): RulesetInput {
  return structuredClone(SAMPLE_D20);
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

test("the sample manifest validates and gets fail-closed defaults", () => {
  const r = validateRuleset(SAMPLE_D20);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (!r.ok) return;
  const menace = r.ruleset.resources.find((x) => x.id === "menace");
  assert.equal(menace?.visibility, "gm");
  assert.equal(menace?.editableBy, "gm");
  assert.equal(menace?.min, "0");
  assert.equal(menace?.capped, true);
  const creature = r.ruleset.entities.find((e) => e.id === "creature");
  assert.equal(creature?.fields.guard?.visibility, "gm");
  assert.equal(creature?.derived[0]?.visibility, "gm");
  assert.equal(r.ruleset.conditions.find((c) => c.id === "marked")?.visibility, "gm");
});

test("a rule entry without a cite is refused, with its path", () => {
  const m = sample();
  delete m.resources?.[0]?.cite;
  delete m.conditions?.[2]?.cite;
  delete m.options?.[0]?.cite;
  delete m.tests?.check?.cite;
  delete m.initiative.cite;
  delete m.health?.cite;
  const list = problems(m);
  hasProblem(list, "resources[0].cite", /needs a cite/);
  hasProblem(list, "conditions[2].cite", /needs a cite/);
  hasProblem(list, "options[0].cite", /needs a cite/);
  hasProblem(list, "tests.check.cite", /needs a cite/);
  hasProblem(list, "initiative.cite", /needs a cite/);
  hasProblem(list, "health.cite", /needs a cite/);
});

test("an effect inherits its condition's cite, and needs one of its own when the condition has none", () => {
  const m = sample();
  const dazed = m.conditions?.[0];
  assert.ok(dazed !== undefined);
  assert.ok(problems(m).length === 0);
  delete dazed.cite;
  hasProblem(problems(m), "conditions[0].effects[0].cite", /needs a cite/);
});

test("a homebrew ruleset needs no cites", () => {
  const m = sample();
  m.sources = [{ id: "ours", title: "Our table", license: "homebrew" }];
  delete m.resources?.[0]?.cite;
  delete m.initiative.cite;
  delete m.tests?.check?.cite;
  assert.deepEqual(problems(m), []);
  // One non-homebrew source brings the rule back.
  m.sources.push({ id: "book", title: "A book", license: "srd" });
  hasProblem(problems(m), "resources[0].cite", /needs a cite/);
});

test("schema errors come back with paths", () => {
  const m = sample();
  const bad = { ...m, version: "one", entities: [{ ...m.entities[0], base: "vehicle" }] };
  const list = problems(bad);
  hasProblem(list, "version", /semver/);
  hasProblem(list, "entities[0].base", /.+/);
  hasProblem(problems({ ...m, sources: [] }), "sources", /.+/);
  hasProblem(problems({ ...m, core: "not a range" }), "core", /semver range/);
  assert.deepEqual(problems({ ...m, core: ">=0.1.0 <1.0.0 || 2.x" }), []);
});

test("size caps: manifest bytes and field count", () => {
  const big = { ...sample(), terms: { pad: "x".repeat(MAX_MANIFEST_BYTES) } };
  hasProblem(problems(big), "(root)", /over the cap/);

  const fields: Record<string, FieldDef> = {};
  for (let i = 0; i <= MAX_FIELDS; i++)
    fields[`f${i}`] = { type: "bool", label: "F", visibility: "gm", editableBy: "gm" };
  const m = sample();
  m.entities.push({ id: "huge", label: "Huge", base: "item", fields });
  hasProblem(problems(m), "entities", /over the cap of 2000/);
});

test("ids, references and engine constraints", () => {
  const m = sample();
  m.resources?.push({ id: "hp", label: "Again", scope: "entity", cite: "Sample p.1" });
  const character = m.entities[0];
  assert.ok(character?.fields !== undefined);
  character.fields["derived"] = { type: "int", label: "Bad" };
  character.fields["attr"] = { type: "int", label: "Clash" };
  character.fields["patron"] = { type: "ref", label: "Patron", entity: "deity" };
  m.health = {
    tracks: [
      { resource: "hp", deathSaves: { successes: 3, failures: 3 } },
      { resource: "luck", deathSaves: { successes: 1, failures: 1 } },
    ],
    cite: "Sample p.5",
  };
  const list = problems(m);
  hasProblem(list, "resources[5].id", /duplicate id "hp"/);
  hasProblem(list, "entities[0].fields.derived", /reserved/);
  hasProblem(list, "entities[0].fields.attr", /also a group/);
  hasProblem(list, "entities[0].fields.patron.entity", /unknown entity "deity"/);
  hasProblem(list, "health.tracks[1].resource", /entity-scoped/);
  hasProblem(list, "health.tracks", /only one track may have deathSaves/);
});

test("input options are only for declared text inputs", () => {
  const m = sample();
  m.tests = {
    t: {
      kind: "sumVsTarget",
      dice: "1d20",
      target: "ctx.dc",
      inputs: { dc: "int" },
      inputOptions: { dc: ["1"] },
      cite: "Sample p.2",
    },
  };
  hasProblem(problems(m), "tests.t.inputOptions.dc", /only for text/);
});

test("sumVsTarget takes plain dice, and advantage a single die", () => {
  const m = sample();
  m.tests = {
    pool: { kind: "sumVsTarget", dice: "4d6kh3", target: "10", cite: "Sample p.2" },
    twin: { kind: "sumVsTarget", dice: "2d6", target: "7", advantage: true, critOn: [13], cite: "Sample p.2" },
  };
  const list = problems(m);
  hasProblem(list, "tests.pool.dice", /plain NdX/);
  hasProblem(list, "tests.twin.advantage", /single die/);
  hasProblem(list, "tests.twin.critOn[0]", /cannot be rolled/);
  // Bad notation is a schema error, reported before the semantic pass.
  m.tests = { junk: { kind: "sumVsTarget", dice: "1d6!!", target: "1", cite: "Sample p.2" } };
  hasProblem(problems(m), "tests.junk.dice", /only one !/);
});

test("non-JSON input is refused", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  hasProblem(problems(cyclic), "(root)", /not a JSON document/);
  hasProblem(problems(undefined), "(root)", /not a JSON document/);
});
