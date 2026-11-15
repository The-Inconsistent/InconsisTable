import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_HARVEST } from "./fixtures/sample-harvest.ts";
import { tableDie, validateRuleset, type RulesetInput } from "./manifest.ts";
import type { Problem } from "./problem.ts";

// Random tables (house decision #49): ranges tile the die, weights stand without one, a rule entry cites its page.

const withTables = (tables: unknown, over: Record<string, unknown> = {}): RulesetInput =>
  ({ ...structuredClone(SAMPLE_D20), ...over, tables }) as RulesetInput;
const problems = (input: unknown): Problem[] => {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems;
};
const table = (die: string | undefined, entries: unknown[], over: Record<string, unknown> = {}) => ({
  t: { title: "T", ...(die === undefined ? {} : { die }), visibility: "party", cite: "Sample p.1", entries, ...over },
});
const keys = (list: Problem[]) => list.map((p) => `${p.path} | ${p.message}`);

test("the harvest sample's tables validate", () => {
  assert.ok(validateRuleset(SAMPLE_HARVEST).ok);
});

test("a die's ranges must tile its outcomes exactly", () => {
  const ok = table("d6", [
    { id: "a", label: "A", range: [1, 3] },
    { id: "b", label: "B", range: [4, 6] },
  ]);
  assert.deepEqual(problems(withTables(ok)), []);

  const gap = table("d6", [
    { id: "a", label: "A", range: [1, 2] },
    { id: "b", label: "B", range: [4, 6] },
  ]);
  assert.deepEqual(keys(problems(withTables(gap))), ["tables.t.entries | no entry for 3"]);

  const overlap = table("d6", [
    { id: "a", label: "A", range: [1, 4] },
    { id: "b", label: "B", range: [4, 6] },
  ]);
  assert.deepEqual(keys(problems(withTables(overlap))), ["tables.t.entries[1].range | overlaps entries[0]"]);

  const outside = table("d6", [
    { id: "a", label: "A", range: [0, 3] },
    { id: "b", label: "B", range: [4, 7] },
  ]);
  assert.deepEqual(keys(problems(withTables(outside))), [
    "tables.t.entries[0].range | outside the die (1 to 6)",
    "tables.t.entries[1].range | outside the die (1 to 6)",
    "tables.t.entries | no entry for 1",
  ]);

  const backwards = table("d6", [{ id: "a", label: "A", range: [6, 1] }]);
  assert.ok(keys(problems(withTables(backwards))).includes("tables.t.entries[0].range | to is below from"));

  const missing = table("d6", [{ id: "a", label: "A" }]);
  assert.ok(
    keys(problems(withTables(missing))).includes(
      "tables.t.entries[0].range | an entry of a table with a die needs a range",
    ),
  );
});

test("2d6 and d66 have their own outcomes", () => {
  assert.deepEqual(tableDie("2d6") && [tableDie("2d6")?.min, tableDie("2d6")?.max], [2, 12]);
  assert.equal(tableDie("d66")?.has(36), true);
  assert.equal(tableDie("d66")?.has(37), false);
  assert.equal(tableDie("d66")?.has(20), false);
  assert.equal(tableDie("2d66"), null);
  assert.equal(tableDie("d6!"), null);
  assert.equal(tableDie("d6+1"), null);
  assert.equal(tableDie("dF"), null);
  assert.equal(tableDie("100d1000"), null);

  const two = table("2d6", [
    { id: "low", label: "Low", range: [2, 6] },
    { id: "high", label: "High", range: [7, 12] },
  ]);
  assert.deepEqual(problems(withTables(two)), []);

  // d66 holds 36 outcomes: the tens-and-units digits 1-6, so 11-16, 21-26 ... 61-66.
  const rows = [1, 2, 3, 4, 5, 6].map((tens) => ({
    id: `r${tens}`,
    label: `R${tens}`,
    range: [tens * 10 + 1, tens * 10 + 6],
  }));
  assert.deepEqual(problems(withTables(table("d66", rows))), []);
  const short = rows.slice(0, 5);
  assert.deepEqual(keys(problems(withTables(table("d66", short)))), ["tables.t.entries | no entry for 61"]);
  const slack = rows.map((r, i) => (i === 5 ? { ...r, range: [61, 70] } : r));
  assert.deepEqual(keys(problems(withTables(table("d66", slack)))), [
    "tables.t.entries[5].range | outside the die (11 to 66)",
    "tables.t.entries | no entry for 61",
  ]);
});

test("a table without a die has weights and no ranges, and bounds hold", () => {
  const weighted = table(undefined, [
    { id: "a", label: "A", weight: 3 },
    { id: "b", label: "B", count: 2 },
  ]);
  assert.deepEqual(problems(withTables(weighted)), []);
  const ranged = table(undefined, [{ id: "a", label: "A", range: [1, 2] }]);
  assert.deepEqual(keys(problems(withTables(ranged))), [
    "tables.t.entries[0].range | a table without a die has no ranges",
  ]);
  const weightOnDie = table("d6", [{ id: "a", label: "A", range: [1, 6], weight: 2 }]);
  assert.deepEqual(keys(problems(withTables(weightOnDie))), [
    "tables.t.entries[0].weight | a table with a die has no weights",
  ]);
  for (const bad of [{ weight: 0 }, { weight: 101 }, { count: 0 }, { count: 21 }, { weight: 1.5 }]) {
    assert.ok(
      problems(withTables(table(undefined, [{ id: "a", label: "A", ...bad }]))).length > 0,
      JSON.stringify(bad),
    );
  }
  assert.deepEqual(keys(problems(withTables(table(undefined, [])))), ["tables.t.entries | a table needs an entry"]);
  const dup = table(undefined, [
    { id: "a", label: "A" },
    { id: "a", label: "B" },
  ]);
  assert.deepEqual(keys(problems(withTables(dup))), ['tables.t.entries[1].id | duplicate id "a"']);
  assert.deepEqual(
    keys(problems(withTables(table("nonsense", [{ id: "a", label: "A", range: [1, 1] }])))).length > 0,
    true,
  );
});

test("a table is a rule entry: it cites its page unless the ruleset is homebrew", () => {
  const entries = [{ id: "a", label: "A" }];
  const noCite = table(undefined, entries, { cite: undefined });
  assert.deepEqual(keys(problems(withTables(noCite))), ["tables.t.cite | a rule entry needs a cite"]);
  const homebrew = { sources: [{ id: "x", title: "X", license: "homebrew" }] };
  assert.deepEqual(keys(problems(withTables(noCite, homebrew))), []);
  assert.deepEqual(problems(withTables(table(undefined, entries), homebrew)), []);
});
