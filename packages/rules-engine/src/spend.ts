import { ExprError, type ExprRecord, type ExprValue } from "./expr/expr.ast.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { parseExpr } from "./expr/expr.parser.ts";
import type { Ruleset } from "./manifest.ts";
import { own } from "./own.ts";
import { isRefusal, refuse, type ActorState, type Refusal, type RuleState } from "./primitives/primitive.ts";

// House decision #84: a spend is a cost and the ops it buys. `planSpend` reads one on the asking actor and says what it
// costs and what it runs, or why it cannot be done now. The api takes the costs and runs the ops in one action; the web
// reads the same answer to offer only what is available. Both read the manifest's own text, as `health.harm` does.

/** One cost, its amount read: a shared pool or a resource of the asking actor. */
export interface PlannedCost {
  pool?: string;
  resource?: string;
  amount: number;
  /** A run op takes it itself: checked and shown, never taken by the spend. */
  byRun: boolean;
}

/** One op, its input read. */
export interface PlannedStep {
  primitive: string;
  op: string;
  input: Record<string, ExprValue>;
}

export interface SpendPlan {
  costs: PlannedCost[];
  run: PlannedStep[];
  /**
   * The turn's `used` list once this spend is done (house decision #91): the current round's uses and this one. Absent
   * for a spend without a limit, or one done outside a fight the actor is in.
   */
  used?: string[];
}

/** One use of a spend limited per round, as the turn's `used` list holds it (house decision #91). */
export const usedKey = ({ round, actorId, spendId }: { round: number; actorId: string; spendId: string }): string =>
  `${round}:${actorId}:${spendId}`;

function read(source: string, scope: ExprRecord, path: string): { v: ExprValue } | Refusal {
  try {
    return { v: evaluate({ node: parseExpr(source), scope }) };
  } catch (err) {
    if (err instanceof ExprError) return refuse("wrongState", `${path}: ${err.message}`);
    throw err;
  }
}

function readInt(source: string, scope: ExprRecord, path: string): number | Refusal {
  const r = read(source, scope, path);
  if (isRefusal(r)) return r;
  return typeof r.v === "number" ? r.v : refuse("wrongState", `${path}: not a number`);
}

/** `ctx.fight`: whether a fight runs, the actor is in it, the round, and whether the actor is barred this round. */
function fightOf(state: RuleState, id: string): ExprRecord {
  const t = state.turn;
  return {
    on: t !== null,
    in: t?.order.includes(id) ?? false,
    round: t?.round ?? 0,
    barred: t?.barred?.includes(id) ?? false,
  };
}

/**
 * What a spend costs and runs for one actor now, or why not: `noSuchSpend` (none by that id, or not for this actor's
 * type), `badInput` (an input missing, unknown or out of its range), `spendNotNow` (`if` does not hold), `cannotPay`
 * (a cost the pool or the resource could not cover in full, `byRun` ones included), `usedThisRound` (its `limit` is
 * reached this round, house decision #91). A cost that reads 0 is dropped.
 */
export function planSpend({
  ruleset,
  spendId,
  actor,
  state,
  inputs,
}: {
  ruleset: Pick<Ruleset, "spends">;
  spendId: string;
  actor: ActorState;
  state: RuleState;
  inputs: Readonly<Record<string, unknown>>;
}): SpendPlan | Refusal {
  const spend = ruleset.spends?.find((s) => s.id === spendId);
  if (spend === undefined) return refuse("noSuchSpend", `no spend "${spendId}"`);
  const at = (ruleset.spends ?? []).indexOf(spend);
  const path = `spends[${at}]`;
  if (actor.entity === undefined || (spend.entities !== undefined && !spend.entities.includes(actor.entity)))
    return refuse("noSuchSpend", `"${actor.id}" cannot spend "${spendId}"`);
  if (actor.scope === undefined) return refuse("wrongState", `"${actor.id}" has values that cannot be read yet`);
  const base: ExprRecord = { self: actor.id, fight: fightOf(state, actor.id) };
  const declared = spend.inputs ?? {};
  for (const name of Object.keys(inputs).sort()) {
    if (!Object.hasOwn(declared, name)) return refuse("badInput", `"${name}" is not an input`);
  }
  const picked: Record<string, number> = {};
  for (const name of Object.keys(declared).sort()) {
    const def = declared[name];
    if (def === undefined) continue;
    const max = readInt(def.max, { ...actor.scope, ctx: base }, `${path}.inputs.${name}.max`);
    if (typeof max !== "number") return max;
    const v = own(inputs, name);
    if (typeof v !== "number" || !Number.isInteger(v) || v < def.min || v > max)
      return refuse("badInput", `"${name}" must be a whole number from ${def.min} to ${max}`);
    picked[name] = v;
  }
  const scope: ExprRecord = { ...actor.scope, ctx: { ...picked, ...base } };
  if (spend.if !== undefined) {
    const r = read(spend.if, scope, `${path}.if`);
    if (isRefusal(r)) return r;
    if (r.v !== true) return refuse("spendNotNow", `"${spend.label}" cannot be done now`);
  }
  let used: string[] | undefined;
  const t = state.turn;
  if (spend.limit !== undefined && t !== null && t.order.includes(actor.id)) {
    const key = usedKey({ round: t.round, actorId: actor.id, spendId });
    const now = (t.used ?? []).filter((u) => u.startsWith(`${t.round}:`));
    if (now.filter((u) => u === key).length >= spend.limit.max)
      return refuse("usedThisRound", `"${spend.label}", round ${t.round}`);
    used = [...now, key];
  }
  const costs: PlannedCost[] = [];
  const owed = new Map<string, number>();
  for (const [j, c] of spend.cost.entries()) {
    const amount = readInt(c.amount, scope, `${path}.cost[${j}].amount`);
    if (typeof amount !== "number") return amount;
    if (amount < 0) return refuse("badInput", `${path}.cost[${j}].amount is below 0`);
    if (amount === 0) continue;
    const key = c.pool === undefined ? `resource:${c.resource ?? ""}` : `pool:${c.pool}`;
    const total = (owed.get(key) ?? 0) + amount;
    owed.set(key, total);
    const res = c.pool === undefined ? own(actor.resources, c.resource ?? "") : own(state.pools ?? {}, c.pool);
    if (res === undefined)
      return c.pool === undefined
        ? refuse("unknownResource", `"${actor.id}" has no resource "${c.resource ?? ""}"`)
        : refuse("unknownPool", `no pool "${c.pool}"`);
    if (res.value - total < res.min) return refuse("cannotPay", `cannot pay from "${c.pool ?? c.resource ?? ""}"`);
    costs.push({
      ...(c.pool === undefined ? { resource: c.resource } : { pool: c.pool }),
      amount,
      byRun: c.byRun === true,
    });
  }
  const run: PlannedStep[] = [];
  for (const [j, step] of (spend.run ?? []).entries()) {
    const input: Record<string, ExprValue> = {};
    for (const key of Object.keys(step.input).sort()) {
      const value = step.input[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        input[key] = value;
        continue;
      }
      const r = read(value, scope, `${path}.run[${j}].input.${key}`);
      if (isRefusal(r)) return r;
      input[key] = r.v;
    }
    run.push({ primitive: step.primitive, op: step.op, input });
  }
  return used === undefined ? { costs, run } : { costs, run, used };
}
