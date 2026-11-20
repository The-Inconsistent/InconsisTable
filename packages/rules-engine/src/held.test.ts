import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { actorScope } from "./derived.ts";
import { SAMPLE_HARM, SAMPLE_HARM_GROWTHS } from "./fixtures/sample-harm.ts";
import { heldKeys, planLookup } from "./lookups.ts";
import { validateRuleset, type RulesetInput } from "./manifest.ts";
import { validatePack } from "./pack.ts";

// Records an actor gains in play (house decision #88): a list field of pack entry keys, granted from a lookup line.

const made = compileRuleset(SAMPLE_HARM);
assert.ok(made.ok, JSON.stringify(!made.ok && made.problems));
const compiled = made.compiled;
const hero = (growths: string[]) =>
  actorScope({ fields: { grit: 2, growths }, derived: { limit: 5, strainCap: 2 }, resources: { wounds: 0 } });

test("the modifier counts the records held, and a grant of one held already is marked", () => {
  assert.deepEqual(heldKeys({ compiled, held: "growth", scope: hero(["horn"]) }), ["horn"]);
  const fresh = planLookup({ compiled, tableId: "lesser", result: 23, inputs: {}, scope: hero([]) });
  assert.deepEqual(fresh, {
    ok: true,
    total: 23,
    entry: 0,
    steps: [{ kind: "grant", held: "growth", entry: "horn", has: false }],
  });
  // Holding Horn adds 10: 23 reads 33, still Horn, which is held.
  const again = planLookup({ compiled, tableId: "lesser", result: 23, inputs: {}, scope: hero(["horn"]) });
  assert.ok(again.ok);
  assert.equal(again.total, 33);
  assert.deepEqual(again.steps, [{ kind: "grant", held: "growth", entry: "horn", has: true }]);
  // Two held: 46 reads 66, the open-ended line that sends the GM to the Greater table.
  const worse = planLookup({ compiled, tableId: "lesser", result: 46, inputs: {}, scope: hero(["horn", "wings"]) });
  assert.ok(worse.ok);
  assert.equal(compiled.ruleset.tables?.lesser?.entries[worse.entry]?.next, "greater");
});

const withHeld = (held: unknown, over: Record<string, unknown> = {}): RulesetInput =>
  ({ ...structuredClone(SAMPLE_HARM), layout: undefined, ...over, held }) as RulesetInput;
const keys = (input: unknown): string[] => {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path} | ${p.message}`);
};
const kind = { label: "G", entry: "growth", field: "growths", entities: ["hero"], cite: "Sample p.1" };

test("a held kind names an entry type, actor types, and on each a list field the right people read", () => {
  assert.deepEqual(keys(withHeld({ growth: kind })), []);
  assert.deepEqual(keys(withHeld({ growth: { ...kind, entry: "hero" } })), ['held.growth.entry | "hero" is an actor']);
  assert.deepEqual(keys(withHeld({ growth: { ...kind, entry: "nope" } })), [
    'held.growth.entry | unknown entity "nope"',
  ]);
  assert.deepEqual(keys(withHeld({ growth: { ...kind, entities: ["growth"] } })), [
    'held.growth.entities[0] | unknown actor type "growth"',
  ]);
  assert.deepEqual(keys(withHeld({ growth: { ...kind, field: "scars" } })), [
    'held.growth.field | "scars" is not a list field',
  ]);
  assert.deepEqual(keys(withHeld({ growth: { ...kind, field: "nope" } })), [
    'held.growth.field | hero has no field "nope"',
  ]);
  const party = structuredClone(SAMPLE_HARM);
  const fields = party.entities?.[0]?.fields;
  assert.ok(fields?.growths);
  fields.growths.visibility = "party";
  assert.deepEqual(keys({ ...party }), ["held.growth.field | a field holding unseen records is owner or gm"]);
  const { cite: _cite, ...uncited } = kind;
  assert.deepEqual(keys(withHeld({ growth: uncited })), ["held.growth.cite | a rule entry needs a cite"]);
  const grant = structuredClone(SAMPLE_HARM);
  const line = grant.tables?.greater?.entries[0];
  assert.ok(line);
  line.apply = [{ kind: "grant", held: "nope", entry: "wings" }];
  assert.deepEqual(keys(grant), ['tables.greater.entries[0].apply[0].held | unknown held kind "nope"']);
});

test("an entry of a type a held kind holds may carry effects, checked against the holders", () => {
  const pack = (entries: unknown[]) => ({
    id: "growths",
    version: "0.1.0",
    ruleset: { id: "sample-harm", range: "^0.1.0" },
    license: "private",
    sources: [{ id: "sample", title: "Sample Harm Rules", license: "private" }],
    entries,
  });
  assert.ok(validatePack({ input: pack(SAMPLE_HARM_GROWTHS), ruleset: compiled.ruleset }).ok);
  const bad = [
    { ...SAMPLE_HARM_GROWTHS[0], effects: [{ path: "derived.nope", mode: "add", value: "1", phase: "derived" }] },
  ];
  assert.equal(validatePack({ input: pack(bad), ruleset: compiled.ruleset }).ok, false);
});
