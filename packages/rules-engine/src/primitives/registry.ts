import { z } from "zod";

import type { Touches } from "../enums.ts";
import { own } from "../own.ts";
import { conditionsExpire } from "./conditions-expire.ts";
import { dicePoolSuccesses } from "./dice-pool-successes.ts";
import { diceSumVsTarget } from "./dice-sum-vs-target.ts";
import { healthHarm } from "./health-harm.ts";
import { healthTracks } from "./health-tracks.ts";
import { initiativeRanked } from "./initiative-ranked.ts";
import { initiativeSeated } from "./initiative-seated.ts";
import { initiativeSides } from "./initiative-sides.ts";
import { checkDeltas, refuse, type Delta, type Primitive, type Refusal, type RuleState } from "./primitive.ts";
import { resourceCapped } from "./resource-capped.ts";
import { rest } from "./rest.ts";

/** Every primitive the platform maintains, by id. Adding one is a platform PR, never a manifest (design §4.1). */
export const PRIMITIVES: Readonly<Record<string, Primitive<unknown>>> = {
  [diceSumVsTarget.id]: diceSumVsTarget,
  [dicePoolSuccesses.id]: dicePoolSuccesses,
  [initiativeRanked.id]: initiativeRanked,
  [initiativeSeated.id]: initiativeSeated,
  [initiativeSides.id]: initiativeSides,
  [healthTracks.id]: healthTracks,
  [healthHarm.id]: healthHarm,
  [resourceCapped.id]: resourceCapped,
  [conditionsExpire.id]: conditionsExpire,
  [rest.id]: rest,
};

/**
 * The primitives a ruleset declares, which a spend's `run` may name (house decision #84): the ones `rule.op` runs from
 * the manifest's own blocks. The dice primitives run through the Test actions, so a spend runs none of them.
 */
export function declaredPrimitives(r: {
  initiative?: { strategy: string };
  health: { tracks: readonly unknown[]; harm?: unknown };
}): string[] {
  const out = ["resource.capped", "conditions.expire", "rest"];
  if (r.initiative !== undefined) out.push(`initiative.${r.initiative.strategy}`);
  if (r.health.tracks.length > 0) out.push("health.tracks");
  if (r.health.harm !== undefined) out.push("health.harm");
  return out;
}

/** The keys an op's input takes, or null for an op the registry does not know. */
export function opInputKeys(primitive: string, op: string): string[] | null {
  const def = own(own(PRIMITIVES, primitive)?.ops ?? {}, op);
  if (def === undefined) return null;
  return def.input instanceof z.ZodObject ? Object.keys(def.input.shape).sort() : [];
}

export type RunOpResult =
  { ok: true; deltas: Delta[]; touches: Touches; perm: string } | { ok: false; refusal: Refusal };

function zodMessage(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => (i.path.length > 0 ? `${i.path.map(String).join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/**
 * Pipeline steps 1, 4, 5, 6 of design §5.3 for one primitive op: parse params and input, the op's own validator,
 * apply, then every delta checked against the op's targets. Permission (`can(perm)`), `editableBy` and the write
 * are the caller's, since they need the seat and the database.
 */
export function runOp({
  primitive,
  op,
  params,
  state,
  input,
  registry = PRIMITIVES,
}: {
  primitive: string;
  op: string;
  params: unknown;
  state: RuleState;
  input: unknown;
  /** The platform's primitives unless a test supplies its own. */
  registry?: Readonly<Record<string, Primitive<unknown>>>;
}): RunOpResult {
  const prim = own(registry, primitive);
  if (prim === undefined) return { ok: false, refusal: refuse("unknownPrimitive", `no primitive "${primitive}"`) };
  const def = own(prim.ops, op);
  if (def === undefined) return { ok: false, refusal: refuse("unknownOp", `"${primitive}" has no op "${op}"`) };
  const p = prim.params.safeParse(params);
  if (!p.success) return { ok: false, refusal: refuse("badParams", zodMessage(p.error.issues)) };
  const i = def.input.safeParse(input);
  if (!i.success) return { ok: false, refusal: refuse("badInput", zodMessage(i.error.issues)) };
  const ctx = { params: p.data, state };
  const refusal = def.validate?.({ ctx, input: i.data }) ?? null;
  if (refusal !== null) return { ok: false, refusal };
  const deltas = def.apply({ ctx, input: i.data });
  const outside = checkDeltas({ deltas, targets: def.targets({ params: p.data }) });
  if (outside !== null) return { ok: false, refusal: outside };
  return { ok: true, deltas, touches: def.touches, perm: def.perm };
}
