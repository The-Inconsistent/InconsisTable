import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_SKIRMISH } from "../fixtures/sample-skirmish.ts";
import { validateRuleset, type RulesetInput } from "../manifest.ts";
import { sideUp } from "./initiative-sides.ts";
import type { RuleState, TurnState } from "./primitive.ts";
import { applyDeltas, deltas, refusal } from "./test-helpers.ts";

// Invented names throughout: two sides, "red" and "blue", paying from the pools "gold" and "tin".
const sides = [
  { id: "red", label: "Red" },
  { id: "blue", label: "Blue" },
];
const cost = { red: { pool: "gold", amount: 1 }, blue: { pool: "tin", amount: 2 } };
const plain = { strategy: "sides", sides };
const full = {
  ...plain,
  firstSide: "rotate",
  roundEnd: "manual",
  setup: {},
  outOfTurn: { cost },
  hold: {},
  barred: { throughRound: 2, liftCost: cost },
};

const turn = (over: Partial<TurnState> = {}): TurnState => ({
  round: 1,
  currentId: null,
  order: ["r1", "r2", "b1", "b2"],
  sideOf: { r1: "red", r2: "red", b1: "blue", b2: "blue" },
  ...over,
});
const at = (over: Partial<TurnState> = {}, gold = 3, tin = 3): RuleState => ({
  actors: {},
  turn: turn(over),
  pools: { gold: { value: gold, min: 0, max: null }, tin: { value: tin, min: 0, max: null } },
});

const go = (params: unknown, op: string, state: RuleState, input: unknown = {}) =>
  applyDeltas(state, deltas({ primitive: "initiative.sides", op, params, state, input }));
const no = (params: unknown, op: string, state: RuleState, input: unknown = {}) =>
  refusal({ primitive: "initiative.sides", op, params, state, input });
const upNow = (params: unknown, state: RuleState) => sideUp({ params: params as never, state });

test("the side that is up alternates after each turn, and a side with nobody pending is skipped", () => {
  let s = at();
  assert.equal(upNow(plain, s), "red");
  s = go(plain, "pick", s, { id: "r1" });
  s = go(plain, "next", s);
  assert.equal(upNow(plain, s), "blue");
  s = go(plain, "pick", s, { id: "b1" });
  s = go(plain, "next", s);
  assert.equal(upNow(plain, s), "red");
  // blue has nobody left: red goes on.
  s = at({ done: ["b1", "b2"], lastSide: "red" });
  assert.equal(upNow(plain, s), "red");
  // nobody pending at all.
  assert.equal(upNow(plain, at({ done: ["r1", "r2", "b1", "b2"] })), null);
  assert.equal(upNow(plain, at({ unable: ["r1", "r2", "b1", "b2"] })), null);
});

test("the round's first side: fixed keeps the first listed, rotate moves one place each round", () => {
  for (const [round, fixed, rotate] of [
    [1, "red", "red"],
    [2, "red", "blue"],
    [3, "red", "red"],
  ] as const) {
    assert.equal(upNow({ ...plain, firstSide: "fixed" }, at({ round })), fixed);
    assert.equal(upNow({ ...plain, firstSide: "rotate" }, at({ round })), rotate);
  }
});

test("pick: each refusal", () => {
  const p = full;
  const begun = (over: Partial<TurnState> = {}) => at({ begun: true, ...over });
  assert.equal(no(p, "pick", { actors: {}, turn: null }, { id: "r1" }), "noEncounter");
  assert.equal(no(p, "pick", at({ begun: false }), { id: "r1" }), "wrongState");
  assert.equal(no(p, "pick", begun(), { id: "nobody" }), "badInput");
  assert.equal(no(p, "pick", begun({ sideOf: { r1: "red" } }), { id: "r2" }), "badInput");
  assert.equal(no(p, "pick", begun({ unable: ["r1"] }), { id: "r1" }), "wrongState");
  assert.equal(no(p, "pick", begun({ done: ["r1"] }), { id: "r1" }), "wrongState");
  assert.equal(no(p, "pick", begun({ barred: ["r1"] }), { id: "r1" }), "wrongState");
  assert.equal(no(p, "pick", begun({ currentId: "r1" }), { id: "r1" }), "wrongState");
  assert.equal(no(p, "pick", begun(), { id: "b1" }), "wrongState");
  assert.equal(go(p, "pick", begun(), { id: "r1" }).turn?.currentId, "r1");
});

test("pick: force lets an out-of-turn member start; picking while someone acts ends that turn first", () => {
  const forced = go(plain, "pick", at(), { id: "b1", force: true });
  assert.equal(forced.turn?.currentId, "b1");
  assert.equal(forced.turn?.outOfTurnSide ?? null, null);
  const s = go(plain, "pick", at({ currentId: "r1" }), { id: "b1" });
  assert.deepEqual(s.turn?.done, ["r1"]);
  assert.equal(s.turn?.lastSide, "red");
  assert.equal(s.turn?.currentId, "b1");
  // blue was up once red's turn ended, but picking red again is refused.
  assert.equal(no(plain, "pick", at({ currentId: "r1" }), { id: "r2" }), "wrongState");
});

