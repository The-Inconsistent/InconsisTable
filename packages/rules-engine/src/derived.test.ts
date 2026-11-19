import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, topoSort, type CompiledRuleset } from "./compile.ts";
import {
  actorScope,
  applyBaseEffects,
  deriveValues,
  healthStatesOf,
  resetValue,
  resourceBounds,
  startValue,
} from "./derived.ts";
import { evaluateInt } from "./expr/expr.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import type { RulesetInput } from "./manifest.ts";
import type { Problem } from "./problem.ts";

function compile(input: RulesetInput = SAMPLE_D20): CompiledRuleset {
  const r = compileRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}

function problemsOf(input: RulesetInput): Problem[] {
  const r = compileRuleset(input);
  return r.ok ? [] : r.problems;
}

/** The sample with extra derived values first on the character (so their indices are 0, 1, …). */
function withDerived(extra: NonNullable<RulesetInput["entities"][number]["derived"]>): RulesetInput {
  const m = structuredClone(SAMPLE_D20);
  m.creation = []; // these tests read fields the builder never sets (the creation check has its own tests)
  const character = m.entities[0];
  assert.ok(character !== undefined);
  const ids = new Set(extra.map((d) => d.id));
  character.derived = [...extra, ...(character.derived ?? []).filter((d) => !ids.has(d.id))];
  return m;
}

const HERO = {
  fields: { name: "Ash", level: 3, "attr.str": 14, "attr.dex": 16, "attr.con": 12, guard: 11 },
  resources: { hp: 9, tempHp: 0 },
  party: { characters: 4 },
};

test("the sample compiles, with derived values in dependency order", () => {
  const c = compile();
  assert.deepEqual(
    c.entities.character?.derived.map((d) => d.id),
    ["baseHp", "initBonus", "maxHp", "defense"],
  );
  assert.deepEqual(c.entities.character?.derived.find((d) => d.id === "maxHp")?.deps, ["baseHp"]);
  assert.deepEqual(c.entities.character?.resources, ["hp", "tempHp", "focus"]);
  assert.deepEqual(c.entities.creature?.resources, ["hp", "tempHp"]);
  assert.deepEqual(c.entities.gear?.resources, []);
});

test("deriveValues computes every derived value", () => {
  const c = compile();
  // baseHp = 6 + mod(12) = 7; maxHp = 7 + 2 * 4 = 15; initBonus = mod(16) = 3; defense = 11 + 3 = 14.
  assert.deepEqual(deriveValues({ compiled: c, entity: "character", values: HERO }), {
    baseHp: 7,
    initBonus: 3,
    maxHp: 15,
    defense: 14,
  });
  assert.throws(() => deriveValues({ compiled: c, entity: "vehicle", values: HERO }), /unknown entity type/);
  assert.throws(
    () => deriveValues({ compiled: c, entity: "character", values: { fields: { level: 1 } } }),
    /missing value "attr.con"/,
  );
});

test("condition effects apply in phase order and int fields clamp", () => {
  const c = compile();
  // dazed: Grace -2 before derived values (initBonus 3 → 2, defense 14 → 13); braced: defense +2 after them.
  const dazed = deriveValues({ compiled: c, entity: "character", values: { ...HERO, conditions: ["dazed"] } });
  assert.equal(dazed.initBonus, 2);
  assert.equal(dazed.defense, 13);
  const both = deriveValues({ compiled: c, entity: "character", values: { ...HERO, conditions: ["dazed", "braced"] } });
  assert.equal(both.defense, 15);
  // Grace 2 - 2 = 0 clamps to the field's min of 1.
  const weak = applyBaseEffects({
    compiled: c,
    entity: "character",
    values: { ...HERO, fields: { ...HERO.fields, "attr.dex": 2 }, conditions: ["dazed"] },
  });
  assert.equal(weak["attr.dex"], 1);
});

