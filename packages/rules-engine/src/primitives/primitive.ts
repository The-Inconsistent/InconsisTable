import { z } from "zod";

import type { FieldValue } from "../derived.ts";
import {
  DeltaKind,
  TestKey,
  TurnKey,
  type ConditionDuration,
  type RefusalCode,
  type ResetEvent,
  type Touches,
} from "../enums.ts";

/**
 * Where a delta writes. An actor's resource, field or condition row, the encounter's turn state, or the open Test
 * call, or a shared pool (`pool`: a resource of scope party, gm or campaign, used with `add` only). A `condition` target names the row (`ConditionState.id`): `add` changes its `expiresAfter`, `set` with
 * `null` removes the row.
 */
export const DeltaTarget = z.union([
  z.strictObject({ actorId: z.string().min(1), resource: z.string().min(1) }),
  z.strictObject({ actorId: z.string().min(1), field: z.string().min(1) }),
  z.strictObject({ actorId: z.string().min(1), condition: z.string().min(1) }),
  z.strictObject({ turn: TurnKey }),
  z.strictObject({ test: TestKey }),
  z.strictObject({ pool: z.string().min(1) }),
]);
export type DeltaTarget = z.infer<typeof DeltaTarget>;

export const DeltaValue = z.union([z.number(), z.string(), z.boolean(), z.array(z.string()), z.null()]);
export type DeltaValue = z.infer<typeof DeltaValue>;

/** A proposed change. Plain data: the pipeline checks it against the op's targets and `editableBy`, then writes it. */
export const Delta = z.object({ target: DeltaTarget, kind: DeltaKind, value: DeltaValue });
export type Delta = z.infer<typeof Delta>;

/** What an op may write: a resource or field id (`*` for any), a turn key or a Test key. No actor: that is `perm`'s job. */
export type TargetPattern =
  | { resource: string }
  | { field: string }
  | { condition: "*" }
  | { turn: TurnKey }
  | { test: TestKey }
  | { pool: string };

/** A resource as the op sees it: its value and the bounds the caller evaluated (`resourceBounds`). */
export interface ResourceState {
  value: number;
  min: number;
  /** null: no ceiling (no max, or `capped: false`). */
  max: number | null;
  /** The value each reset event sets it to for this holder, evaluated by the caller (`resetValues`). */
  reset?: Partial<Record<ResetEvent, number>>;
  /** Health tracks: the overflow damage that kills outright, evaluated by the caller (`instantDeathAt`). */
  instantDeathAt?: number | null;
}

/** An active condition: one `actor_condition` row. */
export interface ConditionState {
  /** The row's id, which a `condition` delta target names. */
  id: string;
  conditionId: string;
  expiresOn: ConditionDuration;
  /** Turns or rounds left, for the expiries that count. null reads as 1 (house decision #14). */
  expiresAfter: number | null;
}

export interface ActorState {
  id: string;
  fields: Readonly<Record<string, FieldValue>>;
  resources: Readonly<Record<string, ResourceState>>;
  /** Active conditions in the order the table applied them. Absent: none loaded. */
  conditions?: readonly ConditionState[];
}

export interface TurnState {
  round: number;
  currentId: string | null;
  order: readonly string[];
  /** The first player of the round (`initiative.seated`); ranked ignores it. Absent reads as null. */
  firstId?: string | null;
  /** The phase of the round (`phases`); absent or null when the ruleset has none. */
  phaseId?: string | null;
  /** Actor ids that marked a simultaneous phase done. Absent reads as none. */
  done?: readonly string[];
}

/** The slice of live state an op reads. Loaded by the caller, scoped to one campaign. */
export interface RuleState {
  actors: Readonly<Record<string, ActorState>>;
  turn: TurnState | null;
  /** Shared pools (resources of scope party, gm or campaign) by resource id. Absent or empty: none loaded. */
  pools?: Readonly<Record<string, ResourceState>>;
}

export interface Refusal {
  code: RefusalCode;
  message: string;
}

export interface RuleCtx<P> {
  params: P;
  state: RuleState;
}

