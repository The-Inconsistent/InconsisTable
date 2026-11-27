import assert from "node:assert/strict";
import { test } from "node:test";

import type { Ruleset } from "@inconsistable/rules-engine";

import { trackTables } from "./track-tables.ts";

// Tables of our own invention: one plain, one a lookup (a line with an effect), two a generator rolls (one in `each`).
const plain = { title: "Weather", die: "d6", visibility: "party", entries: [{ id: "a", label: "A", range: [1, 6] }] };
const lookup = { ...plain, title: "Crit", entries: [{ id: "a", label: "A", range: [1, 6], next: "weather" }] };
const ruleset = {
  tables: { weather: plain, crit: lookup, name: plain, trinket: plain },
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

test("a table a generator rolls is not listed, nor put on the panel (house decision #225)", () => {
  const out = trackTables({ ruleset, fight: false });
  assert.deepEqual(ids(out.listed), ["weather", "crit"]);
  assert.deepEqual(ids(out.onPanel), []);
});

test("in a fight a lookup leaves the list for the combatant's panel", () => {
  const out = trackTables({ ruleset, fight: true });
  assert.deepEqual(ids(out.listed), ["weather"]);
  assert.deepEqual(ids(out.onPanel), ["crit"]);
});

test("nothing to list when every table is a generator's or there are none", () => {
  assert.deepEqual(trackTables({ ruleset: { ...ruleset, tables: { name: plain } } as typeof ruleset, fight: false }), {
    listed: [],
    onPanel: [],
  });
  assert.deepEqual(trackTables({ ruleset: {}, fight: true }), { listed: [], onPanel: [] });
});
