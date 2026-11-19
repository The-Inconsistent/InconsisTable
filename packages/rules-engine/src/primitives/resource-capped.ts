import { z } from "zod";

import { Id } from "../manifest.ts";
import { actorResource, defineOp, isRefusal, readPool, type Primitive, type ResourceState } from "./primitive.ts";

/** Bounds live on each resource's state (the caller evaluates them), so the primitive takes no params. */
export const ResourceCappedParams = z.strictObject({});
export type ResourceCappedParams = z.infer<typeof ResourceCappedParams>;

export const AdjustInput = z.object({
  /** The holder: the actor whose resource it is. A party, gm or campaign resource is a pool, see `adjustPool`. */
  actorId: z.string().min(1),
  resource: Id,
  delta: z.int().min(-1_000_000).max(1_000_000),
});
export type AdjustInput = z.infer<typeof AdjustInput>;

export const AdjustPoolInput = z.object({
  resource: Id,
  delta: z.int().min(-1_000_000).max(1_000_000),
});
export type AdjustPoolInput = z.infer<typeof AdjustPoolInput>;

/** value + delta clamped to [min, max]. A max below the min collapses to the min, so the range is never empty. */
export function clampResource({ res, delta }: { res: ResourceState; delta: number }): number {
  const ceiling = res.max === null ? Infinity : Math.max(res.min, res.max);
  return Math.min(ceiling, Math.max(res.min, res.value + delta));
}

export const resourceCapped: Primitive<ResourceCappedParams> = {
  id: "resource.capped",
  params: ResourceCappedParams,
  ops: {
    adjust: defineOp<ResourceCappedParams, AdjustInput>({
      input: AdjustInput,
      // A player spends their own; `editableBy` on the resource narrows it further (ownerSpendOnly: negative only).
      perm: "character:edit:own",
      touches: "state",
      targets: () => [{ resource: "*" }],
      validate: ({ ctx: { state }, input }) => {
        const found = actorResource({ state, actorId: input.actorId, resource: input.resource });
        return isRefusal(found) ? found : null;
      },
      apply: ({ ctx: { state }, input }) => {
        const found = actorResource({ state, actorId: input.actorId, resource: input.resource });
        if (isRefusal(found)) return [];
        const change = clampResource({ res: found.res, delta: input.delta }) - found.res.value;
        // An add, not a set: the server applies it as a clamped SQL delta, so concurrent taps never overwrite.
        return change === 0
          ? []
          : [{ target: { actorId: input.actorId, resource: input.resource }, kind: "add", value: change }];
      },
    }),
    // A shared pool (scope party, gm or campaign): the same clamp, no holder.
    adjustPool: defineOp<ResourceCappedParams, AdjustPoolInput>({
      input: AdjustPoolInput,
      perm: "pool:adjust",
      touches: "state",
      targets: () => [{ pool: "*" }],
      validate: ({ ctx: { state }, input }) => {
        const found = readPool({ state, pool: input.resource });
        return isRefusal(found) ? found : null;
      },
      apply: ({ ctx: { state }, input }) => {
        const res = readPool({ state, pool: input.resource });
        if (isRefusal(res)) return [];
        const change = clampResource({ res, delta: input.delta }) - res.value;
        return change === 0 ? [] : [{ target: { pool: input.resource }, kind: "add", value: change }];
      },
    }),
  },
};
