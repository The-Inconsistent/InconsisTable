import { z } from "zod";

import { RankedInitiative } from "../manifest.ts";
import { defineOp, refuse, type Delta, type Primitive, type RuleState, type TargetPattern } from "./primitive.ts";

export const RankedCombatant = z.object({
  id: z.string().min(1),
  /** The evaluated `score` expression plus the reported or rolled `dice`. */
  score: z.int(),
  /** The evaluated `tiebreak` expressions, in manifest order. */
  tiebreaks: z.array(z.int()).max(5).default([]),
});
export type RankedCombatant = z.infer<typeof RankedCombatant>;

export const StartInput = z.object({
  combatants: z.array(RankedCombatant).min(1).max(200),
  /** A later round when `rerollEachRound` re-ranks the same fight. */
  round: z.int().min(1).default(1),
});
export type StartInput = z.infer<typeof StartInput>;

export const NextInput = z.strictObject({});
export type NextInput = z.infer<typeof NextInput>;

export const RemoveInput = z.object({ id: z.string().min(1) });
export type RemoveInput = z.infer<typeof RemoveInput>;

/**
 * Highest score first, then each tiebreak highest first. A tie left after that is broken by id (code-unit order, not
 * locale order) so every server and phone gets the same order; a ruleset that lets the GM settle ties lists a
 * tiebreak instead.
 */
export function rankOrder(combatants: readonly RankedCombatant[]): string[] {
  return [...combatants]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const n = Math.max(a.tiebreaks.length, b.tiebreaks.length);
      for (let i = 0; i < n; i++) {
        const d = (b.tiebreaks[i] ?? 0) - (a.tiebreaks[i] ?? 0);
        if (d !== 0) return d;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((c) => c.id);
}

const TURN_TARGETS: TargetPattern[] = [{ turn: "round" }, { turn: "order" }, { turn: "currentId" }];

/** The deltas that start the next round: same order, or an empty one to re-rank when the manifest rerolls. */
function wrap({
  params,
  round,
  order,
}: {
  params: RankedInitiative;
  round: number;
  order: readonly string[];
}): Delta[] {
  const deltas: Delta[] = [{ target: { turn: "round" }, kind: "set", value: round + 1 }];
  if (params.rerollEachRound || order.length === 0) {
    deltas.push({ target: { turn: "order" }, kind: "set", value: [] });
    deltas.push({ target: { turn: "currentId" }, kind: "set", value: null });
  } else {
    deltas.push({ target: { turn: "currentId" }, kind: "set", value: order[0] ?? null });
  }
  return deltas;
}

function needTurn(state: RuleState) {
  return state.turn === null ? refuse("noEncounter", "no initiative order is running") : null;
}

export const initiativeRanked: Primitive<RankedInitiative> = {
  id: "initiative.ranked",
  params: RankedInitiative,
  ops: {
    start: defineOp<RankedInitiative, StartInput>({
      input: StartInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => TURN_TARGETS,
      validate: ({ ctx: { params }, input }) => {
        const ids = new Set(input.combatants.map((c) => c.id));
        if (ids.size !== input.combatants.length) return refuse("badInput", "a combatant is listed twice");
        if (input.combatants.some((c) => c.tiebreaks.length !== params.tiebreak.length)) {
          return refuse("badInput", `each combatant needs ${params.tiebreak.length} tiebreak value(s)`);
        }
        return null;
      },
      apply: ({ input }) => {
        const order = rankOrder(input.combatants);
        return [
          { target: { turn: "order" }, kind: "set", value: order },
          { target: { turn: "round" }, kind: "set", value: input.round },
          { target: { turn: "currentId" }, kind: "set", value: order[0] ?? null },
        ];
      },
    }),
    next: defineOp<RankedInitiative, NextInput>({
      input: NextInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => TURN_TARGETS,
      validate: ({ ctx: { state } }) => {
        const none = needTurn(state);
        if (none !== null) return none;
        return state.turn?.order.length === 0
          ? refuse("wrongState", "the order is empty: start the round first")
          : null;
      },
      apply: ({ ctx: { params, state } }) => {
        if (state.turn === null) return [];
        const { order, currentId, round } = state.turn;
        const at = currentId === null ? -1 : order.indexOf(currentId);
        // Nobody acting yet (a fresh re-rank) or a stale id: the round starts at the top.
        if (at < 0) return [{ target: { turn: "currentId" }, kind: "set", value: order[0] ?? null }];
        const following = order[at + 1];
        if (following !== undefined) return [{ target: { turn: "currentId" }, kind: "set", value: following }];
        return wrap({ params, round, order });
      },
    }),
    remove: defineOp<RankedInitiative, RemoveInput>({
      input: RemoveInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => TURN_TARGETS,
      validate: ({ ctx: { state }, input }) => {
        const none = needTurn(state);
        if (none !== null) return none;
        return state.turn?.order.includes(input.id) === true
          ? null
          : refuse("badInput", `"${input.id}" is not in the order`);
      },
      apply: ({ ctx: { params, state }, input }) => {
        if (state.turn === null) return [];
        const { order, currentId, round } = state.turn;
        const rest = order.filter((id) => id !== input.id);
        const deltas: Delta[] = [{ target: { turn: "order" }, kind: "set", value: rest }];
        if (input.id !== currentId) return deltas;
        // The one acting left: the turn passes to whoever came after them, or the round ends.
        const following = order[order.indexOf(input.id) + 1];
        if (following !== undefined) {
          deltas.push({ target: { turn: "currentId" }, kind: "set", value: following });
          return deltas;
        }
        if (rest.length === 0) {
          deltas.push({ target: { turn: "currentId" }, kind: "set", value: null });
          return deltas;
        }
        // A re-ranking wrap clears the order itself; otherwise the trimmed order carries into the next round.
        const next = wrap({ params, round, order: rest });
        return next.some((d) => "turn" in d.target && d.target.turn === "order") ? next : [...deltas, ...next];
      },
    }),
  },
};
