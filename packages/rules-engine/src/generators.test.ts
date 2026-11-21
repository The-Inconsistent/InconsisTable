import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_HARM } from "./fixtures/sample-harm.ts";
import { checkRun, type GeneratorRun, type ServedLookup } from "./generators.ts";
import type { Ruleset, RulesetInput } from "./manifest.ts";

// Generators (house decision #98) on the invented fixtures: sample-d20's warren, and sample-harm's one-step portent.

const compiled = (input: RulesetInput): Ruleset => {
  const r = compileRuleset(input);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  return r.compiled.ruleset;
};
const d20 = compiled(SAMPLE_D20);
const warren = d20.generators![0]!;
const creatures: Record<string, { name: string; body: Record<string, unknown> }> = {
  wisp: { name: "Ember Wisp", body: { level: 1 } },
  rat: { name: "Rat", body: { level: 0 } },
};
const served: ServedLookup = (entity, key) =>
  entity === "creature" && Object.hasOwn(creatures, key) ? { key, ...creatures[key]! } : undefined;
const run = (over: Partial<GeneratorRun["values"]> = {}, each?: GeneratorRun["each"]): GeneratorRun => ({
  values: { rooms: { value: 2 }, origin: { rows: ["built", "monks"] }, keeper: { key: "rat" }, ...over },
  each: each ?? [{ chamber: { rows: ["pit"] } }, { chamber: { rows: ["roots"] } }],
});

test("a warren run plans the place, its keeper and its chambers (house decision #98)", () => {
  assert.deepEqual(checkRun({ ruleset: d20, generator: warren, run: run(), served }), {
    ok: true,
    root: { title: "Warren of the monks", fields: { keeper: "rat", peril: 2 }, from: null },
    each: [
      { title: "Bone pit", fields: {}, from: null },
      { title: "Root hall", fields: {}, from: null },
    ],
  });
});

test("a run is refused at its first problem, naming the step", () => {
  const refused = (r: GeneratorRun) => {
    const res = checkRun({ ruleset: d20, generator: warren, run: r, served });
    return res.ok ? "ok" : `${res.code} ${JSON.stringify(res.params)}`;
  };
  assert.equal(refused(run({ origin: { rows: ["forged"] } })), 'generateRow {"step":"What made it"}');
  assert.equal(refused(run({ origin: { rows: ["flooded", "monks"] } })), 'generateRow {"step":"What made it"}');
  assert.equal(refused(run({ keeper: { key: "ghost" } })), 'generatePick {"step":"Its keeper"}');
  // A flooded warren's keeper is of level 1 or more.
  assert.equal(refused(run({ origin: { rows: ["flooded"] } })), 'generatePick {"step":"Its keeper"}');
  assert.equal(refused(run({ origin: { rows: ["flooded"] }, keeper: { key: "wisp" } })), "ok");
  assert.equal(refused(run({ rooms: { value: 7 } })), 'generateValue {"step":"Chambers"}');
  assert.equal(refused(run({ rooms: { value: "two" } })), 'generateMissing {"step":"Chambers"}');
  assert.equal(refused(run({}, [{ chamber: { rows: ["pit"] } }])), 'generateCount {"count":2}');
  assert.equal(refused(run({}, [{ chamber: { rows: ["pit"] } }, {}])), 'generateMissing {"step":"Chamber"}');
});

test("the second shape: one roll made into one flat entry", () => {
  const harm = compiled(SAMPLE_HARM);
  const portent = harm.generators![0]!;
  const go = (each: GeneratorRun["each"]) =>
    checkRun({ ruleset: harm, generator: portent, run: { values: { sign: { rows: ["moon"] } }, each }, served });
  assert.deepEqual(go([]), { ok: true, root: { title: "A red moon", fields: {}, from: null }, each: [] });
  assert.deepEqual(go([{}]), { ok: false, code: "generateCount", params: { count: 0 } });
});