/**
 * One operation of a primitive (design §5.3). Methods, not function properties, so an op typed for its own input
 * still fits the registry's `PrimitiveOp<P, unknown>`.
 */
export interface PrimitiveOp<P, I> {
  input: z.ZodType<I>;
  /** Permission id checked by `can()` before anything runs. */
  perm: string;
  /** Depends on params: a health op writes the resources the manifest named, nothing else. */
  targets(args: { params: P }): TargetPattern[];
  /** Rules that are not permissions (the actor must be dying to roll a death save). */
  validate?(args: { ctx: RuleCtx<P>; input: I }): Refusal | null;
  /** Pure: proposes deltas, never writes. */
  apply(args: { ctx: RuleCtx<P>; input: I }): Delta[];
  touches: Touches;
}

export interface Primitive<P> {
  id: string;
  params: z.ZodType<P>;
  ops: Readonly<Record<string, PrimitiveOp<P, unknown>>>;
}

/** Keeps an op's input type when it is written inside a primitive's `ops` record. */
export function defineOp<P, I>(op: PrimitiveOp<P, I>): PrimitiveOp<P, I> {
  return op;
}

export function refuse(code: RefusalCode, message: string): Refusal {
  return { code, message };
}

/** Read an actor and one of its resources, or say which is missing. */
export function actorResource({
  state,
  actorId,
  resource,
}: {
  state: RuleState;
  actorId: string;
  resource: string;
}): { actor: ActorState; res: ResourceState } | Refusal {
  const actor = Object.hasOwn(state.actors, actorId) ? state.actors[actorId] : undefined;
  if (actor === undefined) return refuse("unknownActor", `no actor "${actorId}"`);
  const res = Object.hasOwn(actor.resources, resource) ? actor.resources[resource] : undefined;
  if (res === undefined) return refuse("unknownResource", `"${actorId}" has no resource "${resource}"`);
  return { actor, res };
}

/** Read a shared pool from the state, or say it is missing. */
export function readPool({ state, pool }: { state: RuleState; pool: string }): ResourceState | Refusal {
  const res = state.pools !== undefined && Object.hasOwn(state.pools, pool) ? state.pools[pool] : undefined;
  return res === undefined ? refuse("unknownPool", `no pool "${pool}"`) : res;
}

/**
 * Pays `amount` (a positive whole number) from a pool: one `add` of minus the amount. It refuses rather than clamps
 * when the pool could not cover it, and the refusal never names the value, so a hidden pool does not leak.
 */
export function charge({
  state,
  pool,
  amount,
}: {
  state: RuleState;
  pool: string;
  amount: number;
}): { delta: Delta } | Refusal {
  const res = readPool({ state, pool });
  if (isRefusal(res)) return res;
  if (!Number.isInteger(amount) || amount <= 0) return refuse("badInput", "amount must be a positive whole number");
  if (res.value - amount < res.min) return refuse("cannotPay", `cannot pay from "${pool}"`);
  return { delta: { target: { pool }, kind: "add", value: -amount } };
}

export function isRefusal(v: object): v is Refusal {
  return "code" in v && "message" in v;
}

function matches(target: DeltaTarget, pattern: TargetPattern): boolean {
  if ("resource" in target)
    return "resource" in pattern && (pattern.resource === "*" || pattern.resource === target.resource);
  if ("field" in target) return "field" in pattern && (pattern.field === "*" || pattern.field === target.field);
  if ("condition" in target) return "condition" in pattern;
  if ("turn" in target) return "turn" in pattern && pattern.turn === target.turn;
  if ("pool" in target) return "pool" in pattern && (pattern.pool === "*" || pattern.pool === target.pool);
  return "test" in pattern && pattern.test === target.test;
}

/** Pipeline step 6 (design §5.3), the part that needs no seat: every delta stays inside the op's declared targets. */
export function checkDeltas({
  deltas,
  targets,
}: {
  deltas: readonly Delta[];
  targets: readonly TargetPattern[];
}): Refusal | null {
  for (const d of deltas) {
    if (!targets.some((p) => matches(d.target, p))) {
      return refuse("outOfTargets", `delta writes ${JSON.stringify(d.target)}, outside the op's targets`);
    }
  }
  return null;
}