test("an unknown identifier in a derived expression is a load error with its path", () => {
  const list = problemsOf(withDerived([{ id: "luck", label: "Luck", expr: "attr.wis + 1" }]));
  assert.deepEqual(list, [{ path: "entities[0].derived[0].expr", message: 'unknown identifier "attr.wis"' }]);
});

test("a derived cycle is a load error", () => {
  const list = problemsOf(
    withDerived([
      { id: "a", label: "A", expr: "derived.b + 1" },
      { id: "b", label: "B", expr: "derived.c + 1" },
      { id: "c", label: "C", expr: "derived.a + 1" },
      { id: "d", label: "D", expr: "1" },
    ]),
  );
  assert.deepEqual(list, [{ path: "entities[0].derived", message: "derived values form a cycle: a, b, c" }]);
  const self = problemsOf(withDerived([{ id: "a", label: "A", expr: "derived.a" }]));
  assert.match(self[0]?.message ?? "", /cycle: a/);
});

test("a derived value may not read a field creation never sets; without creation steps it is fine", () => {
  const m = structuredClone(SAMPLE_D20);
  const character = m.entities[0];
  assert.ok(character !== undefined);
  const j = character.derived?.length ?? 0;
  character.derived = [...(character.derived ?? []), { id: "lucky", label: "Lucky", expr: 'diary == "" ? 1 : 0' }];
  assert.deepEqual(problemsOf(m), [
    {
      path: `entities[0].derived[${j}].expr`,
      message: 'creation never sets "diary", which this reads; add it to a creation step',
    },
  ]);
  m.creation = [];
  assert.deepEqual(problemsOf(m), []);
});

test("topoSort keeps declaration order among independent nodes", () => {
  const graph = new Map([
    ["c", ["a"]],
    ["a", []],
    ["b", []],
  ]);
  assert.deepEqual(topoSort(graph), { order: ["a", "b", "c"], cycle: [] });
});

test("visibility taint: a derived value is as hidden as its inputs", () => {
  // guard is party, diary is owner, gmNote is gm on the character.
  const looser = problemsOf(
    withDerived([
      { id: "maxHp", label: "Max", expr: "10", visibility: "party" },
      { id: "secret", label: "Secret", expr: "has(gmNote) ? 1 : 0", visibility: "party" },
      { id: "mine", label: "Mine", expr: "has(diary) ? guard : 0", visibility: "public" },
      { id: "chain", label: "Chain", expr: "derived.secret + 1", visibility: "owner" },
    ]),
  );
  assert.deepEqual(looser, [
    { path: "entities[0].derived[1].visibility", message: 'declared "party" but reads "gm" values' },
    { path: "entities[0].derived[2].visibility", message: 'declared "public" but reads "owner" values' },
  ]);
  // A computed index reaches every attribute, so it takes the strictest of them.
  const m = withDerived([{ id: "best", label: "Best", expr: 'attr["str"] + attr[name]', visibility: "public" }]);
  const list = problemsOf(m);
  assert.match(list[0]?.message ?? "", /reads "party"/);
  // Declaring the strictest (or stricter) is always fine.
  assert.deepEqual(problemsOf(withDerived([{ id: "x", label: "X", expr: "has(gmNote) ? 1 : 0" }])), []);
});

test("visibility taint: an effect may not reveal a hidden condition or input in a more visible value", () => {
  const hidden = structuredClone(SAMPLE_D20);
  const dazed = hidden.conditions?.[0];
  assert.ok(dazed !== undefined);
  // A GM-only condition changing a party-visible attribute would tell the players it is on.
  dazed.visibility = "gm";
  assert.deepEqual(problemsOf(hidden), [
    {
      path: "conditions[0].effects[0].path",
      message: '"attr.dex" on character is "party" but the effect reveals "gm" values',
    },
  ]);
  const secret = structuredClone(SAMPLE_D20);
  const braced = secret.conditions?.[1]?.effects?.[0];
  assert.ok(braced !== undefined);
  braced.value = "has(gmNote) ? 5 : 2";
  assert.match(problemsOf(secret)[0]?.message ?? "", /reveals "gm" values/);
});

