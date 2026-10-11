import { z } from "zod";

import { AdvantageMode, type TestOutcome } from "../enums.ts";
import { plainDice, SumVsTarget } from "../manifest.ts";
import { defineOp, refuse, type Delta, type Primitive } from "./primitive.ts";

/**
 * The roll is reported (the dice stay physical, docs/house-decisions.md #1): either the faces, which the engine
 * sums, or the final total, with the natural roll when a crit needs to be read.
 */
export const SumVsTargetRoll = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("faces"), faces: z.array(z.int()).min(1).max(100) }),
  z.object({ kind: z.literal("total"), total: z.int(), natural: z.int().optional() }),
]);
export type SumVsTargetRoll = z.infer<typeof SumVsTargetRoll>;

export const ResolveInput = z.object({
  /** Evaluated by the server from the Test's `target` expression, so a hidden DN never leaves it. */
  target: z.int(),
  /** Evaluated from the Test's `modifier` expression. Ignored for a reported total, which already includes it. */
  modifier: z.int().default(0),
  advantage: AdvantageMode.default("none"),
  roll: SumVsTargetRoll,
});
export type ResolveInput = z.infer<typeof ResolveInput>;

export interface SumVsTargetResult {
  /** The kept dice before the modifier; null when only a total was reported without it. */
  natural: number | null;
  total: number;
  outcome: TestOutcome;
}

/** Pure resolution, also used to preview a result on the phone before it is reported. */
export function resolveSumVsTarget({ params, input }: { params: SumVsTarget; input: ResolveInput }): SumVsTargetResult {
  let natural: number | null;
  let total: number;
  if (input.roll.kind === "faces") {
    const faces = input.roll.faces;
    // Advantage keeps the higher of two rolls of the single die, disadvantage the lower (validated: 1dX, 2 faces).
    if (input.advantage === "advantage") natural = Math.max(...faces);
    else if (input.advantage === "disadvantage") natural = Math.min(...faces);
    else natural = faces.reduce((s, f) => s + f, 0);
    total = natural + input.modifier;
  } else {
    natural = input.roll.natural ?? null;
    total = input.roll.total;
  }
  let outcome: TestOutcome;
  if (natural !== null && params.critOn?.includes(natural) === true) outcome = "critical";
  else if (params.ties === "meetOrBeat" ? total >= input.target : total > input.target) outcome = "success";
  else outcome = "failure";
  return { natural, total, outcome };
}

export const diceSumVsTarget: Primitive<SumVsTarget> = {
  id: "dice.sumVsTarget",
  params: SumVsTarget,
  ops: {
    resolve: defineOp<SumVsTarget, ResolveInput>({
      input: ResolveInput,
      perm: "test:call",
      touches: "state",
      targets: () => [{ test: "outcome" }, { test: "total" }, { test: "natural" }],
      validate: ({ ctx: { params }, input }) => {
        const shape = plainDice(params.dice);
        if (shape === null) return refuse("badParams", `"${params.dice}" is not plain NdX dice`);
        if (input.advantage !== "none" && !params.advantage) return refuse("badInput", "this Test has no advantage");
        const want = input.advantage === "none" ? shape.count : 2;
        if (input.roll.kind === "faces") {
          if (input.roll.faces.length !== want) return refuse("badInput", `expected ${want} face(s)`);
          if (input.roll.faces.some((f) => f < 1 || f > shape.sides)) {
            return refuse("badInput", `a d${shape.sides} rolls 1–${shape.sides}`);
          }
        } else if (input.roll.natural !== undefined) {
          const lo = input.advantage === "none" ? shape.count : 1;
          const hi = input.advantage === "none" ? shape.count * shape.sides : shape.sides;
          if (input.roll.natural < lo || input.roll.natural > hi)
            return refuse("badInput", `natural must be ${lo}–${hi}`);
        }
        return null;
      },
      apply: ({ ctx: { params }, input }) => {
        const r = resolveSumVsTarget({ params, input });
        const deltas: Delta[] = [
          { target: { test: "outcome" }, kind: "set", value: r.outcome },
          { target: { test: "total" }, kind: "set", value: r.total },
        ];
        if (r.natural !== null) deltas.push({ target: { test: "natural" }, kind: "set", value: r.natural });
        return deltas;
      },
    }),
  },
};
