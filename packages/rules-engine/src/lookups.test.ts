import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, type CompiledRuleset } from "./compile.ts";
import { actorScope, applyBaseEffects } from "./derived.ts";
import { SAMPLE_HARM, SAMPLE_HARM_BEFORE_STRIKES } from "./fixtures/sample-harm.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import { planLookup, readLookup, rowOf, withLists } from "./lookups.ts";
import { validateRuleset, type RulesetInput } from "./manifest.ts";

// Lookups (house decision #87): a typed result, the inputs and the target pick one line, whose effects become steps.

const compiled = ((): CompiledRuleset => {
  const r = compileRuleset(SAMPLE_HARM);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  return r.compiled;
})();
const hero = actorScope({ fields: { grit: 3 }, derived: { limit: 6, strainCap: 3 }, resources: { wounds: 0 } });
const brute = actorScope({ fields: { hide: 4 }, derived: { limit: 4, strainCap: 0 }, resources: { wounds: 0 } });
const plan = (result: number, inputs: Record<string, unknown> = {}, scope = hero) =>
  planLookup({ compiled, tableId: "blow", result, inputs, scope });

test("the switch changes the wounds a line deals", () => {
  assert.deepEqual(plan(23), { ok: true, total: 23, entry: 0, steps: [{ kind: "harm", wounds: 1, shock: 0 }] });
  assert.deepEqual(plan(23, { past: true }), {
    ok: true,
    total: 23,
    entry: 0,
    steps: [{ kind: "harm", wounds: 2, shock: 0 }],
  });
});

test("the modifier raises the total, and a total past the last start reads the open-ended line", () => {
  const r = plan(36, { surge: 3, past: true });
  assert.ok(r.ok);
  assert.equal(r.total, 66);
  assert.equal(r.entry, 2);
  assert.deepEqual(plan(66, { surge: 4 }), {
    ok: true,
    total: 106,
    entry: 2,
    steps: [{ kind: "harm", wounds: 1, shock: 0 }],
  });
});

test("times repeats an effect, and a condition the target is immune to stays a marked step", () => {
  const r = plan(44, { past: true, press: 2 });
  assert.ok(r.ok);
  assert.deepEqual(r.steps, [
    { kind: "harm", wounds: 2, shock: 0 },
    { kind: "condition", condition: "dazed", immune: false },
    { kind: "condition", condition: "dazed", immune: false },
    { kind: "condition", condition: "dazed", immune: false },
  ]);
  const b = plan(44, { past: true, press: 1 }, brute);
  assert.ok(b.ok);
  assert.deepEqual(
    b.steps.map((s) => (s.kind === "condition" ? s.immune : s.kind)),
    ["harm", true, true],
  );
});

test("a result off the die or a bad input is refused", () => {
  assert.deepEqual(plan(17), { ok: false, code: "tableResultOut", min: 11, max: 66 });
  assert.deepEqual(plan(70), { ok: false, code: "tableResultOut", min: 11, max: 66 });
  assert.deepEqual(plan(23, { surge: 5 }), { ok: false, code: "tableInput", input: "surge" });
  assert.deepEqual(plan(23, { past: 1 }), { ok: false, code: "tableInput", input: "past" });
  assert.deepEqual(plan(23, { nope: true }), { ok: false, code: "tableInput", input: "nope" });
  assert.deepEqual(planLookup({ compiled, tableId: "nope", result: 1, inputs: {}, scope: hero }), {
    ok: false,
    code: "tableNotFound",
  });
  assert.deepEqual(readLookup({ compiled, tableId: "blow", result: 23, inputs: {}, scope: null }), {
    ok: false,
    code: "unreadable",
    detail: "the modifier reads a target",
  });
});

test("a total between lines reads the line below it; one under every line reads the lowest", () => {
  const entries = [
    { id: "a", label: "A", range: [11, 16] },
    { id: "b", label: "B", range: [21, 26] },
    { id: "c", label: "C", range: [31] },
  ];
  assert.equal(rowOf({ entries, total: 18 }), 0);
  assert.equal(rowOf({ entries, total: 26 }), 1);
  assert.equal(rowOf({ entries, total: 500 }), 2);
  assert.equal(rowOf({ entries, total: 3 }), 0);
  assert.equal(rowOf({ entries: [{ id: "a", label: "A" }], total: 3 }), -1);
});

const withTable = (table: unknown, over: Record<string, unknown> = {}): RulesetInput =>
  ({ ...structuredClone(SAMPLE_HARM_BEFORE_STRIKES), ...over, tables: { t: table } }) as RulesetInput;
