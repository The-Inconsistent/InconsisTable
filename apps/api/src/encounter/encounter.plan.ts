import { firstOf, sequence, type Delta, type Ruleset, type RuleState } from "@inconsistable/rules-engine";
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
  const next = run(`initiative.${init.strategy}`, "next", {});
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
export function planPrev({ ruleset, state }: { ruleset?: Ruleset; state: RuleState }): Delta[] {
  const turn = state.turn ?? fail("noEncounterRunning");
  const { order, currentId, round } = turn;
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
