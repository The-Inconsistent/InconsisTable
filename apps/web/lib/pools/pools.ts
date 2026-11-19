import { canInCampaign, type Me, type PoolState } from "@inconsistable/core-schema";

export type PoolSides = { gmSide: boolean; holder: boolean };

/**
 * What a seat is, for the pool buttons. The GM side runs the table (`session:run`) in a room that has a GM, the same
 * check the GM app uses; a holder is a seat with a character. Only a preview: the server decides (house decision #56).
 */
export function poolSidesOf(me: Me): PoolSides {
  return {
    gmSide: me.tableMode === "gm" && canInCampaign({ ctx: me, perm: "session:run" }),
    holder: me.seat.kind !== "admin" && me.seat.characterIds.length > 0,
  };
}

/** Which of the two buttons a seat is offered on one pool (house decision #56). Neither means a read-only row. */
export function poolSteps({ pool, gmSide, holder }: { pool: PoolState } & PoolSides) {
  if (gmSide) return { dec: true, inc: true };
  if (pool.scope !== "party" || !holder) return { dec: false, inc: false };
  return { dec: pool.editableBy === "owner" || pool.editableBy === "ownerSpendOnly", inc: pool.editableBy === "owner" };
}

/** The bar's fill from 0 to 1: nothing when the pool has no maximum; a value past the maximum stays full. */
export function poolFraction(pool: Pick<PoolState, "value" | "min" | "max">) {
  if (pool.max === null || pool.max <= pool.min) return null;
  return Math.min(1, Math.max(0, (pool.value - pool.min) / (pool.max - pool.min)));
}

/** The server clamps at min, and at max only when the pool is capped. */
export function poolStepLimits(pool: PoolState) {
  return {
    decDisabled: pool.value <= pool.min,
    incDisabled: pool.capped && pool.max !== null && pool.value >= pool.max,
  };
}
