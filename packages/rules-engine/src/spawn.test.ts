import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { deriveValues, applyBaseEffects, type FieldValue } from "./derived.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import { SAMPLE_SKIRMISH_PACK } from "./fixtures/sample-skirmish-pack.ts";
import type { RulesetInput } from "./manifest.ts";
import { isRefusal } from "./primitives/primitive.ts";
import { budgetOf, planSpawn } from "./spawn.ts";

// House decision #92: spawn options, adjustments fixed at spawn and the encounter budget, on the invented fixtures.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(r.ok, JSON.stringify(r.ok ? null : r.problems));
  return r.compiled;
})();
const ruleset = compiled.ruleset;
const body = (key: string) =>
  (SAMPLE_SKIRMISH_PACK.entries.find((e) => e.key === key)?.body ?? {}) as Record<string, FieldValue>;
const room = { campaign: { peril: 2 }, characters: 3, seated: 2 };

test("an option is the ruleset's, for the actor type, and for an entry its when holds for", () => {
  const plan = (key: string, options: string[]) =>
    planSpawn({ ruleset, entity: "creature", values: body(key), options, room, mob: false });
  const no = plan("ash-hound", ["nope"]);
  assert.ok(isRefusal(no) && no.code === "noSuchOption");
  const minion = plan("ash-hound", ["hardened"]);
  assert.ok(
    isRefusal(minion) && minion.code === "optionNotHere" && minion.message === '"Hardened" is not for this entry',
  );
  const other = planSpawn({ ruleset, entity: "character", values: {}, options: ["quick"], room, mob: false });
  assert.ok(isRefusal(other) && other.code === "optionNotHere");
  assert.deepEqual(plan("iron-warden", ["hardened", "quick"]), {
    options: ["hardened", "quick"],
    fields: body("iron-warden"),
    resources: {},
  });
});

test("scaling adds the seated characters and a campaign value once, never to a mob or a minion", () => {
  const plan = (key: string, mob: boolean) =>
    planSpawn({ ruleset, entity: "creature", values: body(key), options: ["scaled"], room, mob });
  assert.deepEqual(plan("iron-warden", false), {
    options: ["scaled"],
    fields: { ...body("iron-warden"), level: 2 + 2 + 2 },
    resources: { spite: 1 },
  });
  assert.deepEqual(plan("iron-warden", true), { options: ["scaled"], fields: body("iron-warden"), resources: {} });
  assert.deepEqual(plan("ash-hound", false), { options: ["scaled"], fields: body("ash-hound"), resources: {} });
  // Without the option nothing is added.
  const plain = planSpawn({ ruleset, entity: "creature", values: body("iron-warden"), options: [], room, mob: false });
  assert.deepEqual(plain, { options: [], fields: body("iron-warden"), resources: {} });
});

test("an option's effects run with the conditions': a Grace the entry does not list lands on the default plus the bonus", () => {
  const derive = (key: string, options: string[]) =>
    applyBaseEffects({ compiled, entity: "creature", values: { fields: body(key), resources: {}, options } });
  assert.equal(derive("iron-warden", ["quick"])["attr.dex"], 12);
  assert.equal(derive("iron-warden", [])["attr.dex"], undefined);
  assert.equal(derive("raid-captain", ["quick"])["attr.dex"], 14);
  assert.equal(derive("raid-captain", ["hardened"]).guard, 14);
  const values = { fields: body("raid-captain"), resources: {}, options: ["hardened", "scaled"] };
  assert.deepEqual(
    deriveValues({ compiled, entity: "creature", values }),
    deriveValues({ compiled, entity: "creature", values: { ...values, options: [] } }),
  );
});

test("the budget reads the picks against the table, a switch doubling each line", () => {
  const picks = [
    { values: body("ash-hound"), count: 3, mob: false },
    { values: body("ash-hound"), count: 6, mob: true },
    { values: body("raid-captain"), count: 1, mob: false },
    { values: {}, count: 2, mob: false },
  ];
  assert.deepEqual(budgetOf({ ruleset, picks, room, switches: [] }), [
    { id: "foes", label: "Foes", used: 3 + 1 + 1 + 2, budget: 2 * 2 + 2 },
    { id: "bosses", label: "Bosses", used: 1, budget: 1 },
  ]);
  assert.deepEqual(
    budgetOf({ ruleset, picks: [], room, switches: ["fortified"] }).map((l) => l.budget),
    [12, 2],
  );
  assert.deepEqual(budgetOf({ ruleset: { spawn: undefined }, picks, room, switches: [] }), []);
});

test("the validator checks options, adjustments and the budget", () => {
  const problems = (spawn: object) => {
    const r = compileRuleset({ ...SAMPLE_SKIRMISH, spawn } as RulesetInput);
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(
    problems({
      options: [
        { id: "x", label: "X", cite: "p.1", entities: ["gear"], when: "level" },
        { id: "x", label: "X", cite: "p.1", effects: [{ path: "nope", mode: "add", value: "1" }] },
      ],
      adjust: [{ option: "y", add: { name: "1", level: "true" }, cite: "p.1" }],
      budget: { lines: [{ id: "a", label: "A", cost: "ctx.nope", budget: "level" }] },
    }),
    [
      'spawn.options[1].id: duplicate id "x"',
      'spawn.options[0].entities[0]: "gear" is not an actor entity',
      'spawn.adjust[0].option: unknown option "y"',
      'spawn.adjust[0].add.name: no spawned actor has an integer "name"',
      "spawn.budget.cite: a rule entry needs a cite",
    ],
  );
  const typed = problems({
    options: [
      { id: "x", label: "X", cite: "p.1", when: "level", effects: [{ path: "nope", mode: "add", value: "1" }] },
    ],
    adjust: [{ add: { level: "ctx.count" }, cite: "p.1" }],
    budget: {
      cite: "p.1",
      lines: [{ id: "a", label: "A", cost: "ctx.budget", budget: "level" }],
      switches: [{ id: "s", label: "S", by: "party.seated > 1" }],
    },
  }).map((p) => p.split(":")[0]);
  assert.deepEqual(typed, [
    "spawn.options[0].effects[0].path",
    "spawn.options[0].when",
    "spawn.adjust[0].add.level",
    "spawn.budget.lines[0].cost",
    "spawn.budget.lines[0].budget",
    "spawn.budget.switches[0].by",
  ]);
});