const keys = (input: unknown): string[] => {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path} | ${p.message}`);
};
const base = { title: "T", die: "d6", visibility: "gm", cite: "Sample p.1" };

test("an open-ended line is the last one, and lines past the die need a modifier", () => {
  const open = {
    ...base,
    entries: [
      { id: "a", label: "A", range: [1, 3] },
      { id: "b", label: "B", range: [4] },
    ],
  };
  assert.deepEqual(keys(withTable(open)), []);
  const early = {
    ...base,
    entries: [
      { id: "a", label: "A", range: [1] },
      { id: "b", label: "B", range: [4, 6] },
    ],
  };
  assert.deepEqual(keys(withTable(early)), [
    "tables.t.entries[0].range | only the last entry may leave its upper bound out",
    "tables.t.entries | no entry for 1",
  ]);
  const past = {
    ...base,
    entries: [
      { id: "a", label: "A", range: [1, 6] },
      { id: "b", label: "B", range: [7, 9] },
    ],
  };
  assert.deepEqual(keys(withTable(past)), ["tables.t.entries[1].range | outside the die (1 to 6)"]);
  assert.deepEqual(keys(withTable({ ...past, modifier: "1" })), []);
  const gap = { ...past, modifier: "1", entries: [past.entries[0], { id: "b", label: "B", range: [8, 9] }] };
  assert.deepEqual(keys(withTable(gap)), ["tables.t.entries | no entry for 7"]);
});

test("a lookup's parts name what the ruleset has", () => {
  const line = (apply: unknown[], over: Record<string, unknown> = {}) => ({
    ...base,
    entries: [{ id: "a", label: "A", range: [1, 6], apply, ...over }],
  });
  assert.deepEqual(keys(withTable(line([{ kind: "condition", condition: "nope" }]))), [
    'tables.t.entries[0].apply[0].condition | unknown condition "nope"',
  ]);
  assert.deepEqual(keys(withTable(line([{ kind: "resource", resource: "wounds", by: "1" }]))), [
    'tables.t.entries[0].apply[0].resource | only a hit moves "wounds"',
  ]);
  assert.deepEqual(keys(withTable(line([{ kind: "pool", pool: "members", by: "1" }]))), [
    'tables.t.entries[0].apply[0].pool | "members" is not a shared pool',
  ]);
  assert.deepEqual(keys(withTable(line([{ kind: "harm" }]))), [
    "tables.t.entries[0].apply[0] | a hit takes wounds or shock",
  ]);
  assert.deepEqual(keys(withTable(line([{ kind: "harm", wounds: "1" }], { next: "gone" }))), [
    'tables.t.entries[0].next | unknown table "gone"',
  ]);
  assert.deepEqual(keys(withTable({ ...line([{ kind: "harm", wounds: "1" }]), visibility: "owner" })), [
    "tables.t.visibility | a dealt table is not a lookup",
  ]);
  const { die: _die, ...noDie } = line([{ kind: "harm", wounds: "1" }]);
  assert.ok(keys(withTable(noDie)).includes("tables.t.die | a lookup needs a die"));
  assert.deepEqual(
    keys(
      withTable({ ...line([{ kind: "harm", wounds: "1" }]), inputs: [{ id: "x", label: "X", type: "bool", max: 2 }] }),
    ),
    ["tables.t.inputs[0] | a switch has no bounds"],
  );
  const noHarm = { ...withTable(line([{ kind: "harm", wounds: "1" }])), health: { states: [] } };
  assert.deepEqual(keys(noHarm), ["tables.t.entries[0].apply[0] | a hit needs health.harm"]);
});

test("a lookup's expressions compile over the target and its inputs", () => {
  const bad = withTable({
    ...base,
    inputs: [{ id: "on", label: "On", type: "bool" }],
    modifier: "ctx.on",
    entries: [{ id: "a", label: "A", range: [1, 6], apply: [{ kind: "harm", wounds: "nope", when: "ctx.off" }] }],
  });
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  assert.deepEqual(
    r.problems.map((p) => p.path),
    ["tables.t.modifier", "tables.t.entries[0].apply[0].when", "tables.t.entries[0].apply[0].wounds"],
  );
});

test("an unset list field reads as empty wherever it is read, a held kind's or not (house decisions #88, #91)", () => {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(r.ok);
  // The derived pass fills the actor's own type's lists, unset or null.
  const values = { fields: { wards: null } };
  assert.deepEqual(applyBaseEffects({ compiled: r.compiled, entity: "character", values }).wards, []);
  // A scope built from stored fields reads the same.
  assert.deepEqual(
    withLists({ ruleset: r.compiled.ruleset, scope: actorScope({ fields: { wards: null } }) }).wards,
    [],
  );
  assert.deepEqual(withLists({ ruleset: r.compiled.ruleset, scope: actorScope({ fields: { wards: ["a"] } }) }).wards, [
    "a",
  ]);
});
