import { z } from "zod";

import { ResetEvent } from "../enums.ts";
import { defineOp, refuse, type Delta, type Primitive } from "./primitive.ts";
import { clampResource } from "./resource-capped.ts";

/** What each resource resets to is on its state (`ResourceState.reset`, from `resetValues`), so no params. */
export const RestParams = z.strictObject({});
export type RestParams = z.infer<typeof RestParams>;

export const ApplyRestInput = z.object({
  event: ResetEvent,
  /** Holders to reset; every holder in the state when omitted (a session or encounter boundary). */
  actorIds: z.array(z.string().min(1)).max(500).optional(),
});
export type ApplyRestInput = z.infer<typeof ApplyRestInput>;

/**
 * Applies a ruleset's `resetOn` for one event: each resource that declares the event goes to its reset value, held
 * inside its bounds. An event never implies another: a long rest does not run the short-rest resets (house
 * decision #16), so a resource lists every event it answers to.
 */
export const rest: Primitive<RestParams> = {
  id: "rest",
  params: RestParams,
  ops: {
    apply: defineOp<RestParams, ApplyRestInput>({
      input: ApplyRestInput,
      perm: "session:run",
      touches: "state",
      targets: () => [{ resource: "*" }],
      validate: ({ ctx: { state }, input }) => {
        const unknown = input.actorIds?.find((id) => !Object.hasOwn(state.actors, id));
        return unknown === undefined ? null : refuse("unknownActor", `no actor "${unknown}"`);
      },
      apply: ({ ctx: { state }, input }) => {
        const ids = input.actorIds ?? Object.keys(state.actors);
        return ids.flatMap((id): Delta[] => {
          const actor = Object.hasOwn(state.actors, id) ? state.actors[id] : undefined;
          if (actor === undefined) return [];
          return Object.entries(actor.resources).flatMap(([resource, res]): Delta[] => {
            const to = res.reset?.[input.event];
            if (to === undefined) return [];
            // An add, like resource.capped: the server applies it as a clamped SQL delta.
            const change = clampResource({ res, delta: to - res.value }) - res.value;
            return change === 0 ? [] : [{ target: { actorId: id, resource }, kind: "add", value: change }];
          });
        });
      },
    }),
  },
};
