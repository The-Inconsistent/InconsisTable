import { z } from "zod";

import { ExprError, type ExprRecord, type ExprValue } from "../expr/expr.ast.ts";
import { evaluate } from "../expr/expr.eval.ts";
import { parseExpr } from "../expr/expr.parser.ts";
import { Harm, type HarmProfile } from "../manifest.ts";
import { own } from "../own.ts";
import {
  actorResource,
  defineOp,
  isRefusal,
  refuse,
  type ActorState,
  type Delta,
  type Primitive,
  type Refusal,
  type ResourceState,
  type RuleState,
  type TargetPattern,
} from "./primitive.ts";

// House decision #66: damage that counts up toward a limit, and mobs. The arithmetic is Auspex's `pcHit` and
// `combatant.adjust` (wrath_glory packages/shared/src/state.ts, apps/api/src/encounter/encounter.actions.ts), with
// every number and condition the manifest's.

export const HealthHarmParams = Harm;
export type HealthHarmParams = z.infer<typeof HealthHarmParams>;

const Amount = z.int().min(-100).max(100);

/** One hit, as the GM enters its final numbers: wounds and shock taken (negative: healed). */
export const HitInput = z
  .object({ actorId: z.string().min(1), wounds: Amount.optional(), shock: Amount.optional() })
  .refine((x) => (x.wounds ?? 0) !== 0 || (x.shock ?? 0) !== 0, "a hit takes wounds or shock");
export type HitInput = z.infer<typeof HitInput>;

/** A mob's size set by hand: its members, and its start raised to match. */
export const MusterInput = z.object({ actorId: z.string().min(1), members: z.int().min(0).max(500) });
export type MusterInput = z.infer<typeof MusterInput>;

/** Wounds moved to the second track, as many as the player reports (house decision #84). */
export const ConvertInput = z.object({ actorId: z.string().min(1), amount: z.int().min(1).max(100) });
export type ConvertInput = z.infer<typeof ConvertInput>;

type P = HealthHarmParams;

/** One expression of the block read on the actor. The manifest's text is parsed here: the validator checked it. */
function read({
  source,
  scope,
  path,
}: {
  source: string;
  scope: ExprRecord;
  path: string;
}): { v: ExprValue } | Refusal {
  try {
    return { v: evaluate({ node: parseExpr(source), scope }) };
  } catch (err) {
    if (err instanceof ExprError) return refuse("wrongState", `${path}: ${err.message}`);
    throw err;
  }
}

function readBool(args: { source: string; scope: ExprRecord; path: string }): boolean | Refusal {
  const r = read(args);
  if (isRefusal(r)) return r;
  return typeof r.v === "boolean" ? r.v : refuse("wrongState", `${args.path}: not a boolean`);
}

function readNumber(args: { source: string; scope: ExprRecord; path: string }): number | Refusal {
  const r = read(args);
  if (isRefusal(r)) return r;
  return typeof r.v === "number" ? r.v : refuse("wrongState", `${args.path}: not a number`);
}

const isRefused = (v: boolean | number | Refusal): v is Refusal => typeof v === "object";

const isRecord = (v: ExprValue | null | undefined): v is ExprRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const addTo = (actorId: string, resource: string, value: number): Delta => ({
  target: { actorId, resource },
  kind: "add",
  value,
});

/** The actor, the profile its type falls under, and its scope. */
function load({
  params,
  state,
  actorId,
}: {
  params: P;
  state: RuleState;
  actorId: string;
}): { actor: ActorState; profile: HarmProfile; at: number; scope: ExprRecord } | Refusal {
  const actor = own(state.actors, actorId);
  if (actor === undefined) return refuse("unknownActor", `no actor "${actorId}"`);
  const entity = actor.entity;
  const at = entity === undefined ? -1 : params.profiles.findIndex((p) => p.entities.includes(entity));
  const profile = params.profiles[at];
  if (profile === undefined) return refuse("noHarmHere", `"${actorId}" takes no hits under this ruleset`);
  if (actor.scope === undefined) return refuse("wrongState", `"${actorId}" has values that cannot be read yet`);
  return { actor, profile, at, scope: actor.scope };
}

const resourceOf = (actor: ActorState, id: string | undefined): ResourceState | undefined =>
  id === undefined ? undefined : own(actor.resources, id);

/** Past its shock limit: `spent.when` holds, or the actor has any of `spent.conditions`. */
function spentNow({
  profile,
  actor,
  scope,
  path,
}: {
  profile: HarmProfile;
  actor: ActorState;
  scope: ExprRecord;
  path: string;
}): boolean | Refusal {
  const spent = profile.spent;
  if (spent === undefined) return false;
  if (spent.when !== undefined) {
    const v = readBool({ source: spent.when, scope, path: `${path}.spent.when` });
    if (isRefused(v)) return v;
    if (v) return true;
  }
  const held = actor.conditions ?? [];
  return (spent.conditions ?? []).some((c) => held.some((row) => row.conditionId === c));
}

