import type { Ctx } from "@inconsistable/core-schema";
import {
  ExprError,
  actorScope,
  applyBaseEffects,
  deriveValues,
  resourceBounds,
  type CompiledRuleset,
  type FieldValue,
} from "@inconsistable/rules-engine";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { type Bounds, type DeltaInput } from "./actor.delta.ts";
import { applyDeltas, fieldDef } from "./actor.pipeline.ts";
import { loadBuilt } from "./actor.values.ts";

// The first values of an actor: the fields a builder or a pack entry decided, then its resources at their starting
// value. Both go through `applyDeltas`, so they are clamped by the server and logged like any other write.

export interface StartingResource {
  resource: string;
  value: number;
  bounds: Bounds;
}

/**
 * The entity's resources at the start: full when the resource has a ceiling, else at its floor (house decision #23).
 * A resource whose bounds can't be evaluated yet (a field it reads is unset) is left out, as is everything when the
 * derived values can't be computed.
 */
export function startingResources({
  compiled,
  entity,
  fields,
  party,
}: {
  compiled: CompiledRuleset;
  entity: string;
  fields: Readonly<Record<string, FieldValue>>;
  party: { characters: number };
}): StartingResource[] {
  const ce = Object.hasOwn(compiled.entities, entity) ? compiled.entities[entity] : undefined;
  if (!ce) return [];
  const values = { fields, resources: {}, conditions: [], party };
  try {
    const derived = deriveValues({ compiled, entity, values });
    const scope = actorScope({ fields: applyBaseEffects({ compiled, entity, values }), derived, party });
    const out: StartingResource[] = [];
    for (const resource of ce.resources) {
      try {
        const b = resourceBounds({ compiled, resource, scope });
        out.push({ resource, value: b.max ?? b.min, bounds: { min: b.min, max: b.max } });
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
    return out;
  } catch (e) {
    if (!(e instanceof ExprError)) throw e;
    return [];
  }
}

/**
 * Writes the starting fields and resources of actors that already exist (with their entity type set). One log entry
 * for the lot, so one undo reverses it. `editableBy` is skipped: the creation or the pack decided these values.
 */
export async function writeStart(
  tx: Tx,
  {
    ctx,
    compiled,
    targets,
  }: {
    ctx: Ctx;
    compiled: CompiledRuleset;
    targets: readonly { actorId: string; fields: Record<string, FieldValue> }[];
  },
): Promise<string | null> {
  const built = await loadBuilt(tx, { campaignId: ctx.campaignId, compiled });
  const party = {
    characters: Object.values(built).filter((b) => b.row.kind === "pc" && b.row.status === "active").length,
  };
  const patched = { ...built };
  const deltas: DeltaInput[] = [];
  for (const t of targets) {
    const actor = Object.hasOwn(built, t.actorId) ? built[t.actorId] : undefined;
    if (!actor || actor.entity === "") fail("characterNotFound");
    for (const [field, value] of Object.entries(t.fields)) {
      if (value !== null && fieldDef({ compiled, actor, field }))
        deltas.push({ target: { actorId: t.actorId, field }, kind: "set", value: value as DeltaInput["value"] });
    }
    const start = startingResources({ compiled, entity: actor.entity, fields: t.fields, party });
    patched[t.actorId] = {
      ...actor,
      bounds: { ...actor.bounds, ...Object.fromEntries(start.map((r) => [r.resource, r.bounds])) },
    };
    for (const r of start)
      deltas.push({ target: { actorId: t.actorId, resource: r.resource }, kind: "set", value: r.value });
  }
  return applyDeltas(tx, { ctx, compiled, built: patched, deltas, trusted: true });
}
