import { z } from "zod";

import type { FieldValue } from "../derived.ts";
import { DeltaKind, TestKey, TurnKey, type RefusalCode, type Touches } from "../enums.ts";

/** Where a delta writes. An actor's resource or field, the encounter's turn state, or the open Test call. */
export const DeltaTarget = z.union([
  z.strictObject({ actorId: z.string().min(1), resource: z.string().min(1) }),
  z.strictObject({ actorId: z.string().min(1), field: z.string().min(1) }),
  z.strictObject({ turn: TurnKey }),
  z.strictObject({ test: TestKey }),
]);
export type DeltaTarget = z.infer<typeof DeltaTarget>;

export const DeltaValue = z.union([z.number(), z.string(), z.boolean(), z.array(z.string()), z.null()]);
export type DeltaValue = z.infer<typeof DeltaValue>;

/** A proposed change. Plain data: the pipeline checks it against the op's targets and `editableBy`, then writes it. */
export const Delta = z.object({ target: DeltaTarget, kind: DeltaKind, value: DeltaValue });
export type Delta = z.infer<typeof Delta>;

/** What an op may write: a resource or field id (`*` for any), a turn key or a Test key. No actor: that is `perm`'s job. */
export type TargetPattern = { resource: string } | { field: string } | { turn: TurnKey } | { test: TestKey };

/** A resource as the op sees it: its value and the bounds the caller evaluated (`resourceBounds`). */
export interface ResourceState {
  value: number;
  min: number;
  /** null: no ceiling (no max, or `capped: false`). */
  max: number | null;
}

export interface ActorState {
  id: string;
  fields: Readonly<Record<string, FieldValue>>;
  resources: Readonly<Record<string, ResourceState>>;
}

export interface TurnState {
  round: number;
  currentId: string | null;
  order: readonly string[];
}

/** The slice of live state an op reads. Loaded by the caller, scoped to one campaign. */
export interface RuleState {
  actors: Readonly<Record<string, ActorState>>;
  turn: TurnState | null;
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

export function isRefusal(v: object): v is Refusal {
  return "code" in v && "message" in v;
}

function matches(target: DeltaTarget, pattern: TargetPattern): boolean {
  if ("resource" in target)
    return "resource" in pattern && (pattern.resource === "*" || pattern.resource === target.resource);
  if ("field" in target) return "field" in pattern && (pattern.field === "*" || pattern.field === target.field);
  if ("turn" in target) return "turn" in pattern && pattern.turn === target.turn;
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