/**
 * `convert` (house decision #84): up to `amount` wounds become shock, never below zero wounds. It lays and lifts no
 * condition. Refused for a profile without `convert`, an actor without the second track, one that never takes shock,
 * one already spent, and one with no wounds.
 */
function convert({ params, state, input }: { params: P; state: RuleState; input: ConvertInput }): Delta[] | Refusal {
  const loaded = load({ params, state, actorId: input.actorId });
  if (isRefusal(loaded)) return loaded;
  const { actor, profile, at, scope } = loaded;
  const path = `health.harm.profiles[${at}]`;
  const id = actor.id;
  const shockRes = resourceOf(actor, params.shock);
  if (profile.convert !== true || params.shock === undefined || shockRes === undefined)
    return refuse("noConvertHere", `"${id}" converts no harm under this ruleset`);
  if (profile.shockless !== undefined) {
    const never = readBool({ source: profile.shockless, scope, path: `${path}.shockless` });
    if (isRefused(never)) return never;
    if (never) return refuse("neverShocked", `"${id}" never takes shock`);
  }
  const isSpent = spentNow({ profile, actor, scope, path });
  if (isRefused(isSpent)) return isSpent;
  if (isSpent) return refuse("wrongState", `"${id}" is spent`);
  const wounded = actorResource({ state, actorId: id, resource: params.wounds });
  if (isRefusal(wounded)) return wounded;
  const moved = Math.min(input.amount, wounded.res.value);
  if (moved <= 0) return refuse("wrongState", `"${id}" has no wounds to convert`);
  return [addTo(id, params.wounds, -moved), addTo(id, params.shock, moved)];
}

/** What one hit does, in the order of house decision #66; every expression is read on the actor before it. */
function hit({ params, state, input }: { params: P; state: RuleState; input: HitInput }): Delta[] | Refusal {
  const loaded = load({ params, state, actorId: input.actorId });
  if (isRefusal(loaded)) return loaded;
  const { actor, profile, at, scope } = loaded;
  const path = `health.harm.profiles[${at}]`;
  const id = actor.id;
  const shock0 = input.shock ?? 0;
  if (shock0 !== 0) {
    if (params.shock === undefined) return refuse("badRequest", "this ruleset has no shock");
    if (profile.shockless !== undefined) {
      const never = readBool({ source: profile.shockless, scope, path: `${path}.shockless` });
      if (isRefused(never)) return never;
      if (never) return refuse("neverShocked", `"${id}" never takes shock`);
    }
  }
  const shockRes = resourceOf(actor, params.shock);
  // b. A mob: wounds take members away, and more shock in one hit than its limit takes one more. It keeps no wounds.
  const members = resourceOf(actor, params.mob?.members);
  if (params.mob !== undefined && members !== undefined) {
    const limit = shockRes === undefined ? null : (shockRes.limit ?? shockRes.max);
    const loss = (input.wounds ?? 0) + (limit !== null && shock0 > limit ? 1 : 0);
    const next = Math.max(0, Math.min(members.max ?? Infinity, members.value - loss));
    return next === members.value ? [] : [addTo(id, params.mob.members, next - members.value)];
  }
  const wounded = actorResource({ state, actorId: id, resource: params.wounds });
  if (isRefusal(wounded)) return wounded;
  const wRes = wounded.res;
  let wounds = input.wounds ?? 0;
  let shock = shock0;
  // a. Already spent: shock taken becomes wounds. Healing shock is never turned into anything.
  if (shock > 0) {
    const isSpent = spentNow({ profile, actor, scope, path });
    if (isRefused(isSpent)) return isSpent;
    if (isSpent) {
      wounds += shock;
      shock = 0;
    }
  }
  // c. Destroyed: one hit past the line ends the actor outright, and nothing else changes.
  if (profile.destroyed !== undefined) {
    const over = readNumber({ source: profile.destroyed.over, scope, path: `${path}.destroyed.over` });
    if (isRefused(over)) return over;
    if (wounds > over) return [{ target: { actorId: id, field: profile.destroyed.field }, kind: "set", value: true }];
  }
  const deltas: Delta[] = [];
  // d. Shock: never below 0, no ceiling.
  if (shockRes !== undefined && params.shock !== undefined && shock !== 0) {
    const next = Math.max(0, shockRes.value + shock);
    if (next !== shockRes.value) deltas.push(addTo(id, params.shock, next - shockRes.value));
  }
  if (wounds === 0) return deltas;
  // e. Wounds. Down already: a wound is one more injury, healing lifts it no higher than healTo.
  const felled = profile.felled;
  let down = false;
  if (felled !== undefined) {
    const v = readBool({ source: felled.when, scope, path: `${path}.felled.when` });
    if (isRefused(v)) return v;
    down = v;
  }
  if (felled !== undefined && down) {
    if (wounds > 0) {
      if (felled.injuries !== undefined) {
        const had = own(actor.fields, felled.injuries);
        const value = (typeof had === "number" ? had : 0) + 1;
        deltas.push({ target: { actorId: id, field: felled.injuries }, kind: "set", value });
      }
      return deltas;
    }
    let cap = Infinity;
    if (felled.healTo !== undefined) {
      const v = readNumber({ source: felled.healTo, scope, path: `${path}.felled.healTo` });
      if (isRefused(v)) return v;
      cap = v;
    }
    const next = Math.max(0, Math.min(cap, wRes.value + wounds));
    if (next !== wRes.value) deltas.push(addTo(id, params.wounds, next - wRes.value));
    return deltas;
  }
  const next = Math.max(0, wRes.value + wounds);
  if (next !== wRes.value) deltas.push(addTo(id, params.wounds, next - wRes.value));
  if (felled?.condition === undefined) return deltas;
  // Brought down by this hit: `felled.when` read again with the new wounds (the rest of the scope as before).
  // ponytail: derived values keep their pre-hit numbers, so a limit derived from the wounds themselves is stale here;
  // derive again with the new wounds if a ruleset needs it.
  const res = scope.res;
  const after: ExprRecord = { ...scope, res: { ...(isRecord(res) ? res : {}), [params.wounds]: next } };
  const nowDown = readBool({ source: felled.when, scope: after, path: `${path}.felled.when` });
  if (isRefused(nowDown)) return nowDown;
  const condition = felled.condition;
  if (nowDown && !(actor.conditions ?? []).some((row) => row.conditionId === condition)) {
    deltas.push({ target: { actorId: id, applyCondition: condition }, kind: "add", value: 1 });
  }
  return deltas;
}

