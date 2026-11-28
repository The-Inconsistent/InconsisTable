import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, type RandomTable, type Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { lookupFor, trackTables, usedTables } from "./track-tables.ts";

// Tables of our own invention: one plain, two lookups (a line naming the next; one only for brutes, one GM-only), two a
// generator rolls (one in `each`).
const plain = { title: "Weather", die: "d6", visibility: "party", entries: [{ id: "a", label: "A", range: [1, 6] }] };
const lookup = { ...plain, title: "Crit", entries: [{ id: "a", label: "A", range: [1, 6], next: "weather" }] };
const ruleset = {
  tables: {
    weather: plain,
    crit: lookup,
    maul: { ...lookup, entities: ["brute"] },
    omen: { ...lookup, visibility: "gm" },
    name: plain,
    trinket: plain,
  },
  generators: [
    {
      id: "npc",
      label: "NPC",
      steps: [{ id: "n", label: "N", kind: "roll", table: "name" }],
      each: { times: "1", steps: [{ id: "t", label: "T", kind: "roll", table: "trinket" }] },
    },
  ],
} as unknown as Pick<Ruleset, "tables" | "generators">;
const ids = (list: [string, unknown][]) => list.map(([id]) => id);
const hero = { entity: "hero" };

test("a table a generator rolls is not listed, nor put on the panel (house decision #225)", () => {
  const out = trackTables({ ruleset, panelFor: null, hasGm: true });
  assert.deepEqual(ids(out.listed), ["weather", "crit", "maul", "omen"]);
  assert.deepEqual(ids(out.onPanel), []);
});

test("on a combatant's panel go the lookups that apply to it; the rest stay listed", () => {
  const out = trackTables({ ruleset, panelFor: hero, hasGm: true });
  assert.deepEqual(ids(out.listed), ["weather", "maul"]);
  assert.deepEqual(ids(out.onPanel), ["crit", "omen"]);
  const gmless = trackTables({ ruleset, panelFor: { entity: "brute" }, hasGm: false });
  assert.deepEqual(ids(gmless.listed), ["weather", "omen"]);
  assert.deepEqual(ids(gmless.onPanel), ["crit", "maul"]);
  assert.deepEqual(ids(trackTables({ ruleset, panelFor: { entity: "" }, hasGm: true }).onPanel), []);
});

test("a lookup applies to an actor with a type it names, never a plain table", () => {
  const tables = ruleset.tables as Record<string, RandomTable>;
  assert.equal(lookupFor({ table: tables.crit!, actor: hero, hasGm: false }), true);
  assert.equal(lookupFor({ table: tables.maul!, actor: hero, hasGm: true }), false);
  assert.equal(lookupFor({ table: tables.omen!, actor: hero, hasGm: false }), false);
  assert.equal(lookupFor({ table: tables.weather!, actor: hero, hasGm: true }), false);
});

test("a table a generator's table leads on to through next, at any depth, is used there too", () => {
  const relic = { ...plain, title: "Form", entries: [{ id: "a", label: "A", range: [1, 6], next: "power" }] };
  const power = { ...plain, title: "Power", entries: [{ id: "a", label: "A", range: [1, 6], next: "minor" }] };
  const chained = {
    tables: { relic, power, minor: plain, loose: plain },
    generators: [{ id: "g", label: "G", steps: [{ id: "r", label: "R", kind: "roll", table: "relic" }] }],
  } as unknown as Pick<Ruleset, "tables" | "generators">;
  assert.deepEqual([...usedTables(chained)].sort(), ["minor", "power", "relic"]);
  assert.deepEqual(ids(trackTables({ ruleset: chained, panelFor: null, hasGm: true }).listed), ["loose"]);
});

test("the tables a codex kind rolls into a field or its title are not listed (sample-d20)", () => {
  const made = compileRuleset(SAMPLE_D20);
  assert.ok(made.ok);
  const d20 = made.compiled.ruleset;
  const out = trackTables({ ruleset: d20, panelFor: null, hasGm: true });
  assert.deepEqual(ids(out.listed), ["hazards"]);
  for (const id of ["forename", "surname", "hue", "scar", "elfname"]) assert.ok(usedTables(d20).has(id), id);
});

test("a lookup that reads someone stays on TRACK even when a generator rolls it; one that only leads on does not", () => {
  const rolled = {
    ...ruleset,
    tables: { ...ruleset.tables, crit: { ...lookup, modifier: "1" } },
    generators: [
      {
        id: "g",
        label: "G",
        steps: [
          { id: "c", label: "C", kind: "roll", table: "crit" },
          { id: "o", label: "O", kind: "roll", table: "omen" },
        ],
      },
    ],
  };
  const out = trackTables({ ruleset: rolled as unknown as typeof ruleset, panelFor: hero, hasGm: true });
  assert.deepEqual(ids(out.onPanel), ["crit"]);
  // weather is crit's next; name and trinket are no generator's here.
  assert.deepEqual(ids(out.listed), ["maul", "name", "trinket"]);
});

test("nothing to list when every table is a generator's or there are none", () => {
  const only = { ...ruleset, tables: { name: plain } } as typeof ruleset;
  assert.deepEqual(trackTables({ ruleset: only, panelFor: null, hasGm: true }), { listed: [], onPanel: [] });
  assert.deepEqual(trackTables({ ruleset: {}, panelFor: hero, hasGm: true }), { listed: [], onPanel: [] });
});
