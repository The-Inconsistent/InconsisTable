import assert from "node:assert/strict";
import { test } from "node:test";

import { Action } from "./actions.ts";
import { MAX_PREP_LINES, ScenePrep } from "./prep.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const LINES = {
  roster: { id: "r", pack: "sample", key: "ember-wisp", count: 2 },
  tests: { id: "t", testId: "check", inputs: { dc: 12 } },
  pools: { id: "p", pool: "menace", amount: -2 },
  exits: { id: "e", label: "Down", sceneId: ID },
  reveals: { id: "v", entryId: ID },
} as const;

test("every kind of line parses, with its defaults", () => {
  const p = ScenePrep.parse(Object.fromEntries(Object.entries(LINES).map(([k, l]) => [k, [l]])));
  assert.deepEqual(p.roster[0], { ...LINES.roster, visibility: "hidden", temporary: true });
  assert.deepEqual(p.tests[0], {
    ...LINES.tests,
    takers: "party",
    actorIds: [],
    hideTarget: false,
    outcomes: [],
  });
  assert.deepEqual(p.pools[0], { ...LINES.pools, text: "" });
  assert.deepEqual(ScenePrep.parse({}), { roster: [], tests: [], pools: [], exits: [], reveals: [] });
});

test("limits: lines of a kind, an amount of 0, a shared id, an unknown kind, the size", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...LINES.reveals, id: `v${i}` }));
  assert.ok(ScenePrep.safeParse({ reveals: many(MAX_PREP_LINES) }).success);
  assert.ok(!ScenePrep.safeParse({ reveals: many(MAX_PREP_LINES + 1) }).success);
  assert.ok(!ScenePrep.safeParse({ pools: [{ ...LINES.pools, amount: 0 }] }).success);
  assert.ok(!ScenePrep.safeParse({ roster: [LINES.roster], reveals: [{ ...LINES.reveals, id: "r" }] }).success);
  assert.ok(!ScenePrep.safeParse({ hazards: [] }).success);
  const long = (n: number) => ({
    pools: Array.from({ length: 40 }, (_, i) => ({ ...LINES.pools, id: `p${i}`, text: "é".repeat(n) })),
  });
  assert.ok(ScenePrep.safeParse(long(300)).success);
  assert.ok(!ScenePrep.safeParse(long(450)).success);
});

test("codex.save takes prep, null, or nothing", () => {
  for (const prep of [undefined, null, { exits: [LINES.exits] }]) {
    assert.ok(Action.safeParse({ type: "codex.save", id: ID, kind: "scene", prep }).success);
  }
  assert.ok(!Action.safeParse({ type: "codex.save", id: ID, kind: "scene", prep: { exits: [{ id: "e" }] } }).success);
});
