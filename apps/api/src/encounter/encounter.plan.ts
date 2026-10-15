import type { Delta, Ruleset, RuleState } from "@inconsistable/rules-engine";
import { fail } from "../core/errors.ts";
import { runPrimitive } from "../ruleset/ruleset.run.ts";

// What a turn change writes, with no database: the engine's ops run against the state they are handed, so the order
// of a turn change (docs/house-decisions.md #15, #27) and the round arithmetic are unit tested.

const turnDelta = (turn: "round" | "currentId", value: number | string | null): Delta => ({
  target: { turn },
  kind: "set",
  value,
});

/**
 * The deltas of `turn.next`, in the order house decision #15 fixes: `initiative.ranked.next`, then
 * `conditions.expire.turnEnd` for the actor whose turn just ended, then `roundEnd` when the round wrapped.
 */
export function planNext({ ruleset, state }: { ruleset: Ruleset; state: RuleState }): Delta[] {
  if (state.turn === null) fail("noEncounterRunning");
  // ponytail: a ruleset that re-rolls initiative each round needs the GM to type new scores mid-wrap; refused until then
  if (ruleset.initiative.rerollEachRound) fail("rerollUnsupported");
  const ended = state.turn.currentId;
  const run = (primitive: string, op: string, input: unknown) => runPrimitive({ ruleset, state, primitive, op, input });
  const next = run("initiative.ranked", "next", {});
  const wrapped = next.some((d) => "turn" in d.target && d.target.turn === "round");
  return [
    ...next,
    ...(ended === null ? [] : run("conditions.expire", "turnEnd", { actorId: ended })),
    ...(wrapped ? run("conditions.expire", "roundEnd", {}) : []),
  ];
}

/**
 * The deltas of `turn.prev`: the marker steps back one place, and back into the previous round from the top of the
 * order. It only moves the marker; expiries already ticked come back by Undo, which takes the whole step back.
 */
export function planPrev({ state }: { state: RuleState }): Delta[] {
  const turn = state.turn ?? fail("noEncounterRunning");
  const { order, currentId, round } = turn;
  const at = currentId === null ? -1 : order.indexOf(currentId);
  if (at < 0) return fail("nobodyActed");
  const before = order[at - 1];
  if (before !== undefined) return [turnDelta("currentId", before)];
  if (round <= 1) return fail("firstTurn");
  return [turnDelta("round", round - 1), turnDelta("currentId", order[order.length - 1] ?? null)];
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
