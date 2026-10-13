import { z } from "zod";

import type { ConditionDuration } from "../enums.ts";
import {
  defineOp,
  refuse,
  type ActorState,
  type ConditionState,
  type Delta,
  type Primitive,
  type RuleState,
} from "./primitive.ts";

/** Durations are on each condition row, so the primitive takes no params. */
export const ConditionsExpireParams = z.strictObject({});
export type ConditionsExpireParams = z.infer<typeof ConditionsExpireParams>;

export const TurnEndInput = z.object({
  /** The actor whose turn just ended. */
  actorId: z.string().min(1),
});
export type TurnEndInput = z.infer<typeof TurnEndInput>;

export const EmptyInput = z.strictObject({});
export type EmptyInput = z.infer<typeof EmptyInput>;

/**
 * Holders in a stable order: those in the initiative order first, as the table acts, then the rest by id. Every
 * seat and every server gets the same delta order.
 */
function holders(state: RuleState): ActorState[] {
  const inOrder = state.turn?.order ?? [];
  const first = inOrder.flatMap((id) => (Object.hasOwn(state.actors, id) ? [state.actors[id]] : []));
  const seen = new Set(inOrder);
  const rest = Object.values(state.actors)
    .filter((a) => !seen.has(a.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...first, ...rest].flatMap((a) => (a === undefined ? [] : [a]));
}

function remove({ actorId, row }: { actorId: string; row: ConditionState }): Delta {
  return { target: { actorId, condition: row.id }, kind: "set", value: null };
}

/** One tick of a counted expiry: the last tick removes the row, any other counts down. */
function tick({ actorId, row }: { actorId: string; row: ConditionState }): Delta {
  // An uncounted row (expiresAfter null) is one tick from the end (house decision #14).
  return (row.expiresAfter ?? 1) <= 1
    ? remove({ actorId, row })
    : { target: { actorId, condition: row.id }, kind: "add", value: -1 };
}

function expire({
  actors,
  on,
  counted,
}: {
  actors: readonly ActorState[];
  on: ConditionDuration;
  counted: boolean;
}): Delta[] {
  return actors.flatMap((a) =>
    (a.conditions ?? [])
      .filter((row) => row.expiresOn === on)
      .map((row) => (counted ? tick({ actorId: a.id, row }) : remove({ actorId: a.id, row }))),
  );
}

// ponytail: a condition counts down on its holder's own turns; "until the end of the caster's next turn" needs the
// applier on the row, an upgrade once a ruleset in scope needs it. The order of ops at a turn change is the caller's
// (docs/house-decisions.md #15).
export const conditionsExpire: Primitive<ConditionsExpireParams> = {
  id: "conditions.expire",
  params: ConditionsExpireParams,
  ops: {
    /** The end of a turn: the actor's own `ownTurnEnd` conditions tick. */
    turnEnd: defineOp<ConditionsExpireParams, TurnEndInput>({
      input: TurnEndInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [{ condition: "*" }],
      validate: ({ ctx: { state }, input }) =>
        Object.hasOwn(state.actors, input.actorId) ? null : refuse("unknownActor", `no actor "${input.actorId}"`),
      apply: ({ ctx: { state }, input }) => {
        const actor = Object.hasOwn(state.actors, input.actorId) ? state.actors[input.actorId] : undefined;
        return actor === undefined ? [] : expire({ actors: [actor], on: "ownTurnEnd", counted: true });
      },
    }),
    /** The end of a round: every actor's `roundEnd` conditions tick. */
    roundEnd: defineOp<ConditionsExpireParams, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [{ condition: "*" }],
      apply: ({ ctx: { state } }) => expire({ actors: holders(state), on: "roundEnd", counted: true }),
    }),
    /** The end of the encounter: every `encounterEnd` condition goes, whatever count it has left. */
    encounterEnd: defineOp<ConditionsExpireParams, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [{ condition: "*" }],
      apply: ({ ctx: { state } }) => expire({ actors: holders(state), on: "encounterEnd", counted: false }),
    }),
  },
};
