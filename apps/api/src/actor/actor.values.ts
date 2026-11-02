import { asc, eq } from "drizzle-orm";
import type { Actor, FieldValue } from "@inconsistable/core-schema";
import {
  ExprError,
  actorScope,
  applyBaseEffects,
  deriveValues,
  instantDeathAt,
  resetValues,
  resourceBounds,
  type ActorState,
  type ConditionState,
  type CompiledRuleset,
  type ExprRecord,
  type FieldDef,
  type ResourceState,
} from "@inconsistable/rules-engine";
import type { Db } from "../core/db.ts";
import { type Bounds, type ConditionRow, type FieldType, decodeField } from "./actor.delta.ts";
import { actor, actorCondition, actorField, actorResource } from "./actor.schema.ts";

// An actor's values as typed rows (docs/design.md §5.4), read once per snapshot or action and built into what the
// engine reads: fields, resources with their evaluated bounds, conditions, derived values.

export interface ActorRows {
  actor: typeof actor.$inferSelect;
  fields: (typeof actorField.$inferSelect)[];
  resources: (typeof actorResource.$inferSelect)[];
  conditions: (typeof actorCondition.$inferSelect)[];
}

/** Every actor of the campaign with its value rows. Four queries, each scoped to the campaign through its actor. */
export async function loadActorRows(conn: Db, campaignId: string): Promise<ActorRows[]> {
  const [actors, fields, resources, conditions] = await Promise.all([
    conn.select().from(actor).where(eq(actor.campaignId, campaignId)).orderBy(asc(actor.createdAt), asc(actor.id)),
    conn
      .select({ row: actorField })
      .from(actorField)
      .innerJoin(actor, eq(actor.id, actorField.actorId))
      .where(eq(actor.campaignId, campaignId))
      .orderBy(asc(actorField.fieldId), asc(actorField.ordinal)),
    conn
      .select({ row: actorResource })
      .from(actorResource)
      .innerJoin(actor, eq(actor.id, actorResource.actorId))
      .where(eq(actor.campaignId, campaignId)),
    conn
      .select({ row: actorCondition })
      .from(actorCondition)
      .innerJoin(actor, eq(actor.id, actorCondition.actorId))
      .where(eq(actor.campaignId, campaignId))
      .orderBy(asc(actorCondition.id)),
  ]);
  return actors.map((a) => ({
    actor: a,
    fields: fields.filter((f) => f.row.actorId === a.id).map((f) => f.row),
    resources: resources.filter((r) => r.row.actorId === a.id).map((r) => r.row),
    conditions: conditions.filter((c) => c.row.actorId === a.id).map((c) => c.row),
  }));
}

/** A field's rows as one value. A declared type decides; an undeclared (engine-owned) field is read by its shape. */
function fieldValue({ def, rows }: { def: FieldDef | undefined; rows: ActorRows["fields"] }): FieldValue {
  const list = def?.type === "list" || (def === undefined && rows.length > 1);
  if (list) return rows.toSorted((a, b) => a.ordinal - b.ordinal).map((r) => r.textValue ?? "");
  const [row] = rows;
  if (!row) return null;
  const type: FieldType = def?.type ?? (row.intValue !== null ? "int" : row.refKey !== null ? "ref" : "text");
  return decodeField({ type, row: { int: row.intValue, text: row.textValue, ref: row.refKey } });
}

const activeIds = (rows: Record<string, ConditionRow>) => Object.values(rows).map((c) => c.conditionId);

const conditionStates = (rows: Record<string, ConditionRow>): ConditionState[] =>
  Object.entries(rows).map(([id, c]) => ({
    id,
    conditionId: c.conditionId,
    expiresOn: c.expiresOn,
    expiresAfter: c.expiresAfter,
  }));

/** One actor as the engine and the snapshot read it. */
export interface BuiltActor {
  row: typeof actor.$inferSelect;
  /** The ruleset's entity type, or "" when the actor has none (or none the pinned ruleset knows). */
  entity: string;
  fields: Record<string, FieldValue>;
  /** Stored values of the resources that have a row. */
  resources: Record<string, number>;
  derived: Record<string, number>;
  /** The actor_condition rows by row id, in the order they were applied. */
  conditions: Record<string, ConditionRow>;
  /** For the ops: values with the bounds evaluated now. A resource whose bounds can't be evaluated yet is left out. */
  state: ActorState;
  bounds: Record<string, Bounds>;
  /** The expression scope (effects applied), or null when it can't be evaluated. */
  scope: ExprRecord | null;
  /** Why `scope` is null for an actor that has an entity: the expression error. Null when it derived fine. */
  problem: string | null;
}

