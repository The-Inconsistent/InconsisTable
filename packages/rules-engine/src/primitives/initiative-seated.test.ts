import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_HARVEST } from "../fixtures/sample-harvest.ts";
import { validateRuleset } from "../manifest.ts";
import type { RuleState, TurnState } from "./primitive.ts";
import { applyDeltas, deltas, refusal } from "./test-helpers.ts";

const rotate = { strategy: "seated", firstPlayer: "rotate" };
const fixed = { strategy: "seated", firstPlayer: "fixed" };
const manual = { strategy: "seated", firstPlayer: "manual" };

const at = (turn: TurnState): RuleState => ({ actors: {}, turn });
const run = ({ op, params, state, input = {} }: { op: string; params: unknown; state: RuleState; input?: unknown }) =>
  applyDeltas(state, deltas({ primitive: "initiative.seated", op, params, state, input }));
const refused = ({
  op,
  params,
  state,
  input = {},
}: {
  op: string;
  params: unknown;
  state: RuleState;
  input?: unknown;
}) => refusal({ primitive: "initiative.seated", op, params, state, input });

const started = (params: unknown) =>
  run({ op: "start", params, state: { actors: {}, turn: null }, input: { ids: ["a", "b", "c"] } });

test("seated start: the seat order as given, round 1, the top seat first and acting", () => {
  assert.deepEqual(started(rotate).turn, { round: 1, currentId: "a", order: ["a", "b", "c"], firstId: "a" });
  assert.equal(
    refused({ op: "start", params: rotate, state: { actors: {}, turn: null }, input: { ids: ["a", "a"] } }),
    "badInput",
  );
});

test("seated next with rotate: the first player moves one place each round, over three rounds", () => {
  let s = started(rotate);
  const seen: [number, string | null, string | null][] = [];
  for (let i = 0; i < 9; i++) {
    s = run({ op: "next", params: rotate, state: s });
    seen.push([s.turn!.round, s.turn!.firstId ?? null, s.turn!.currentId]);
  }
  assert.deepEqual(seen, [
    [1, "a", "b"],
    [1, "a", "c"],
    [2, "b", "b"],
    [2, "b", "c"],
    [2, "b", "a"],
    [3, "c", "c"],
    [3, "c", "a"],
    [3, "c", "b"],
    [4, "a", "a"],
  ]);
});

test("seated next with fixed: every round starts at the first seat", () => {
  let s = started(fixed);
  const seen: [number, string | null, string | null][] = [];
  for (let i = 0; i < 6; i++) {
    s = run({ op: "next", params: fixed, state: s });
    seen.push([s.turn!.round, s.turn!.firstId ?? null, s.turn!.currentId]);
  }
  assert.deepEqual(seen, [
    [1, "a", "b"],
    [1, "a", "c"],
    [2, "a", "a"],
    [2, "a", "b"],
    [2, "a", "c"],
    [3, "a", "a"],
  ]);
});

test("seated next from nobody starts at the first player", () => {
  const s = run({
    op: "next",
    params: rotate,
    state: at({ round: 1, currentId: null, order: ["a", "b"], firstId: null }),
  });
  assert.deepEqual(s.turn, { round: 1, currentId: "a", order: ["a", "b"], firstId: "a" });
});

test("seated remove: the first player leaves, first passes to the next seat", () => {
  const state = at({ round: 2, currentId: "c", order: ["a", "b", "c"], firstId: "a" });
  assert.deepEqual(run({ op: "remove", params: rotate, state, input: { id: "a" } }).turn, {
    round: 2,
    currentId: "c",
    order: ["b", "c"],
    firstId: "b",
  });
  // The last seat leaving while first: first wraps to the top.
  const lastFirst = at({ round: 2, currentId: "b", order: ["a", "b", "c"], firstId: "c" });
  assert.equal(run({ op: "remove", params: rotate, state: lastFirst, input: { id: "c" } }).turn?.firstId, "a");
});

test("seated remove: the acting seat leaves", () => {
  // Mid-sequence: the turn passes to the next in the round's sequence.
  const mid = at({ round: 1, currentId: "a", order: ["a", "b", "c"], firstId: "a" });
  assert.equal(run({ op: "remove", params: rotate, state: mid, input: { id: "a" } }).turn?.currentId, "b");
  // Last in the sequence (first is b, so c's turn is the end of the round): the round wraps and rotate applies.
  const last = at({ round: 2, currentId: "a", order: ["a", "b", "c"], firstId: "b" });
  assert.deepEqual(run({ op: "remove", params: rotate, state: last, input: { id: "a" } }).turn, {
    round: 3,
    currentId: "c",
    order: ["b", "c"],
    firstId: "c",
  });
  assert.deepEqual(run({ op: "remove", params: fixed, state: last, input: { id: "a" } }).turn, {
    round: 3,
    currentId: "b",
    order: ["b", "c"],
    firstId: "b",
  });
});

test("seated remove: the last seat leaving empties the order", () => {
  const alone = at({ round: 1, currentId: "a", order: ["a"], firstId: "a" });
  assert.deepEqual(run({ op: "remove", params: rotate, state: alone, input: { id: "a" } }).turn, {
    round: 1,
    currentId: null,
    order: [],
    firstId: null,
  });
  assert.equal(refused({ op: "remove", params: rotate, state: alone, input: { id: "zz" } }), "badInput");
});

test("seated first: only when set by hand, and only for a seat in the order", () => {
  const state = at({ round: 1, currentId: "a", order: ["a", "b"], firstId: "a" });
  assert.deepEqual(run({ op: "first", params: manual, state, input: { id: "b" } }).turn, {
    round: 1,
    currentId: "a",
    order: ["a", "b"],
    firstId: "b",
  });
  assert.equal(refused({ op: "first", params: rotate, state, input: { id: "b" } }), "wrongState");
  assert.equal(refused({ op: "first", params: manual, state, input: { id: "zz" } }), "badInput");
});

test("sample-harvest validates; a seated order without a cite is refused outside a homebrew ruleset", () => {
  const ok = validateRuleset(SAMPLE_HARVEST);
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.problems));
  const m = structuredClone(SAMPLE_HARVEST);
  m.sources = [{ id: "sample", title: "Sample", license: "private", pageOffset: 0 }];
  delete m.initiative?.cite;
  const r = validateRuleset(m);
  assert.ok(!r.ok && r.problems.some((p) => p.path === "initiative.cite"));
});
