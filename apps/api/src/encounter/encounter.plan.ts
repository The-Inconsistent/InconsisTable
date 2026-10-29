import {
  firstOf,
  nextFirst,
  sequence,
  type Delta,
  type Phase,
  type Ruleset,
  type RuleState,
} from "@inconsistable/rules-engine";
import { fail } from "../core/errors.ts";
import { runPrimitive } from "../ruleset/ruleset.run.ts";

// What a turn change writes, with no database: the engine's ops run against the state they are handed, so the order
// of a turn change (docs/house-decisions.md #15, #27) and the round arithmetic are unit tested.

const turnDelta = (turn: "round" | "currentId" | "firstId", value: number | string | null): Delta => ({
  target: { turn },
  kind: "set",
  value,
});

/**
 * The deltas of `turn.next`, in the order house decision #15 fixes: `initiative.<strategy>.next`, then
 * `conditions.expire.turnEnd` for the actor whose turn just ended, then `roundEnd` when the round wrapped.
 */
export function planNext({ ruleset, state }: { ruleset: Ruleset; state: RuleState }): Delta[] {
  if (state.turn === null) fail("noEncounterRunning");
  // ponytail: a ruleset that re-rolls initiative each round needs the GM to type new scores mid-wrap; refused until then
  const init = ruleset.initiative;
  if (init.strategy === "ranked" && init.rerollEachRound) fail("rerollUnsupported");
  const ended = state.turn.currentId;
  const run = (primitive: string, op: string, input: unknown) => runPrimitive({ ruleset, state, primitive, op, input });
  const phases = ruleset.phases;
  const at = Math.max(phases?.findIndex((p) => p.id === state.turn?.phaseId) ?? -1, 0);
  const phase = phases?.[at];
  const roundEnd = () => run("conditions.expire", "roundEnd", {});
  const { turn } = state;

  // House decision #37: a simultaneous phase has no turn to end, so `next` moves on at once, without a turnEnd.
  if (phases && phase?.mode === "simultaneous") {
    const following = phases[at + 1];
    if (following) return enter({ phase: following, lead: sequenceOf({ ruleset, turn })[0] ?? null });
    const wrap = roundWrap({ ruleset, turn });
    return [...wrap.deltas, ...enter({ phase: phases[0] ?? phase, lead: wrap.lead }), ...roundEnd()];
  }

  const next = run(`initiative.${init.strategy}`, "next", {});
  const wrapped = next.some((d) => "turn" in d.target && d.target.turn === "round");
  const turnEnd = ended === null ? [] : run("conditions.expire", "turnEnd", { actorId: ended });
  if (!phases || !phase || !wrapped) return [...next, ...turnEnd, ...(wrapped ? roundEnd() : [])];
  const following = phases[at + 1];
  // The phase ran out of turns but the round did not: the next phase starts again from the first player.
  if (following) return [...enter({ phase: following, lead: sequenceOf({ ruleset, turn })[0] ?? null }), ...turnEnd];
  // The last phase wrapped: keep the initiative's round deltas, but the new round opens in the first phase.
  const isCurrent = (d: Delta) => "turn" in d.target && d.target.turn === "currentId";
  const lead = next.find(isCurrent)?.value;
  return [
    ...next.filter((d) => !isCurrent(d)),
    ...enter({ phase: phases[0] ?? phase, lead: typeof lead === "string" ? lead : null }),
    ...turnEnd,
    ...roundEnd(),
  ];
}

const phaseDelta = (turn: "phaseId" | "done" | "currentId", value: string | string[] | null): Delta => ({
  target: { turn },
  kind: "set",
  value,
});

/** The deltas that open `phase`: its id, nobody done, and the first player up unless everyone plays at once. */
function enter({ phase, lead }: { phase: Pick<Phase, "id" | "mode">; lead: string | null }): Delta[] {
  return [
    phaseDelta("phaseId", phase.id),
    phaseDelta("done", []),
    phaseDelta("currentId", phase.mode === "turns" ? lead : null),
  ];
}

type Turn = NonNullable<RuleState["turn"]>;

/** The round's sequence: from the first player for a seated order, the order as ranked otherwise. */
function sequenceOf({ ruleset, turn }: { ruleset: Ruleset; turn: Turn }): string[] {
  return ruleset.initiative.strategy === "seated"
    ? sequence({ order: turn.order, firstId: turn.firstId ?? null })
    : [...turn.order];
}

/**
 * The deltas that begin the next round from a simultaneous last phase, where no initiative `next` ran, and who leads
 * it: the round counts up, and a seated order moves its first player as `initiative.seated` does (`nextFirst`).
 */
function roundWrap({ ruleset, turn }: { ruleset: Ruleset; turn: Turn }): { deltas: Delta[]; lead: string | null } {
  const round = turnDelta("round", turn.round + 1);
  if (ruleset.initiative.strategy !== "seated") return { deltas: [round], lead: turn.order[0] ?? null };
  const { order } = turn;
  const lead = nextFirst({
    params: ruleset.initiative,
    order,
    first: firstOf({ order, firstId: turn.firstId ?? null }),
  });
  return { deltas: [round, turnDelta("firstId", lead)], lead };
}