export function buildActors({
  compiled,
  rows,
}: {
  compiled: CompiledRuleset | null;
  rows: readonly ActorRows[];
}): Record<string, BuiltActor> {
  const party = { characters: rows.filter((r) => r.actor.kind === "pc" && r.actor.status === "active").length };
  const out: Record<string, BuiltActor> = {};
  for (const r of rows) {
    const ce =
      compiled && Object.hasOwn(compiled.entities, r.actor.entityType)
        ? compiled.entities[r.actor.entityType]
        : undefined;
    const entity = ce ? r.actor.entityType : "";
    const fields: Record<string, FieldValue> = {};
    const resources: Record<string, number> = {};
    const conditions: Record<string, ConditionRow> = {};
    if (ce) {
      const byField = new Map<string, ActorRows["fields"]>();
      for (const f of r.fields) byField.set(f.fieldId, [...(byField.get(f.fieldId) ?? []), f]);
      for (const [id, rs] of byField) {
        const def = Object.hasOwn(ce.def.fields, id) ? ce.def.fields[id] : undefined;
        fields[id] = fieldValue({ def, rows: rs });
      }
      for (const x of r.resources) resources[x.resourceId] = x.value;
      for (const c of r.conditions)
        conditions[c.id] = {
          conditionId: c.conditionId,
          stacks: c.stacks,
          source: c.source,
          expiresOn: c.expiresOn,
          expiresAfter: c.expiresAfter,
        };
    }
    const built: BuiltActor = {
      row: r.actor,
      entity,
      fields,
      resources,
      derived: {},
      conditions,
      state: { id: r.actor.id, fields, resources: {}, conditions: conditionStates(conditions) },
      bounds: {},
      scope: null,
      problem: null,
    };
    out[r.actor.id] = built;
    if (!compiled || !ce) continue;
    // A half-built actor (a field an expression needs is not set yet) shows no derived values and none of its
    // resources are writable until it is complete; `problem` says what is missing (the validator keeps new
    // rulesets from building such an actor, older ones can still hold one).
    try {
      const values = { fields, resources, conditions: activeIds(conditions), party };
      built.derived = deriveValues({ compiled, entity, values });
      built.scope = actorScope({
        fields: applyBaseEffects({ compiled, entity, values }),
        derived: built.derived,
        resources,
        party,
      });
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      built.problem = e.message;
      continue;
    }
    const stateResources: Record<string, ResourceState> = {};
    for (const x of r.resources) {
      if (!ce.resources.includes(x.resourceId)) continue;
      try {
        const b = resourceBounds({ compiled, resource: x.resourceId, scope: built.scope });
        const max = x.maxOverride === null ? b.max : Math.max(b.min, x.maxOverride);
        built.bounds[x.resourceId] = { min: b.min, max };
        stateResources[x.resourceId] = {
          value: x.value,
          min: b.min,
          max,
          reset: resetValues({ compiled, resource: x.resourceId, scope: built.scope }),
          instantDeathAt: instantDeathAt({ compiled, resource: x.resourceId, scope: built.scope }),
        };
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
    built.state = { id: r.actor.id, fields, resources: stateResources, conditions: conditionStates(conditions) };
  }
  return out;
}

/** The actor as the live snapshot carries it (before any seat's filter). */
export function toLiveActor(b: BuiltActor): Actor {
  const { row } = b;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    ownerUserId: row.ownerUserId,
    entity: b.entity,
    fields: b.fields,
    resources: b.resources,
    derived: b.derived,
    conditions: activeIds(b.conditions),
    conditionTimers: Object.values(b.conditions).map((c) => ({
      id: c.conditionId,
      expiresOn: c.expiresOn,
      expiresAfter: c.expiresAfter,
    })),
  };
}

/** Load and build in one go, for an action that has no other use for the rows. */
export async function loadBuilt(
  conn: Db,
  { campaignId, compiled }: { campaignId: string; compiled: CompiledRuleset | null },
) {
  return buildActors({ compiled, rows: await loadActorRows(conn, campaignId) });
}
