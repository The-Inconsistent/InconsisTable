import { z } from "zod";

import { MAX_DICE } from "../dice/dice.ts";
import { PoolFlag, type TestOutcome } from "../enums.ts";
import { PoolSuccesses, type FaceRange } from "../manifest.ts";
import { own } from "../own.ts";
import { defineOp, refuse, type Primitive } from "./primitive.ts";

/**
 * A Dice pool as reported (the dice stay physical, docs/house-decisions.md #1): how many of the ordinary dice showed
 * a face of each scoring band, and the face of each special die. Dice that scored nothing are not counted.
 */
export const PoolRoll = z.object({
  kind: z.literal("pool"),
  /** By band id; a band left out counted none. */
  counts: z.record(z.string().max(64), z.int()).default({}),
  /** One face per special die, in order. */
  special: z.array(z.int()).max(10).default([]),
});
export type PoolRoll = z.infer<typeof PoolRoll>;

export const PoolResolveInput = z.object({
  /** The difficulty number, evaluated by the server from the Test's `target`, so a hidden one never leaves it. */
  target: z.int(),
  /** The dice the character rolled, as `poolSize` computed them when the Test was called. */
  pool: z.int().min(0).max(MAX_DICE),
  roll: PoolRoll,
});
export type PoolResolveInput = z.infer<typeof PoolResolveInput>;

export interface PoolResult {
  score: number;
  /** Score minus the difficulty number: below zero on a failure. */
  margin: number;
  outcome: TestOutcome;
  /** Dice of the shift band that could be taken off the score with the roll still passing. */
  shifts: number;
  flags: PoolFlag[];
}

/** The dice a character rolls: the pool's value plus the call's modifier, from zero up to the most dice the engine rolls. */
export const poolSize = ({ pool, modifier }: { pool: number; modifier: number }): number =>
  Math.min(MAX_DICE, Math.max(0, pool + modifier));

/** How many dice of a pool are special: the declared count, or every die of a smaller pool. */
export const specialDice = ({ params, pool }: { params: PoolSuccesses; pool: number }): number =>
  Math.min(params.special?.count ?? 0, pool);

const inRange = (face: number, r: FaceRange): boolean => face >= r.from && face <= r.to;

/** Pure resolution, also used to preview a result on the phone before it is reported. */
export function resolvePool({ params, input }: { params: PoolSuccesses; input: PoolResolveInput }): PoolResult {
  const { counts, special } = input.roll;
  let score = 0;
  let shiftable = 0;
  for (const band of params.bands) {
    // A special die scores like every other die of the pool (docs/house-decisions.md #29).
    const n = (own(counts, band.id) ?? 0) + special.filter((face) => inRange(face, band)).length;
    score += n * band.worth;
    if (band.id === params.shift) shiftable = n;
  }
  const passes = (s: number) => (params.ties === "meetOrBeat" ? s >= input.target : s > input.target);
  const worth = params.bands.find((b) => b.id === params.shift)?.worth ?? 0;
  let shifts = 0;
  while (worth > 0 && shifts < shiftable && passes(score - (shifts + 1) * worth)) shifts++;
  const flags = PoolFlag.options.filter((flag) => {
    const range = params.special?.flags[flag];
    return range !== undefined && special.some((face) => inRange(face, range));
  });
  return { score, margin: score - input.target, outcome: passes(score) ? "success" : "failure", shifts, flags };
}

export const dicePoolSuccesses: Primitive<PoolSuccesses> = {
  id: "dice.poolSuccesses",
  params: PoolSuccesses,
  ops: {
    resolve: defineOp<PoolSuccesses, PoolResolveInput>({
      input: PoolResolveInput,
      perm: "test:call",
      touches: "state",
      targets: () => [
        { test: "outcome" },
        { test: "total" },
        { test: "margin" },
        { test: "shifts" },
        { test: "flags" },
      ],
      validate: ({ ctx: { params }, input }) => {
        const { counts, special } = input.roll;
        const unknown = Object.keys(counts).find((id) => !params.bands.some((b) => b.id === id));
        if (unknown !== undefined) return refuse("badInput", `no scoring band "${unknown}"`);
        if (Object.values(counts).some((n) => n < 0)) return refuse("badInput", "a count can't be negative");
        const want = specialDice({ params, pool: input.pool });
        if (special.length !== want) return refuse("badInput", `expected ${want} special die face(s)`);
        if (special.some((f) => f < 1 || f > params.die))
          return refuse("badInput", `a d${params.die} rolls 1–${params.die}`);
        const counted = Object.values(counts).reduce((s, n) => s + n, 0) + special.length;
        if (counted > input.pool) return refuse("badInput", `${counted} dice counted, but the pool is ${input.pool}`);
        return null;
      },
      apply: ({ ctx: { params }, input }) => {
        const r = resolvePool({ params, input });
        return [
          { target: { test: "outcome" }, kind: "set", value: r.outcome },
          { target: { test: "total" }, kind: "set", value: r.score },
          { target: { test: "margin" }, kind: "set", value: r.margin },
          { target: { test: "shifts" }, kind: "set", value: r.shifts },
          { target: { test: "flags" }, kind: "set", value: r.flags },
        ];
      },
    }),
  },
};
