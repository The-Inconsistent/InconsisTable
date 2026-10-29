import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActorState, Delta, Ruleset, RuleState } from "@inconsistable/rules-engine";
import { ActionError } from "../core/errors.ts";
import { movedIds, planDone, planNext, planPrev, rankIds } from "./encounter.plan.ts";

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

// Phases (house decision #37): a round of "plan" (everyone at once) then "act" (in turn), or the other way round.
const phased = ({
  firstPlayer = "rotate",
  modes = ["simultaneous", "turns"],
}: { firstPlayer?: "fixed" | "rotate" | "manual"; modes?: ("simultaneous" | "turns")[] } = {}) =>
  ({
    initiative: { strategy: "seated", firstPlayer },
    phases: [
      { id: "one", label: "One", mode: modes[0] },
      { id: "two", label: "Two", mode: modes[1] },
    ],
  }) as unknown as Ruleset;

/** The turn after the deltas, read the way the database would hold it (turn keys only). */
function applied(s: RuleState, deltas: readonly Delta[]): RuleState {
  const turn = { ...s.turn! } as Record<string, unknown>;
  for (const d of deltas) if ("turn" in d.target) turn[d.target.turn] = d.value;
  return { ...s, turn: turn as unknown as RuleState["turn"] };
}
const where = (s: RuleState) => {
  const t = s.turn!;
  return `${t.round}/${t.phaseId}/${t.currentId}/${t.firstId}/${(t.done ?? []).join("")}`;
};
const start = (round = 1, phaseId = "one", firstId = "a", currentId: string | null = null): RuleState =>
  ({
    ...seatedState({ currentId, round, firstId }),
    turn: { round, currentId, order: ["a", "b", "c"], firstId, phaseId, done: [] },
  }) as RuleState;

test("two phases through two rounds: plan at once, act in turn, the first player rotating", () => {
  const rs = phased();
  let s = start();
  const seen: string[] = [];
  const go = (deltas: Delta[]) => {
    s = applied(s, deltas);
    seen.push(where(s));
    return deltas;
  };
  go(planDone({ ruleset: rs, state: s, actorId: "a" }));
  go(planDone({ ruleset: rs, state: s, actorId: "b" }));
  // The last done moves the phase on in the same step: nobody held a turn, so no turnEnd; the round did not wrap.
  const last = go(planDone({ ruleset: rs, state: s, actorId: "c" }));
  assert.deepEqual(last.slice(1), [turnSet("phaseId", "two"), turnSet("done", []), turnSet("currentId", "a")]);
  go(planNext({ ruleset: rs, state: s }));
  go(planNext({ ruleset: rs, state: s }));
  // c is last in the last phase: the round wraps, first moves to b, and the new round opens in plan (nobody up).
  const wrap = go(planNext({ ruleset: rs, state: s }));
  assert.deepEqual(wrap, [
    turnSet("round", 2),
    turnSet("firstId", "b"),
    turnSet("phaseId", "one"),
    turnSet("done", []),
    turnSet("currentId", null),
  ]);
  go(planDone({ ruleset: rs, state: s, actorId: "c" }));
  // Moving on without waiting (a and b never marked): act starts from the first player b.
  go(planNext({ ruleset: rs, state: s }));
  go(planNext({ ruleset: rs, state: s }));
  go(planNext({ ruleset: rs, state: s }));
  go(planNext({ ruleset: rs, state: s }));
  assert.deepEqual(seen, [
    "1/one/null/a/a",
    "1/one/null/a/ab",
    "1/two/a/a/",
    "1/two/b/a/",
    "1/two/c/a/",
    "2/one/null/b/",
    "2/one/null/b/c",
    "2/two/b/b/",
    "2/two/c/b/",
    "2/two/a/b/",
    "3/one/null/c/",
  ]);
});

test("turnEnd ticks only in a turns phase; roundEnd ticks when the round wraps, from either kind of phase", () => {
  const rs = phased();
  const s = state({ currentId: "a", round: 1 });
  const turnsState = { ...s, turn: { ...s.turn!, firstId: "a", phaseId: "two", done: [] } };
  const mid = planNext({ ruleset: rs, state: turnsState });
  assert.deepEqual(mid.at(-1), { target: { actorId: "a", condition: "c-turn" }, kind: "add", value: -1 });
  const simState = { ...s, turn: { ...s.turn!, currentId: null, firstId: "a", phaseId: "one", done: [] } };
  // Plan is not the last phase: moving on ticks nothing.
  assert.deepEqual(
    planNext({ ruleset: rs, state: simState }).filter((d) => "actorId" in d.target),
    [],
  );
  // A last simultaneous phase wraps the round: roundEnd ticks, turnEnd does not.
  const lastSim = phased({ modes: ["turns", "simultaneous"] });
  const inTwo = { ...simState, turn: { ...simState.turn!, phaseId: "two" } };
  assert.deepEqual(planNext({ ruleset: lastSim, state: inTwo }), [
    turnSet("round", 2),
    turnSet("firstId", "b"),
    turnSet("phaseId", "one"),
    turnSet("done", []),
    turnSet("currentId", "b"),
    { target: { actorId: "b", condition: "c-round" }, kind: "set", value: null },
  ]);
  // The fixed first player stays put.
  const fixed = phased({ firstPlayer: "fixed", modes: ["turns", "simultaneous"] });
  assert.deepEqual(planNext({ ruleset: fixed, state: inTwo }).slice(0, 2), [
    turnSet("round", 2),
    turnSet("firstId", "a"),
  ]);
});

test("a ranked order runs phases too: the sequence is the order", () => {
  const rs = { ...phased(), initiative: ruleset.initiative } as Ruleset;
  const s = state({ currentId: "c", round: 1 });
  const turn = { ...s.turn!, phaseId: "two", done: [] };
  assert.deepEqual(planNext({ ruleset: rs, state: { ...s, turn } }).slice(0, 4), [
    turnSet("round", 2),
    turnSet("phaseId", "one"),
    turnSet("done", []),
    turnSet("currentId", null),
  ]);
});

test("phase.done is refused outside a simultaneous phase, twice, and for someone not in the fight", () => {
  const rs = phased();
  const mid = applied(start(), [turnSet("done", ["a"])]);
  assert.throws(() => planDone({ ruleset: rs, state: mid, actorId: "a" }), /Already done/);
  assert.throws(() => planDone({ ruleset: rs, state: mid, actorId: "zed" }), /isn't in the fight/);
  const act = start(1, "two", "a", "a");
  assert.throws(() => planDone({ ruleset: rs, state: act, actorId: "a" }), /at once/);
});

test("turn.prev stops at the first turn of a phase and anywhere in a simultaneous phase", () => {
  const rs = phased();
  assert.throws(() => planPrev({ ruleset: rs, state: start() }), /Undo to go back a phase/);
  assert.throws(() => planPrev({ ruleset: rs, state: start(2, "two", "b", "b") }), /Undo to go back a phase/);
  assert.deepEqual(planPrev({ ruleset: rs, state: start(2, "two", "b", "c") }), [turnSet("currentId", "b")]);
});

test("a ruleset without phases plans a turn exactly as before", () => {
  const rs = seated("rotate");
  const s = seatedState({ currentId: "c", round: 1, firstId: "a" });
  const turnKeys = planNext({ ruleset: rs, state: s }).flatMap((d) => ("turn" in d.target ? [d.target.turn] : []));
  assert.deepEqual(turnKeys, ["round", "firstId", "currentId"]);
});
