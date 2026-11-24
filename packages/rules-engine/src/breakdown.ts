import { entrySourceId, type CompiledRuleset } from "./compile.ts";
import { deriveValues, type ActorValues } from "./derived.ts";
import { own } from "./own.ts";
import { canSee, type Viewer } from "./view.ts";

/** One line of "why is Defense 5": where the amount comes from, and the page that says so. */
export interface BreakdownLine {
  source: string;
  amount: number;
  cite: string | null;
  /** The GM's override over the worked-out value (house decision #96): the last line, by what it changes. */
  override?: boolean;
}

/**
 * The sources behind one derived value: the base (the formula, plus anything this viewer may not see), then each
 * visible active condition with what it adds or takes away. `total` is the value the server sent, so the lines always
 * add up to it and a hidden condition is folded into the base, never named. Null when the value cannot be worked out
 * here (a field it reads is hidden from this seat): show the cite only.
 */
// ponytail: a condition's amount is the value with it minus the value without it, so two conditions that interact
// show their shares of the interaction as they come; per-effect lines when a ruleset needs them.
export function breakdownOf({
  compiled,
  entity,
  derivedId,
  values,
  total,
  viewer,
  actorId,
}: {
  compiled: CompiledRuleset;
  entity: string;
  derivedId: string;
  values: ActorValues;
  total: number;
  viewer?: Viewer;
  actorId?: string;
}): BreakdownLine[] | null {
  const ce = own(compiled.entities, entity);
  const def = ce?.def.derived.find((d) => d.id === derivedId);
  if (def === undefined) return null;
  // An override set: the worked-out value's lines, then the override by what it changes (house decision #96).
  const set = def.override === undefined ? undefined : own(values.fields, def.override);
  if (def.override !== undefined && typeof set === "number") {
    const { [def.override]: _set, ...fields } = values.fields;
    const worked = { ...values, fields };
    let workedOut: number;
    try {
      workedOut = deriveValues({ compiled, entity, values: worked })[derivedId] ?? 0;
    } catch {
      return null;
    }
    const lines = breakdownOf({ compiled, entity, derivedId, values: worked, total: workedOut, viewer, actorId });
    const label = own(ce?.def.fields ?? {}, def.override)?.label ?? def.override;
    return lines && [...lines, { source: label, amount: set - workedOut, cite: null, override: true }];
  }
  const visible = [...new Set(values.conditions ?? [])].filter((id) => {
    const cond = own(compiled.conditions, id);
    return (
      cond !== undefined &&
      (viewer === undefined || canSee({ visibility: cond.visibility, viewer, actorId: actorId ?? "" }))
    );
  });
  // Chosen entries are shown to every viewer: what they add is in the number whoever looks (house decision #61).
  const entries = [...new Map((values.entries ?? []).map((e) => [entrySourceId(e), e])).values()];
  const valueWith = (conditions: string[], held: typeof entries) =>
    deriveValues({ compiled, entity, values: { ...values, conditions, entries: held } })[derivedId] ?? 0;
  // Without a source that sets a field the formula reads (a base-phase override on an unset field), the value cannot
  // be worked out: that source is credited with the whole value, and the base is what is left.
  const valueWithout = (conditions: string[], held: typeof entries) => {
    try {
      return valueWith(conditions, held);
    } catch {
      return 0;
    }
  };
  try {
    const all = valueWith(visible, entries);
    const lines = [
      ...visible.flatMap((id): BreakdownLine[] => {
        const cond = own(compiled.conditions, id);
        const amount =
          all -
          valueWithout(
            visible.filter((c) => c !== id),
            entries,
          );
        return cond === undefined || amount === 0
          ? []
          : [{ source: cond.label, amount, cite: cond.effects.find((e) => e.cite)?.cite ?? cond.cite ?? null }];
      }),
      ...entries.flatMap((entry): BreakdownLine[] => {
        const amount =
          all -
          valueWithout(
            visible,
            entries.filter((e) => e !== entry),
          );
        return amount === 0
          ? []
          : [{ source: entry.name, amount, cite: entry.effects.find((e) => e.cite)?.cite ?? null }];
      }),
    ];
    const base = total - lines.reduce((sum, l) => sum + l.amount, 0);
    return [{ source: def.label, amount: base, cite: def.cite ?? null }, ...lines];
  } catch {
    return null;
  }
}