/**
 * The deltas of `phase.done`: the actor joins `done`; when every combatant of the order is done the phase moves on in
 * the same step, as `turn.next` would.
 */
export function planDone({
  ruleset,
  state,
  actorId,
}: {
  ruleset: Ruleset;
  state: RuleState;
  actorId: string;
}): Delta[] {
  const turn = state.turn ?? fail("noEncounterRunning");
  const phase = ruleset.phases?.find((p) => p.id === turn.phaseId);
  if (phase?.mode !== "simultaneous") fail("notSimultaneous");
  if (!turn.order.includes(actorId)) fail("notInFight");
  if (turn.done?.includes(actorId)) fail("alreadyDone");
  const done = [...(turn.done ?? []), actorId];
  const mark = phaseDelta("done", done);
  if (!turn.order.every((id) => done.includes(id))) return [mark];
  return [mark, ...planNext({ ruleset, state: { ...state, turn: { ...turn, done } } })];
}

/**
 * The deltas of `turn.prev`: the marker steps back one place, and back into the previous round from the top of the
 * order. It only moves the marker; expiries already ticked come back by Undo, which takes the whole step back.
 */
export function planPrev({ ruleset, state }: { ruleset?: Ruleset; state: RuleState }): Delta[] {
  const turn = state.turn ?? fail("noEncounterRunning");
  const { order, currentId, round } = turn;
  // House decision #37: a phase is entered by Undo-able steps only; back stops at its first turn.
  const phase = ruleset?.phases?.find((p) => p.id === turn.phaseId);
  if (ruleset && phase) {
    if (phase.mode === "simultaneous" || currentId === sequenceOf({ ruleset, turn })[0]) fail("phaseStart");
  }
  if (ruleset?.initiative.strategy === "seated") {
    return planPrevSeated({
      order,
      currentId,
      round,
      firstId: turn.firstId ?? null,
      rotate: ruleset.initiative.firstPlayer === "rotate",
    });
  }
  const at = currentId === null ? -1 : order.indexOf(currentId);
  if (at < 0) return fail("nobodyActed");
  const before = order[at - 1];
  if (before !== undefined) return [turnDelta("currentId", before)];
  if (round <= 1) return fail("firstTurn");
  return [turnDelta("round", round - 1), turnDelta("currentId", order[order.length - 1] ?? null)];
}

/** Back through the round's sequence; before its first player, into the previous round (whose first player `rotate` had moved on). */
function planPrevSeated(s: {
  order: readonly string[];
  currentId: string | null;
  round: number;
  firstId: string | null;
  rotate: boolean;
}): Delta[] {
  const { order, currentId, round, firstId, rotate } = s;
  const seq = sequence({ order, firstId });
  const at = currentId === null ? -1 : seq.indexOf(currentId);
  if (at < 0) return fail("nobodyActed");
  const before = seq[at - 1];
  if (before !== undefined) return [turnDelta("currentId", before)];
  if (round <= 1) return fail("firstTurn");
  const first = firstOf({ order, firstId });
  // The previous round began one place back along the order under `rotate`; it ended with the seat just before that.
  const prevFirst = rotate ? order[(order.indexOf(first ?? "") - 1 + order.length) % order.length] : first;
  const last = sequence({ order, firstId: prevFirst ?? null }).at(-1) ?? null;
  return [
    turnDelta("round", round - 1),
    ...(prevFirst === firstId ? [] : [turnDelta("firstId", prevFirst ?? null)]),
    turnDelta("currentId", last),
  ];
}

export interface Ranked {
  id: string;
  initiativeScore: number | null;
  ord: number;
}

/** Highest initiative first, those without one last; a tie keeps the place the GM gave it (`ord`). */
export function rankIds(rows: readonly Ranked[]): string[] {
  return [...rows]
    .sort((a, b) => {
      if (a.initiativeScore !== b.initiativeScore) {
        if (a.initiativeScore === null) return 1;
        if (b.initiativeScore === null) return -1;
        return b.initiativeScore - a.initiativeScore;
      }
      return a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .map((r) => r.id);
}

/** The order after moving one combatant a place, which is allowed only past one with the same initiative (a tie). */
export function movedIds({
  rows,
  id,
  direction,
}: {
  rows: readonly Ranked[];
  id: string;
  direction: "up" | "down";
}): string[] {
  const ids = rankIds(rows);
  const at = ids.indexOf(id);
  const to = direction === "up" ? at - 1 : at + 1;
  const [me, other] = [rows.find((r) => r.id === id), rows.find((r) => r.id === ids[to])];
  if (at < 0 || !me) return fail("combatantNotInFight");
  if (!other) return fail(direction === "up" ? "alreadyFirst" : "alreadyLast");
  if (me.initiativeScore !== other.initiativeScore) fail("sameInitiativeOnly");
  ids[at] = other.id;
  ids[to] = me.id;
  return ids;
}