test("seize: once for the side that just acted, again after another side has acted; the charge is in the deltas", () => {
  let s = at({ currentId: "r1" });
  s = go(full, "next", s);
  s = go(full, "pick", s, { id: "b1" });
  s = go(full, "next", s);
  assert.equal(upNow(full, s), "red");
  const list = deltas({ primitive: "initiative.sides", op: "seize", params: full, state: s, input: { id: "b2" } });
  assert.deepEqual(list[0], { target: { pool: "tin" }, kind: "add", value: -2 });
  s = go(full, "seize", s, { id: "b2" });
  assert.equal(s.turn?.currentId, "b2");
  assert.equal(s.turn?.outOfTurnSide, "blue");
  assert.equal(s.pools?.tin?.value, 1);
  s = go(full, "next", s);
  // blue acted out of turn last: it may not do so again until another side has acted.
  assert.equal(no(full, "seize", { ...s, turn: { ...(s.turn as TurnState), done: [] } }, { id: "b1" }), "wrongState");
  s = go(full, "pick", s, { id: "r2" });
  s = go(full, "next", s);
  assert.equal(s.turn?.outOfTurnSide ?? null, null);
});

test("seize: the start of a round, a side that is up anyway, and a pool that cannot pay", () => {
  assert.equal(no(full, "seize", at({ begun: true }), { id: "r1" }), "wrongState");
  assert.equal(go(full, "seize", at({ begun: true }), { id: "b1" }).turn?.currentId, "b1");
  assert.equal(no(full, "seize", at({ begun: true, lastSide: "blue" }), { id: "r1" }), "wrongState");
  const poor = at({ begun: true }, 3, 1);
  assert.equal(no(full, "seize", poor, { id: "b1" }), "cannotPay");
  assert.equal(poor.pools?.tin?.value, 1);
  assert.equal(no(plain, "seize", at(), { id: "b1" }), "wrongState");
});

test("setup: only bar, lift, mark and begin work before begin; begin keeps barred and clears done and held", () => {
  const s = at({ begun: false, done: ["r1"], held: ["b1"], barred: ["b2"], currentId: null, lastSide: "red" });
  for (const op of ["next", "hold", "newRound"]) assert.equal(no(full, op, s), "wrongState");
  assert.equal(no(full, "pick", s, { id: "r2" }), "wrongState");
  assert.equal(no(full, "interrupt", s, { id: "b1" }), "wrongState");
  assert.deepEqual(go(full, "mark", s, { id: "r2", done: true }).turn?.done, ["r1", "r2"]);
  assert.deepEqual(go(full, "bar", s, { id: "r2", barred: true }).turn?.barred, ["b2", "r2"]);
  assert.deepEqual(go(full, "lift", s, { id: "b2" }).turn?.barred, []);
  const begun = go(full, "begin", s);
  assert.deepEqual(
    { ...begun.turn },
    { ...s.turn, begun: true, done: [], held: [], currentId: null, lastSide: null, outOfTurnSide: null },
  );
  assert.equal(no(full, "begin", begun), "wrongState");
  // Without a setup the fight is begun from the start.
  assert.equal(no(plain, "begin", at()), "wrongState");
  assert.equal(go(plain, "pick", at(), { id: "r1" }).turn?.currentId, "r1");
});

test("barred: no turn through throughRound, bar refused past it, lift pays, newRound empties only at the end", () => {
  const s = at({ barred: ["r1"], round: 2 });
  assert.equal(no(full, "pick", s, { id: "r1" }), "wrongState");
  assert.equal(go(full, "pick", at({ barred: ["r1"], round: 3 }), { id: "r1" }).turn?.currentId, "r1");
  assert.equal(no(full, "bar", at({ round: 3 }), { id: "r1", barred: true }), "wrongState");
  assert.equal(no(full, "bar", at({ done: ["r1"] }), { id: "r1", barred: true }), "wrongState");
  assert.equal(no(full, "bar", at({ currentId: "r1" }), { id: "r1", barred: true }), "wrongState");
  assert.equal(no(plain, "bar", at(), { id: "r1", barred: true }), "wrongState");
  assert.equal(no(full, "bar", at(), { id: "nobody", barred: true }), "badInput");
  const lifted = go(full, "lift", s, { id: "r1" });
  assert.deepEqual(lifted.turn?.barred, []);
  assert.equal(lifted.pools?.gold?.value, 2);
  assert.equal(no(full, "lift", at(), { id: "r1" }), "wrongState");
  assert.equal(no(full, "lift", at({ barred: ["r1"] }, 0), { id: "r1" }), "cannotPay");
  assert.deepEqual(go(full, "newRound", at({ barred: ["r1"], round: 1 })).turn?.barred, ["r1"]);
  assert.deepEqual(go(full, "newRound", at({ barred: ["r1"], round: 2 })).turn?.barred, []);
});