test("resource bounds, resets and health states", () => {
  const c = compile();
  const derived = deriveValues({ compiled: c, entity: "character", values: HERO });
  const scope = actorScope({ ...HERO, derived });
  assert.deepEqual(resourceBounds({ compiled: c, resource: "hp", scope }), { min: 0, max: 15, capped: true });
  assert.deepEqual(resourceBounds({ compiled: c, resource: "tempHp", scope }), { min: 0, max: null, capped: true });
  assert.equal(resetValue({ compiled: c, resource: "hp", event: "longRest", scope }), 15);
  assert.equal(resetValue({ compiled: c, resource: "hp", event: "shortRest", scope }), null);
  const party = actorScope({ fields: {}, party: { characters: 2 } });
  assert.equal(resourceBounds({ compiled: c, resource: "luck", scope: party }).max, 3);
  assert.equal(resetValue({ compiled: c, resource: "luck", event: "sessionStart", scope: party }), 0);
  // 9 * 2 <= 15 is false; at 7 it holds.
  assert.deepEqual(healthStatesOf({ compiled: c, entity: "character", scope }), []);
  const hurt = actorScope({ ...HERO, resources: { hp: 7 }, derived });
  assert.deepEqual(healthStatesOf({ compiled: c, entity: "character", scope: hurt }), ["bloodied"]);
});

test("a max below the min collapses to the min", () => {
  const m = structuredClone(SAMPLE_D20);
  m.resources?.push({ id: "odd", label: "Odd", scope: "gm", min: "5", max: "2", cite: "Sample p.1" });
  const c = compile(m);
  assert.deepEqual(resourceBounds({ compiled: c, resource: "odd", scope: actorScope({ fields: {} }) }), {
    min: 5,
    max: 5,
    capped: true,
  });
});

test("a resource's start is held to its bounds; absent, startValue is null", () => {
  const m = structuredClone(SAMPLE_D20);
  const base = { scope: "gm", min: "2", max: "5", cite: "Sample p.1" } as const;
  m.resources?.push(
    { ...base, id: "a", label: "A", start: "min" },
    { ...base, id: "b", label: "B", start: "max" },
    { ...base, id: "c", label: "C", start: "9" },
    { ...base, id: "d", label: "D", start: "9", capped: false },
    { ...base, id: "e", label: "E", start: "0" },
    { ...base, id: "f", label: "F" },
  );
  const c = compile(m);
  const scope = actorScope({ fields: {} });
  const start = (resource: string) => startValue({ compiled: c, resource, scope });
  assert.deepEqual([start("a"), start("b"), start("c"), start("d"), start("e"), start("f")], [2, 5, 5, 9, 2, null]);
});

test("a test's expressions read call-time inputs as ctx", () => {
  const c = compile();
  const t = c.tests.check;
  assert.ok(t !== undefined);
  const scope = actorScope({ ...HERO, ctx: { ability: "dex", dc: 12 } });
  assert.equal(evaluateInt({ expr: t.modifier, scope }), 3);
  assert.equal(evaluateInt({ expr: t.target, scope }), 12);
});

test("expressions in resources, tests, initiative and health are checked at load", () => {
  const m = structuredClone(SAMPLE_D20);
  m.resources?.push({ id: "bad", label: "Bad", scope: "entity", max: "res.hp", cite: "Sample p.1" });
  const check = m.tests?.check;
  assert.ok(check !== undefined);
  assert.ok(check.kind === "sumVsTarget");
  check.target = "ctx.difficulty";
  assert.ok(m.initiative?.strategy === "ranked");
  m.initiative.score = "attr.dex > 1";
  m.health = { ...m.health, states: [{ id: "low", when: "res.hp" }] };
  const list = problemsOf(m);
  const paths = list.map((p) => p.path);
  assert.deepEqual(paths, ["resources[5].max", "tests.check.target", "initiative.score", "health.states[0].when"]);
});