/** The members of a mob the actor is, or a refusal. */
function mobOf({
  params,
  state,
  actorId,
}: {
  params: P;
  state: RuleState;
  actorId: string;
}): { actor: ActorState; members: ResourceState; mob: NonNullable<P["mob"]> } | Refusal {
  const actor = own(state.actors, actorId);
  if (actor === undefined) return refuse("unknownActor", `no actor "${actorId}"`);
  const members = resourceOf(actor, params.mob?.members);
  if (params.mob === undefined || members === undefined) return refuse("notAMob", `"${actorId}" is not a mob`);
  return { actor, members, mob: params.mob };
}

function targets({ params }: { params: P }): TargetPattern[] {
  const out: TargetPattern[] = [{ resource: params.wounds }];
  if (params.shock !== undefined) out.push({ resource: params.shock });
  if (params.mob !== undefined) out.push({ resource: params.mob.members }, { field: params.mob.start });
  for (const p of params.profiles) {
    if (p.felled?.injuries !== undefined) out.push({ field: p.felled.injuries });
    if (p.destroyed !== undefined) out.push({ field: p.destroyed.field });
  }
  out.push({ condition: "*" });
  return out;
}

export const healthHarm: Primitive<HealthHarmParams> = {
  id: "health.harm",
  params: HealthHarmParams,
  ops: {
    hit: defineOp<P, HitInput>({
      input: HitInput,
      perm: "encounter:run",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const r = hit({ params, state, input });
        return isRefusal(r) ? r : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const r = hit({ params, state, input });
        return isRefusal(r) ? [] : r;
      },
    }),
    muster: defineOp<P, MusterInput>({
      input: MusterInput,
      perm: "encounter:run",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const r = mobOf({ params, state, actorId: input.actorId });
        return isRefusal(r) ? r : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const r = mobOf({ params, state, actorId: input.actorId });
        if (isRefusal(r)) return [];
        const { actor, members, mob } = r;
        const had = own(actor.fields, mob.start);
        const start = typeof had === "number" ? had : 0;
        const deltas: Delta[] = [];
        if (input.members > start)
          deltas.push({ target: { actorId: actor.id, field: mob.start }, kind: "set", value: input.members });
        if (input.members !== members.value) deltas.push(addTo(actor.id, mob.members, input.members - members.value));
        return deltas;
      },
    }),
    convert: defineOp<P, ConvertInput>({
      input: ConvertInput,
      perm: "encounter:run",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const r = convert({ params, state, input });
        return isRefusal(r) ? r : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const r = convert({ params, state, input });
        return isRefusal(r) ? [] : r;
      },
    }),
  },
};
