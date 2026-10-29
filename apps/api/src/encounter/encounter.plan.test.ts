import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActorState, Delta, Ruleset, RuleState } from "@inconsistable/rules-engine";
import { ActionError } from "../core/errors.ts";
import { movedIds, planNext, planPrev, rankIds } from "./encounter.plan.ts";

// Made-up ids and a made-up ruleset slice: the planner reads only the initiative block.
const ruleset = {
  initiative: { strategy: "ranked", score: "1", tiebreak: [], rerollEachRound: false },
} as unknown as Ruleset;
const rerolling = { initiative: { ...ruleset.initiative, rerollEachRound: true } } as unknown as Ruleset;

const actor = (id: string, conditions: ActorState["conditions"] = []): ActorState => ({
  id,
  fields: {},
  resources: {},
  conditions,
});
const state = ({ currentId, round }: { currentId: string | null; round: number }): RuleState => ({
  actors: {
    a: actor("a", [{ id: "c-turn", conditionId: "staggered", expiresOn: "ownTurnEnd", expiresAfter: 2 }]),
    b: actor("b", [{ id: "c-round", conditionId: "dazed", expiresOn: "roundEnd", expiresAfter: 1 }]),
    c: actor("c"),
  },
  turn: { round, currentId, order: ["a", "b", "c"] },
});
const turnSet = (key: string, value: unknown): Delta => ({ target: { turn: key }, kind: "set", value }) as Delta;

test("turn.next from nobody starts at the top and ticks nothing", () => {
  assert.deepEqual(planNext({ ruleset, state: state({ currentId: null, round: 1 }) }), [turnSet("currentId", "a")]);
});

test("turn.next passes the turn, then ticks only the conditions of whoever just finished", () => {
  assert.deepEqual(planNext({ ruleset, state: state({ currentId: "a", round: 1 }) }), [
    turnSet("currentId", "b"),
    { target: { actorId: "a", condition: "c-turn" }, kind: "add", value: -1 },
  ]);
});

test("turn.next at the end of the order wraps: the round counts up, then the round-end conditions tick", () => {
  assert.deepEqual(planNext({ ruleset, state: state({ currentId: "c", round: 4 }) }), [
    turnSet("round", 5),
    turnSet("currentId", "a"),
    { target: { actorId: "b", condition: "c-round" }, kind: "set", value: null },
  ]);
});

test("turn.next refuses with no encounter, and where initiative is re-rolled each round", () => {
  assert.throws(() => planNext({ ruleset, state: { actors: {}, turn: null } }), ActionError);
  assert.throws(() => planNext({ ruleset: rerolling, state: state({ currentId: "a", round: 1 }) }), /re-rolls/);
});

test("turn.prev steps back, wraps into the previous round from the top, and stops at the first turn", () => {
  assert.deepEqual(planPrev({ state: state({ currentId: "b", round: 2 }) }), [turnSet("currentId", "a")]);
  assert.deepEqual(planPrev({ state: state({ currentId: "a", round: 2 }) }), [
    turnSet("round", 1),
    turnSet("currentId", "c"),
  ]);
  assert.throws(() => planPrev({ state: state({ currentId: "a", round: 1 }) }), /first turn/);
  assert.throws(() => planPrev({ state: state({ currentId: null, round: 1 }) }), /Nobody has acted/);
});

const row = (id: string, initiativeScore: number | null, ord: number) => ({ id, initiativeScore, ord });

test("the order is highest initiative first, none last, ties in the place the GM gave", () => {
  assert.deepEqual(rankIds([row("x", null, 0), row("y", 12, 1), row("z", 15, 2), row("w", 12, 3)]), [
    "z",
    "y",
    "w",
    "x",
  ]);
  assert.deepEqual(rankIds([row("x", 12, 1), row("y", 12, 0)]), ["y", "x"]);
});

test("a tie is settled by moving one place, never past a different initiative", () => {
  const rows = [row("z", 15, 0), row("y", 12, 1), row("w", 12, 2), row("x", null, 3)];
  assert.deepEqual(movedIds({ rows, id: "w", direction: "up" }), ["z", "w", "y", "x"]);
  assert.deepEqual(movedIds({ rows, id: "y", direction: "down" }), ["z", "w", "y", "x"]);
  assert.throws(() => movedIds({ rows, id: "y", direction: "up" }), /same initiative/);
  assert.throws(() => movedIds({ rows, id: "z", direction: "up" }), /Already first/);
  assert.throws(() => movedIds({ rows, id: "x", direction: "down" }), /Already last/);
});

// Seated order (house decision #36): the sequence runs from the first player, and `rotate` moves it each round.
const seated = (firstPlayer: "fixed" | "rotate" | "manual") =>
  ({ initiative: { strategy: "seated", firstPlayer } }) as unknown as Ruleset;
const seatedState = ({ currentId, round, firstId }: { currentId: string | null; round: number; firstId: string }) =>
  ({
    actors: { a: actor("a"), b: actor("b"), c: actor("c") },
    turn: { round, currentId, order: ["a", "b", "c"], firstId },
  }) as RuleState;

test("seated turn.next walks the rotated sequence and wraps with the first player moved", () => {
  const rotate = seated("rotate");
  assert.deepEqual(planNext({ ruleset: rotate, state: seatedState({ currentId: "a", round: 2, firstId: "b" }) }), [
    turnSet("round", 3),
    turnSet("firstId", "c"),
    turnSet("currentId", "c"),
  ]);
  assert.deepEqual(planNext({ ruleset: rotate, state: seatedState({ currentId: "c", round: 2, firstId: "b" }) }), [
    turnSet("currentId", "a"),
  ]);
  const fixed = seated("fixed");
  assert.deepEqual(planNext({ ruleset: fixed, state: seatedState({ currentId: "c", round: 1, firstId: "a" }) }), [
    turnSet("round", 2),
    turnSet("firstId", "a"),
    turnSet("currentId", "a"),
  ]);
});

test("seated turn.prev steps back, and across a rotated round boundary restores the first player", () => {
  const rotate = seated("rotate");
  assert.deepEqual(planPrev({ ruleset: rotate, state: seatedState({ currentId: "c", round: 2, firstId: "b" }) }), [
    turnSet("currentId", "b"),
  ]);
  // Round 3 began with c; round 2 began with b, so it ended with a.
  assert.deepEqual(planPrev({ ruleset: rotate, state: seatedState({ currentId: "c", round: 3, firstId: "c" }) }), [
    turnSet("round", 2),
    turnSet("firstId", "b"),
    turnSet("currentId", "a"),
  ]);
  const fixed = seated("fixed");
  assert.deepEqual(planPrev({ ruleset: fixed, state: seatedState({ currentId: "a", round: 2, firstId: "a" }) }), [
    turnSet("round", 1),
    turnSet("currentId", "c"),
  ]);
  const top = seatedState({ currentId: "a", round: 1, firstId: "a" });
  assert.throws(() => planPrev({ ruleset: rotate, state: top }), /first turn/);
});