test("hold and interrupt; mark gives a second turn", () => {
  let s = go(full, "pick", at(), { id: "r1" });
  s = go(full, "hold", s);
  assert.deepEqual(s.turn?.held, ["r1"]);
  assert.deepEqual(s.turn?.done, ["r1"]);
  assert.equal(no(plain, "hold", at({ currentId: "r1" })), "wrongState");
  assert.equal(no(full, "hold", at()), "wrongState");
  s = go(full, "interrupt", s, { id: "r1" });
  assert.deepEqual(s.turn?.held, []);
  assert.deepEqual(s.turn?.done, ["r1"]);
  assert.equal(no(full, "interrupt", s, { id: "r1" }), "wrongState");
  s = go(full, "mark", at({ done: ["r1"], held: ["r1"] }), { id: "r1", done: false });
  assert.deepEqual(s.turn?.done, []);
  assert.deepEqual(s.turn?.held, []);
  assert.equal(no(full, "mark", at({ currentId: "r1" }), { id: "r1", done: true }), "wrongState");
  assert.equal(no(full, "mark", at(), { id: "nobody", done: true }), "badInput");
});

test("roundEnd: auto wraps on the last next, manual does not; newRound ends a turn in progress", () => {
  const last = at({ done: ["r1", "r2", "b1"], currentId: "b2", lastSide: "red" });
  const auto = go(plain, "next", last);
  assert.deepEqual(
    { ...auto.turn },
    { ...last.turn, round: 2, currentId: null, lastSide: null, outOfTurnSide: null, done: [], held: [] },
  );
  const manual = go({ ...plain, roundEnd: "manual" }, "next", last);
  assert.equal(manual.turn?.round, 1);
  assert.deepEqual(manual.turn?.done, ["r1", "r2", "b1", "b2"]);
  assert.equal(upNow({ ...plain, roundEnd: "manual" }, manual), null);
  const fresh = go(full, "newRound", at({ currentId: "r1", done: ["b1"], held: ["b2"], lastSide: "blue" }));
  assert.equal(fresh.turn?.round, 2);
  assert.equal(fresh.turn?.currentId, null);
  assert.deepEqual(fresh.turn?.done, []);
  assert.deepEqual(fresh.turn?.held, []);
  assert.equal(no(plain, "next", at()), "wrongState");
});

test("a delta for a list key sets the whole list", () => {
  const list = deltas({
    primitive: "initiative.sides",
    op: "mark",
    params: plain,
    state: at({ done: ["r1"] }),
    input: { id: "b1", done: true },
  });
  assert.deepEqual(list, [{ target: { turn: "done" }, kind: "set", value: ["r1", "b1"] }]);
});

// The manifest.

const withInit = (init: object, extra: object = {}): RulesetInput =>
  ({
    ...SAMPLE_SKIRMISH,
    initiative: { ...(SAMPLE_SKIRMISH.initiative as object), ...init },
    ...extra,
  }) as RulesetInput;
const problems = (r: RulesetInput) => {
  const v = validateRuleset(r);
  return v.ok ? [] : v.problems.map((p) => `${p.path}: ${p.message}`);
};

test("the skirmish fixture is a valid ruleset", () => {
  assert.deepEqual(problems(SAMPLE_SKIRMISH), []);
});

test("manifest: sides, costs, phases and cites are checked", () => {
  assert.deepEqual(problems(withInit({ sides: [sides[0], sides[0]] })), [
    'initiative.sides[1].id: duplicate id "red"',
    'initiative.outOfTurn.cost.raiders: unknown side "raiders"',
    'initiative.outOfTurn.cost.wardens: unknown side "wardens"',
    'initiative.barred.liftCost.raiders: unknown side "raiders"',
    'initiative.barred.liftCost.wardens: unknown side "wardens"',
  ]);
  const bad = withInit({
    outOfTurn: {
      cost: { wardens: { pool: "hp", amount: 1 }, raiders: { pool: "nope", amount: 1 } },
      cite: "Sample p.1",
    },
  });
  assert.deepEqual(problems(bad), [
    'initiative.outOfTurn.cost.raiders.pool: unknown resource "nope"',
    'initiative.outOfTurn.cost.wardens.pool: "hp" must be a shared pool',
  ]);
  assert.deepEqual(problems(withInit({}, { phases: [{ id: "a", label: "A", mode: "turns", cite: "Sample p.1" }] })), [
    "phases: sides do not combine with phases yet",
  ]);
  const uncited = withInit({
    cite: undefined,
    setup: {},
    outOfTurn: { cost: { wardens: { pool: "momentum", amount: 1 } } },
    hold: {},
    barred: {},
  });
  assert.deepEqual(problems(uncited), [
    "initiative.cite: a rule entry needs a cite",
    "initiative.setup.cite: a rule entry needs a cite",
    "initiative.outOfTurn.cite: a rule entry needs a cite",
    "initiative.hold.cite: a rule entry needs a cite",
    "initiative.barred.cite: a rule entry needs a cite",
  ]);
  assert.equal(problems(withInit({ sides: [sides[0]] })).length > 0, true);
});
