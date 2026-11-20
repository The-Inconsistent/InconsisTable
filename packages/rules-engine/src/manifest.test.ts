import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_NO_ORDER } from "./fixtures/sample-no-order.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
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
  delete m.initiative?.cite;
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
  delete m.initiative?.cite;
  delete m.tests?.check?.cite;
  assert.deepEqual(problems(m), []);
  // One non-homebrew source brings the rule back.
  m.sources.push({ id: "book", title: "A book", license: "srd" });
  hasProblem(problems(m), "resources[0].cite", /needs a cite/);
});

test("the game block: bounds, no repeated mode, and a cite for playing without a GM outside homebrew", () => {
  const game = { title: "Table", players: { min: 1, max: 4 }, modes: ["gm", "gmless"] as ("gm" | "gmless")[] };
  const m = { ...sample(), game };
  hasProblem(problems(m), "game.cite", /needs a cite/);
  assert.deepEqual(problems({ ...m, game: { ...game, cite: "Book p.3" } }), []);
  // A game played with a GM only states no rule, and a homebrew one needs no cite.
  assert.deepEqual(problems({ ...m, game: { ...game, modes: ["gm"] } }), []);
  const ours: RulesetInput = { ...sample(), sources: [{ id: "ours", title: "Our table", license: "homebrew" }], game };
  delete ours.resources?.[0]?.cite;
  delete ours.initiative?.cite;
  delete ours.tests?.check?.cite;
  assert.deepEqual(problems(ours), []);
  hasProblem(problems({ ...m, game: { ...game, players: { min: 3, max: 2 } } }), "game.players", /max is below min/);
  hasProblem(problems({ ...m, game: { ...game, modes: ["gm", "gm"] } }), "game.modes", /listed twice/);
  hasProblem(problems({ ...m, game: { ...game, modes: [] } }), "game.modes", /Too small/);
  hasProblem(problems({ ...m, game: { ...game, modes: ["party"] } }), "game.modes[0]", /.+/);
  hasProblem(problems({ ...m, game: { ...game, title: "" } }), "game.title", /Too small/);
  const r = validateRuleset({ ...m, game: { ...game, cite: "x" } });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.ruleset.game?.genres, []);
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

test("phases: a duplicate id is refused, and each needs a cite outside homebrew", () => {
  const m = sample();
  m.phases = [
    { id: "plan", label: "Plan", mode: "simultaneous", cite: "Sample p.4" },
    { id: "plan", label: "Act", mode: "turns" },
  ];
  const list = problems(m);
  hasProblem(list, "phases[1].id", /duplicate id "plan"/);
  hasProblem(list, "phases[1].cite", /needs a cite/);
  // Homebrew needs none.
  m.sources = [{ id: "ours", title: "Our table", license: "homebrew" }];
  m.phases[1]!.id = "act";
  assert.deepEqual(problems(m), []);
});

test("a reported Test lists two to eight unique outcomes, each with a cite", () => {
  const outcome = (id: string) => ({ id, label: id, cite: "Sample p.3" });
  const reported = (ids: string[]) => ({ kind: "reported", outcomes: ids.map(outcome), cite: "Sample p.3" });
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`);
  const withTest = (t: unknown) => ({ ...sample(), tests: { t } });

  assert.deepEqual(problems(withTest(reported(ids(2)))), []);
  assert.deepEqual(problems(withTest(reported(ids(8)))), []);
  assert.ok(problems(withTest(reported(ids(1)))).length > 0);
  assert.ok(problems(withTest(reported(ids(9)))).length > 0);
  hasProblem(problems(withTest(reported(["a", "b", "a"]))), "tests.t.outcomes[2].id", /duplicate outcome/);

  const uncited = reported(ids(2));
  delete (uncited.outcomes[1] as { cite?: string }).cite;
  hasProblem(problems(withTest(uncited)), "tests.t.outcomes[1].cite", /needs a cite/);
  // A homebrew ruleset needs none.
  const homebrew = withTest(uncited);
  homebrew.sources = [{ id: "ours", title: "Our table", license: "homebrew" }];
  assert.deepEqual(problems(homebrew), []);
});

test("degrees of success: a cite outside homebrew, one die for a natural shift, no critOn beside them", () => {
  const m = sample();
  const check = m.tests?.check;
  assert.ok(check?.kind === "sumVsTarget");
  delete check.critOn;
  check.degrees = { step: 5, naturalShift: true };
  hasProblem(problems(m), "tests.check.degrees.cite", /needs a cite/);
  check.degrees.cite = "Sample p.2";
  assert.deepEqual(problems(m), []);
  check.critOn = [20];
  hasProblem(problems(m), "tests.check.critOn", /replace critOn/);
  delete check.critOn;
  check.dice = "2d6";
  check.advantage = false;
  hasProblem(problems(m), "tests.check.degrees.naturalShift", /single die/);
  check.degrees = { step: 0, naturalShift: false, cite: "Sample p.2" };
  assert.ok(problems(m).length > 0, "step is 1..20");
});

test("a ruleset with no initiative compiles, with none to run", () => {
  const r = compileRuleset(SAMPLE_NO_ORDER);
  assert.ok(r.ok);
  assert.equal(r.compiled.initiative, null);
  const ordeal = r.compiled.tests.ordeal?.def;
  assert.ok(ordeal?.kind === "sumVsTarget");
  assert.equal(ordeal.degrees?.step, 5);
});

// House decision #60: the sides of an `initiative.sides` order list their actor entity types, and some health states
// leave a combatant unable.
test("sides: entities and unableStates are checked", () => {
  const init = SAMPLE_SKIRMISH.initiative as { sides: object[] };
  const problems = (initiative: object) => {
    const v = validateRuleset({ ...SAMPLE_SKIRMISH, initiative: { ...init, ...initiative } });
    return v.ok ? [] : v.problems.map((p) => `${p.path}: ${p.message}`);
  };
  const [a, b] = init.sides;
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ sides: [{ ...a, entities: ["nope"] }, b] }), [
    'initiative.sides[0].entities[0]: unknown entity "nope"',
  ]);
  assert.deepEqual(problems({ sides: [{ ...a, entities: ["lineage"] }, b] }), [
    'initiative.sides[0].entities[0]: "lineage" is not an actor entity',
  ]);
  assert.deepEqual(
    problems({
      sides: [
        { ...a, entities: ["character"] },
        { ...b, entities: ["character"] },
      ],
    }),
    ['initiative.sides[1].entities[0]: "character" is already on side "wardens"'],
  );
  assert.deepEqual(problems({ unableStates: ["nope"] }), ['initiative.unableStates[0]: unknown health state "nope"']);
});

// House decision #71: the fields each kind of codex entry carries.
test("codex: the block validates, defaults to gm, and is refused where it names what is not there", () => {
  const r = validateRuleset(SAMPLE_D20);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.ruleset.codex?.kinds.npc?.fields.patron?.visibility, "gm");
  assert.equal(r.ruleset.codex?.kinds.faction?.fields.standing?.visibility, "gm");

  const withCodex = (codex: unknown) => problems({ ...sample(), codex });
  const npc = (fields: unknown) => withCodex({ kinds: { npc: { fields } } });
  assert.ok(withCodex({ kinds: { ship: { fields: {} } } }).some((p) => p.path.startsWith("codex.kinds")));
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, { type: "bool", label: "F" }]));
  hasProblem(npc(many), "codex.kinds.npc.fields", /at most 20 fields/);
  assert.deepEqual(npc(Object.fromEntries(Object.entries(many).slice(0, 20))), []);
  hasProblem(
    npc({ mine: { type: "text", label: "M", visibility: "owner" } }),
    "codex.kinds.npc.fields.mine.visibility",
    /./,
  );
  assert.ok(npc({ tags: { type: "list", label: "T" } }).some((p) => p.path.startsWith("codex.kinds.npc.fields.tags")));
  const words = (over: object) => npc({ mood: { type: "enum", label: "M", values: ["a"], ...over } });
  hasProblem(words({ labels: { b: "B" } }), "codex.kinds.npc.fields.mood.labels.b", /"b" is not a value/);
  hasProblem(words({ notes: { c: "C" } }), "codex.kinds.npc.fields.mood.notes.c", /"c" is not a value/);
  hasProblem(words({ notes: { a: "x".repeat(41) } }), "codex.kinds.npc.fields.mood.notes.a", /./);
  hasProblem(
    npc({ boss: { type: "ref", label: "B", entity: "nope" } }),
    "codex.kinds.npc.fields.boss.entity",
    /"nope"/,
  );
  hasProblem(npc({ n: { type: "int", label: "N", min: 3, max: 1 } }), "codex.kinds.npc.fields.n.max", /below min/);
});

test("enum labels and notes name the enum's own values, on entity and campaign fields too", () => {
  const s = sample();
  const character = s.entities[0];
  assert.ok(character);
  character.fields = {
    ...character.fields,
    size: { type: "enum", label: "S", values: ["small"], labels: { big: "B" } },
  };
  s.campaignFields = {
    era: { type: "enum", label: "E", values: ["old"], default: "old", notes: { new: "N" }, cite: "p" },
  };
  const found = problems(s);
  hasProblem(found, "entities[0].fields.size.labels.big", /"big" is not a value/);
  hasProblem(found, "campaignFields.era.notes.new", /"new" is not a value/);
});
