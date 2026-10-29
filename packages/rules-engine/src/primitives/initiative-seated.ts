import { z } from "zod";

import { SeatedInitiative } from "../manifest.ts";
import { defineOp, refuse, type Delta, type Primitive, type RuleState, type TargetPattern } from "./primitive.ts";

// House decision #36: the order is the seat order, kept as given; only the first player of each round moves.

export const StartInput = z.object({
  /** The seats in play order, as the table sat down. */
  ids: z.array(z.string().min(1)).min(1).max(200),
});
export type StartInput = z.infer<typeof StartInput>;

export const NextInput = z.strictObject({});
export type NextInput = z.infer<typeof NextInput>;

export const RemoveInput = z.object({ id: z.string().min(1) });
export type RemoveInput = z.infer<typeof RemoveInput>;

export const FirstInput = z.object({ id: z.string().min(1) });
export type FirstInput = z.infer<typeof FirstInput>;

const TURN_TARGETS: TargetPattern[] = [
  { turn: "round" },
  { turn: "order" },
  { turn: "currentId" },
  { turn: "firstId" },
];

const set = (turn: "round" | "currentId" | "firstId" | "order", value: unknown): Delta => ({
  target: { turn },
  kind: "set",
  value: value as Delta["value"],
});

/** Where the round starts: `firstId` if it sits in the order, else the top seat. */
export const firstOf = ({ order, firstId }: { order: readonly string[]; firstId: string | null }) =>
  firstId !== null && order.includes(firstId) ? firstId : (order[0] ?? null);

/** The round's sequence: the order read round the table from the first player. */
export function sequence({ order, firstId }: { order: readonly string[]; firstId: string | null }): string[] {
  const at = order.indexOf(firstOf({ order, firstId }) ?? "");
  return at <= 0 ? [...order] : [...order.slice(at), ...order.slice(0, at)];
}

/** The seat after `id` along the order, wrapping. */
const after = ({ order, id }: { order: readonly string[]; id: string }) =>
  order[(order.indexOf(id) + 1) % order.length] ?? null;

/** Who leads the round after `first` under `params`: `rotate` moves one place along the order. */
export const nextFirst = ({
  params,
  order,
  first,
}: {
  params: SeatedInitiative;
  order: readonly string[];
  first: string | null;
}) => (params.firstPlayer === "rotate" && first !== null ? after({ order, id: first }) : first);

/** The deltas that begin the next round from `order`/`first`; `rotate` moves the first player one place. */
function wrap({
  params,
  round,
  order,
  first,
}: {
  params: SeatedInitiative;
  round: number;
  order: readonly string[];
  first: string | null;
}): Delta[] {
  const lead = nextFirst({ params, order, first });
  return [set("round", round + 1), set("firstId", lead), set("currentId", lead)];
}

function needTurn(state: RuleState) {
  return state.turn === null ? refuse("noEncounter", "no seat order is running") : null;
}

export const initiativeSeated: Primitive<SeatedInitiative> = {
  id: "initiative.seated",
  params: SeatedInitiative,
  ops: {
    start: defineOp<SeatedInitiative, StartInput>({
      input: StartInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => TURN_TARGETS,
      validate: ({ input }) =>
        new Set(input.ids).size === input.ids.length ? null : refuse("badInput", "a seat is listed twice"),
      apply: ({ input }) => [
        set("order", input.ids),
        set("round", 1),
        set("firstId", input.ids[0]),
        set("currentId", input.ids[0]),
      ],
    }),
    next: defineOp<SeatedInitiative, NextInput>({
      input: NextInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => TURN_TARGETS,
      validate: ({ ctx: { state } }) => {
        const none = needTurn(state);
        if (none !== null) return none;
        return state.turn?.order.length === 0 ? refuse("wrongState", "the order is empty: start the game first") : null;
      },
      apply: ({ ctx: { params, state } }) => {
        if (state.turn === null) return [];
        const { order, currentId, round } = state.turn;
        const firstId = state.turn.firstId ?? null;
        const seq = sequence({ order, firstId });
        const at = currentId === null ? -1 : seq.indexOf(currentId);
        // Nobody acting yet or a stale id: the round starts at the first player.
        if (at < 0)
          return [...(seq[0] === firstId ? [] : [set("firstId", seq[0] ?? null)]), set("currentId", seq[0] ?? null)];
        const following = seq[at + 1];
        if (following !== undefined) return [set("currentId", following)];
        return wrap({ params, round, order, first: firstOf({ order, firstId }) });
      },
    }),
    remove: defineOp<SeatedInitiative, RemoveInput>({
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
        const firstId = state.turn.firstId ?? null;
        const seq = sequence({ order, firstId });
        const rest = order.filter((id) => id !== input.id);
        const deltas: Delta[] = [set("order", rest)];
        if (rest.length === 0) return [...deltas, set("firstId", null), set("currentId", null)];
        // The first player left: first passes to the one after them in the order.
        const first = firstOf({ order, firstId });
        const newFirst = input.id === first ? after({ order, id: input.id }) : first;
        if (newFirst !== firstId) deltas.push(set("firstId", newFirst));
        if (input.id !== currentId) return deltas;
        // The one acting left: the turn passes along the round's sequence, or the round wraps as `next` does.
        const following = seq[seq.indexOf(input.id) + 1];
        if (following !== undefined) return [...deltas, set("currentId", following)];
        const wrapped = wrap({ params, round, order: rest, first: newFirst });
        return [...deltas.filter((d) => !("turn" in d.target && d.target.turn === "firstId")), ...wrapped];
      },
    }),
    first: defineOp<SeatedInitiative, FirstInput>({
      input: FirstInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [{ turn: "firstId" }],
      validate: ({ ctx: { params, state }, input }) => {
        const none = needTurn(state);
        if (none !== null) return none;
        if (params.firstPlayer !== "manual")
          return refuse("wrongState", "this ruleset does not set the first player by hand");
        return state.turn?.order.includes(input.id) === true
          ? null
          : refuse("badInput", `"${input.id}" is not in the order`);
      },
      apply: ({ input }) => [set("firstId", input.id)],
    }),
  },
};
