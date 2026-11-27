import assert from "node:assert/strict";
import { test } from "node:test";

import { breakdownOf } from "./breakdown.ts";
import { compileRuleset } from "./compile.ts";
import { deriveValues } from "./derived.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import type { RulesetInput } from "./manifest.ts";

const HERO = {
  fields: { name: "Ash", level: 3, "attr.str": 14, "attr.dex": 16, "attr.con": 12, guard: 11 },
  resources: { hp: 9, tempHp: 0 },
  party: { characters: 4 },
};

function compile(input: RulesetInput = SAMPLE_D20) {
  const r = compileRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}

test("a derived value breaks down into its base and each condition, adding up to the total", () => {
  const compiled = compile();
  const values = { ...HERO, conditions: ["braced", "dazed"] };
  const total = deriveValues({ compiled, entity: "character", values }).defense ?? 0;
  const lines = breakdownOf({ compiled, entity: "character", derivedId: "defense", values, total });
  assert.deepEqual(
    lines?.map((l) => [l.source, l.cite]),
    [
      ["Defense", "Sample p.4"],
      ["Braced", "Companion p.3"],
      ["Dazed", "Sample p.8"],
    ],
  );
  assert.equal(
    lines?.reduce((s, l) => s + l.amount, 0),
    total,
  );
  assert.equal(lines?.find((l) => l.source === "Braced")?.amount, 2);
  assert.notEqual(lines?.find((l) => l.source === "Dazed")?.amount, 0); // Grace 16 → 14 lowers the modifier
});

test("a source the viewer may not see is folded into the base, not named", () => {
  const input = structuredClone(SAMPLE_D20);
  const character = input.entities[0];
  assert.ok(character);
  character.derived = [
    ...(character.derived ?? []),
    { id: "secretDef", label: "Secret defense", expr: "guard", visibility: "owner" },
  ];
  input.conditions = [
    ...(input.conditions ?? []),
    {
      id: "boon",
      label: "Hidden boon",
      cite: "Sample p.9",
      duration: "manual",
      visibility: "owner",
      effects: [{ path: "derived.secretDef", mode: "add", value: "3", phase: "derived", cite: "Sample p.9" }],
    },
  ];
  const compiled = compile(input);
  const values = { ...HERO, conditions: ["boon"] };
  const total = deriveValues({ compiled, entity: "character", values }).secretDef ?? 0;
  const args = { compiled, entity: "character", derivedId: "secretDef", values, total, actorId: "a1" };

  const owner = breakdownOf({ ...args, viewer: { role: "player", characterIds: ["a1"] } });
  assert.deepEqual(
    owner?.map((l) => [l.source, l.amount]),
    [
      ["Secret defense", 11],
      ["Hidden boon", 3],
    ],
  );

  const other = breakdownOf({ ...args, viewer: { role: "player", characterIds: ["b2"] } });
  assert.deepEqual(
    other?.map((l) => [l.source, l.amount]),
    [["Secret defense", total]],
  );
});

test("an unknown derived value, or one that cannot be worked out, has no breakdown", () => {
  const compiled = compile();
  const values = { ...HERO, fields: { name: "Ash" }, conditions: [] };
  assert.equal(breakdownOf({ compiled, entity: "character", derivedId: "nope", values, total: 1 }), null);
  assert.equal(breakdownOf({ compiled, entity: "character", derivedId: "defense", values, total: 1 }), null);
});

test("a condition that sets an unset field the formula reads is credited with the value, not a null breakdown", () => {
  const input = structuredClone(SAMPLE_D20);
  input.conditions = [
    ...(input.conditions ?? []),
    {
      id: "steeled",
      label: "Steeled",
      cite: "Sample p.9",
      duration: "manual",
      visibility: "party",
      effects: [{ path: "guard", mode: "override", value: "13", phase: "base", cite: "Sample p.9" }],
    },
  ];
  const compiled = compile(input);
  const { guard: _guard, ...fields } = HERO.fields;
  const values = { ...HERO, fields, conditions: ["steeled"] };
  const total = deriveValues({ compiled, entity: "character", values }).defense ?? 0;
  const lines = breakdownOf({ compiled, entity: "character", derivedId: "defense", values, total });
  assert.deepEqual(
    lines?.map((l) => [l.source, l.amount]),
    [
      ["Defense", 0],
      ["Steeled", total],
    ],
  );
});
