import type { CompiledEffect, CompiledRuleset } from "./compile.ts";
import type { EffectMode, ResetEvent } from "./enums.ts";
import type { ExprRecord, ExprValue } from "./expr/expr.ast.ts";
import { evaluateBool, evaluateInt } from "./expr/expr.ts";
import { own } from "./own.ts";

/** A stored field value, as the actor_field row holds it. */
export type FieldValue = number | string | boolean | readonly string[] | null;

/** What deriveValues reads for one actor. */
export interface ActorValues {
  fields: Readonly<Record<string, FieldValue>>;
  /** Current values of the entity-scoped resources (`res.hp`). */
  resources?: Readonly<Record<string, number>>;
  /** Active condition ids; their effects apply in §4.4 order. */
  conditions?: readonly string[];
  party?: { characters: number };
}

/** `{ "attr.str": 14 }` → `{ attr: { str: 14 } }`, the shape expressions read. */
export function nestFields(fields: Readonly<Record<string, FieldValue>>): Record<string, ExprValue> {
  const out: Record<string, ExprValue> = {};
  const groups = new Map<string, Record<string, FieldValue>>();
  for (const [id, value] of Object.entries(fields)) {
    const dot = id.indexOf(".");
    if (dot < 0) {
      // An unset field stays absent, so `has(x)` is false and reading it is a missing-value error.
      if (value !== null) out[id] = value;
      continue;
    }
    const group = groups.get(id.slice(0, dot)) ?? {};
    group[id.slice(dot + 1)] = value;
    groups.set(id.slice(0, dot), group);
  }
  for (const [head, sub] of groups) out[head] = nestFields(sub);
  return out;
}

/** The runtime scope for an actor expression. `derived` is read live, so filling it in order is enough. */
export function actorScope({
  fields,
  derived = {},
  resources = {},
  party = { characters: 0 },
  ctx,
}: {
  fields: Readonly<Record<string, FieldValue>>;
  derived?: Readonly<Record<string, number>>;
  resources?: Readonly<Record<string, number>>;
  party?: { characters: number };
  ctx?: ExprRecord;
}): ExprRecord {
  return { ...nestFields(fields), derived, res: resources, party, ...(ctx === undefined ? {} : { ctx }) };
}

function applyMode({ mode, current, value }: { mode: EffectMode; current: number; value: number }): number {
  switch (mode) {
    case "add":
      return current + value;
    case "multiply":
      return current * value;
    case "override":
      return value;
    case "upgrade":
      return Math.max(current, value);
    case "downgrade":
      return Math.min(current, value);
  }
}

function activeEffects({ effects, conditions }: { effects: readonly CompiledEffect[]; conditions: readonly string[] }) {
  // ponytail: an effect applies once per active condition, whatever its stacks; per-stack scaling when a ruleset
  // declares one.
  const active = new Set(conditions);
  return effects.filter((e) => active.has(e.conditionId));
}

function entityOf({ compiled, entity }: { compiled: CompiledRuleset; entity: string }) {
  const ce = own(compiled.entities, entity);
  if (ce === undefined) throw new Error(`unknown entity type "${entity}"`);
  return ce;
}

/** Base fields with the base-phase effects of active conditions applied, then clamped to each int field's range. */
export function applyBaseEffects({
  compiled,
  entity,
  values,
}: {
  compiled: CompiledRuleset;
  entity: string;
  values: ActorValues;
}): Record<string, FieldValue> {
  const ce = entityOf({ compiled, entity });
  const fields: Record<string, FieldValue> = { ...values.fields };
  for (const eff of activeEffects({ effects: ce.effects, conditions: values.conditions ?? [] })) {
    if (eff.phase !== "base") continue;
    const current = own(fields, eff.target);
    if (typeof current !== "number") continue; // an unset field has nothing to modify
    const scope = actorScope({ fields, resources: values.resources, party: values.party });
    if (eff.when !== null && !evaluateBool({ expr: eff.when, scope })) continue;
    fields[eff.target] = applyMode({ mode: eff.mode, current, value: evaluateInt({ expr: eff.value, scope }) });
  }
  for (const [id, def] of Object.entries(ce.def.fields)) {
    const v = own(fields, id);
    if (def.type !== "int" || typeof v !== "number") continue;
    fields[id] = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, v));
  }
  return fields;
}

