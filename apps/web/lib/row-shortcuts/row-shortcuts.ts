import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

// A tracker row's shortcuts (house decision #92), from the plain paths of the layout's `trackerRow` target (#83): an enum
// field is shown as the row's tag with its note, an entity resource gets a stepper. Widget rows are left to the layer
// that draws `trackerRow` whole; a value the seat was not sent is left out.

export interface RowTag {
  field: string;
  label: string;
  note: string | null;
}

export interface RowStepper {
  resource: string;
  label: string;
  value: number;
}

export function rowShortcutsOf({ ruleset, actor }: { ruleset: Ruleset | null | undefined; actor: Actor | undefined }): {
  tags: RowTag[];
  steppers: RowStepper[];
} {
  const out = { tags: [] as RowTag[], steppers: [] as RowStepper[] };
  if (!ruleset || !actor) return out;
  const rows = (ruleset.layout[actor.entity] ?? ruleset.layout.sheet)?.trackerRow ?? [];
  const entity = ruleset.entities.find((e) => e.id === actor.entity);
  for (const row of rows) {
    if (typeof row !== "string") continue;
    if (row.startsWith("res.")) {
      const id = row.slice(4);
      const value = actor.resources[id];
      const def = ruleset.resources.find((x) => x.id === id);
      if (typeof value === "number" && def !== undefined) out.steppers.push({ resource: id, label: def.label, value });
      continue;
    }
    const def = entity?.fields[row];
    const value = actor.fields[row];
    if (def?.type !== "enum" || typeof value !== "string") continue;
    out.tags.push({ field: row, label: def.labels?.[value] ?? value, note: def.notes?.[value] ?? null });
  }
  return out;
}
