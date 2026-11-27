import assert from "node:assert/strict";
import { test } from "node:test";

import type { RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { lookupFor, trackTables } from "./track-tables.ts";

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

test("nothing to list when every table is a generator's or there are none", () => {
  const only = { ...ruleset, tables: { name: plain } } as typeof ruleset;
  assert.deepEqual(trackTables({ ruleset: only, panelFor: null, hasGm: true }), { listed: [], onPanel: [] });
  assert.deepEqual(trackTables({ ruleset: {}, panelFor: hero, hasGm: true }), { listed: [], onPanel: [] });
});