/**
 * Every derived value of an actor, in the §4.4 order: base fields → base effects → derived (topological order) →
 * derived effects. Pure; throws ExprError when a value an expression needs is missing.
 */
export function deriveValues({
  compiled,
  entity,
  values,
}: {
  compiled: CompiledRuleset;
  entity: string;
  values: ActorValues;
}): Record<string, number> {
  const ce = entityOf({ compiled, entity });
  const fields = applyBaseEffects({ compiled, entity, values });
  const derived: Record<string, number> = {};
  const scope = actorScope({ fields, derived, resources: values.resources, party: values.party });
  for (const d of ce.derived) derived[d.id] = evaluateInt({ expr: d.expr, scope });
  for (const eff of activeEffects({ effects: ce.effects, conditions: values.conditions ?? [] })) {
    const current = own(derived, eff.target);
    if (eff.phase !== "derived" || current === undefined) continue;
    if (eff.when !== null && !evaluateBool({ expr: eff.when, scope })) continue;
    derived[eff.target] = applyMode({ mode: eff.mode, current, value: evaluateInt({ expr: eff.value, scope }) });
  }
  return derived;
}

/** A resource's bounds for one holder. A max below the min collapses to the min. `max: null` = no ceiling. */
export function resourceBounds({
  compiled,
  resource,
  scope,
}: {
  compiled: CompiledRuleset;
  resource: string;
  scope: ExprRecord;
}): { min: number; max: number | null; capped: boolean } {
  const cr = own(compiled.resources, resource);
  if (cr === undefined) throw new Error(`unknown resource "${resource}"`);
  const min = evaluateInt({ expr: cr.min, scope });
  const max = cr.max === null ? null : Math.max(min, evaluateInt({ expr: cr.max, scope }));
  return { min, max, capped: cr.def.capped };
}

/** The value a resource resets to on an event, or null when it does not reset then. */
export function resetValue({
  compiled,
  resource,
  event,
  scope,
}: {
  compiled: CompiledRuleset;
  resource: string;
  event: ResetEvent;
  scope: ExprRecord;
}): number | null {
  const cr = own(compiled.resources, resource);
  const reset = cr?.resetOn.find((r) => r.event === event);
  if (cr === undefined || reset === undefined) return null;
  const { min, max } = resourceBounds({ compiled, resource, scope });
  return evaluateInt({ expr: reset.to, scope: { ...scope, min, ...(max === null ? {} : { max }) } });
}

/** Every event a resource resets on, with the value it resets to for one holder. The caller hands this to the `rest` primitive. */
export function resetValues({
  compiled,
  resource,
  scope,
}: {
  compiled: CompiledRuleset;
  resource: string;
  scope: ExprRecord;
}): Partial<Record<ResetEvent, number>> {
  const out: Partial<Record<ResetEvent, number>> = {};
  for (const r of own(compiled.resources, resource)?.resetOn ?? []) {
    const to = resetValue({ compiled, resource, event: r.event, scope });
    if (to !== null) out[r.event] = to;
  }
  return out;
}

/** The overflow that kills outright for a health track's resource, or null when the ruleset declares none. */
export function instantDeathAt({
  compiled,
  resource,
  scope,
}: {
  compiled: CompiledRuleset;
  resource: string;
  scope: ExprRecord;
}): number | null {
  const expr = own(compiled.instantDeath, resource);
  return expr === undefined ? null : evaluateInt({ expr, scope });
}

/** The display health states (`bloodied`…) that apply to an actor of this type and whose condition holds for it. */
export function healthStatesOf({
  compiled,
  entity,
  scope,
}: {
  compiled: CompiledRuleset;
  entity: string;
  scope: ExprRecord;
}): string[] {
  return compiled.healthStates
    .filter((s) => (s.entities === null || s.entities.includes(entity)) && evaluateBool({ expr: s.when, scope }))
    .map((s) => s.id);
}
