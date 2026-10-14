import { z } from "zod";
import type { TestInputs } from "@inconsistable/core-schema";
import {
  ExprError,
  PoolFlag,
  TestOutcome,
  poolSize,
  evaluateInt,
  runOp,
  type CompiledTest,
  type ExprRecord,
} from "@inconsistable/rules-engine";

// The rules of a called Test that need no database: what a call's inputs must look like, the two numbers computed for
// one character, and the outcome of a reported roll. Pure, so they are unit tested on their own.

/** Why the GM's inputs don't fit the Test's declared `inputs`, or null. Every declared input is needed; extras are refused. */
export function checkInputs({ test, inputs }: { test: CompiledTest; inputs: TestInputs }): string | null {
  const declared = test.def.inputs;
  for (const key of Object.keys(inputs)) {
    if (!Object.hasOwn(declared, key)) return `This Test has no input "${key}"`;
  }
  for (const [key, type] of Object.entries(declared)) {
    const v = Object.hasOwn(inputs, key) ? inputs[key] : undefined;
    if (v === undefined) return `Fill in "${key}"`;
    if (type === "int" && !(typeof v === "number" && Number.isSafeInteger(v))) return `"${key}" takes a whole number`;
    if (type === "bool" && typeof v !== "boolean") return `"${key}" is yes or no`;
    if (type === "text" && typeof v !== "string") return `"${key}" takes text`;
    const options = test.def.inputOptions[key];
    if (options && !options.includes(String(v))) return `${key}: pick one of ${options.join(", ")}`;
  }
  return null;
}

/**
 * The modifier and the number to beat for one character, from its expression scope and the call's inputs. A Dice pool
 * also gets the dice to roll: its pool plus the modifier, never below zero.
 */
export function evaluateCall({
  test,
  scope,
  inputs,
}: {
  test: CompiledTest;
  scope: ExprRecord;
  inputs: TestInputs;
}): { ok: true; modifier: number; target: number; pool: number | null } | { ok: false; message: string } {
  const withInputs = { ...scope, ctx: inputs };
  try {
    const modifier = evaluateInt({ expr: test.modifier, scope: withInputs });
    return {
      ok: true,
      modifier,
      target: evaluateInt({ expr: test.target, scope: withInputs }),
      pool:
        test.pool === null ? null : poolSize({ pool: evaluateInt({ expr: test.pool, scope: withInputs }), modifier }),
    };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, message: e.message };
    throw e;
  }
}

/** The `ctx.*` inputs the number to beat reads: while the target is hidden these are hidden with it. */
export const targetInputs = (test: CompiledTest): string[] =>
  test.target.refs.flatMap((ref) => (ref.startsWith("ctx.") ? [ref.slice("ctx.".length).split(".")[0] ?? ""] : []));

export type Resolved =
  { ok: true; natural: number | null; total: number; outcome: TestOutcome } | { ok: false; message: string };

/** A reported roll resolved by the engine's `dice.sumVsTarget.resolve`: the dice are physical, the arithmetic is ours. */
export function resolveRoll({
  test,
  target,
  modifier,
  advantage,
  roll,
}: {
  test: CompiledTest;
  target: number;
  modifier: number;
  advantage: string;
  roll: unknown;
}): Resolved {
  const run = runOp({
    primitive: "dice.sumVsTarget",
    op: "resolve",
    params: test.def,
    state: { actors: {}, turn: null },
    input: { target, modifier, advantage, roll },
  });
  if (!run.ok) return { ok: false, message: run.refusal.message };
  const set = (key: string) => run.deltas.find((d) => "test" in d.target && d.target.test === key)?.value;
  const outcome = TestOutcome.safeParse(set("outcome"));
  const [total, natural] = [set("total"), set("natural")];
  if (!outcome.success || typeof total !== "number") return { ok: false, message: "The roll couldn't be resolved" };
  return { ok: true, natural: typeof natural === "number" ? natural : null, total, outcome: outcome.data };
}

export type ResolvedPool =
  | { ok: true; score: number; margin: number; shifts: number; flags: PoolFlag[]; outcome: TestOutcome }
  | { ok: false; message: string };

/** A reported Dice pool resolved by the engine's `dice.poolSuccesses.resolve`: the server counts, the dice stay physical. */
export function resolvePoolRoll({
  test,
  target,
  pool,
  roll,
}: {
  test: CompiledTest;
  target: number;
  /** The dice the character was told to roll, kept when the Test was called. */
  pool: number;
  roll: unknown;
}): ResolvedPool {
  const run = runOp({
    primitive: "dice.poolSuccesses",
    op: "resolve",
    params: test.def,
    state: { actors: {}, turn: null },
    input: { target, pool, roll },
  });
  if (!run.ok) return { ok: false, message: run.refusal.message };
  const set = (key: string) => run.deltas.find((d) => "test" in d.target && d.target.test === key)?.value;
  const outcome = TestOutcome.safeParse(set("outcome"));
  const flags = z.array(PoolFlag).safeParse(set("flags"));
  const [score, margin, shifts] = [set("total"), set("margin"), set("shifts")];
  if (
    !outcome.success ||
    !flags.success ||
    typeof score !== "number" ||
    typeof margin !== "number" ||
    typeof shifts !== "number"
  )
    return { ok: false, message: "The roll couldn't be resolved" };
  return { ok: true, score, margin, shifts, flags: flags.data, outcome: outcome.data };
}
