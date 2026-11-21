import type { Actor, HeldRecord } from "@inconsistable/core-schema";
import type { Ruleset, WidgetRow, WidgetVariant } from "@inconsistable/rules-engine";

import { sheetLinesOf, type LedgerSheetLines } from "../ledger/table.ts";

// The rows a layout row draws for one character (house decision #83): a path becomes a value row, a widget row a model
// of the widget holding only the values this seat received. A slot whose value was not sent draws as absent, and a
// widget with nothing left to draw is not drawn, so a hidden value never shows as an empty frame with its label.

export type SheetActor = Pick<Actor, "entity" | "fields" | "resources" | "derived"> & {
  ledger?: Actor["ledger"] | undefined;
  held?: Actor["held"] | undefined;
};

/** One kind of record an actor holds, as the `held` widget lists it (house decision #88). */
export type HeldGroup = { kind: string; label: string; records: HeldRecord[] };

/** What one effect of a held record does, for the sheet to word: the label of what it changes, and its amount when
 * that is a whole number (anything else is shown as the importer wrote it). */
export function effectOf({
  ruleset,
  entity,
  effect,
}: {
  ruleset: Ruleset;
  entity: string;
  effect: HeldRecord["effects"][number];
}): { label: string; by: number | null; mode: string; value: string } {
  const e = ruleset.entities.find((x) => x.id === entity);
  const id = effect.path.startsWith("derived.") ? effect.path.slice("derived.".length) : effect.path;
  const label =
    e?.derived.find((d) => d.id === id)?.label ??
    (e && Object.hasOwn(e.fields, id) ? e.fields[id]?.label : undefined) ??
    ruleset.resources.find((r) => r.id === id)?.label ??
    id;
  const n = Number(effect.value);
  return { label, by: effect.mode === "add" && Number.isInteger(n) ? n : null, mode: effect.mode, value: effect.value };
}

export type SheetRow = {
  kind: "field" | "derived" | "resource";
  id: string;
  label: string;
  cite: string | null;
};

/**
 * The value a layout path names for this character. `derived.x` and `res.x` name those kinds outright; a bare path is
 * a field, else a derived value, else a resource. A path the seat holds no value for is null (it may be hidden).
 */
export function rowFor({
  ruleset,
  actor,
  path,
}: {
  ruleset: Ruleset;
  actor: SheetActor;
  path: string;
}): SheetRow | null {
  const def = ruleset.entities.find((e) => e.id === actor.entity);
  const field = () =>
    Object.hasOwn(actor.fields, path) && def && Object.hasOwn(def.fields, path)
      ? {
          kind: "field" as const,
          id: path,
          label: def.fields[path]?.label ?? path,
          cite: def.fields[path]?.cite ?? null,
        }
      : null;
  const derived = (id: string) => {
    const d = def?.derived.find((x) => x.id === id);
    return d && Object.hasOwn(actor.derived, id)
      ? { kind: "derived" as const, id, label: d.label, cite: d.cite ?? null }
      : null;
  };
  const resource = (id: string) => {
    const r = ruleset.resources.find((x) => x.id === id);
    return r && Object.hasOwn(actor.resources, id)
      ? { kind: "resource" as const, id, label: r.label, cite: r.cite ?? null }
      : null;
  };
  if (path.startsWith("derived.")) return derived(path.slice(8));
  if (path.startsWith("res.")) return resource(path.slice(4));
  return field() ?? derived(path) ?? resource(path);
}

/** A row of a rated-value grid: its rating and, when the column is drawn, its bonus, total and linked value. */
export type GridRow = { rating: SheetRow; bonus: SheetRow | null; total: SheetRow | null; link: SheetRow | null };
export type PipStep = { label: string; size: number };

export type WidgetModel =
  | { widget: "strip"; label: string | null; title: SheetRow | null; values: SheetRow[] }
  | {
      widget: "grid";
      variant: WidgetVariant<"grid">;
      label: string | null;
      rows: GridRow[];
      /** A column is drawn only when every row received its value. */
      columns: { bonus: boolean; total: boolean; link: boolean };
    }
  | { widget: "frames"; label: string | null; values: SheetRow[] }
  /** Without every part, the total stands alone: a sum that does not add up would show a part is hidden. */
  | { widget: "sum"; label: string | null; parts: SheetRow[]; total: SheetRow }
  | { widget: "track"; label: string | null; value: SheetRow; max: SheetRow | null }
  | { widget: "pips"; label: string | null; value: SheetRow; steps: PipStep[] }
  | { widget: "cards"; variant: WidgetVariant<"cards">; label: string | null; lines: LedgerSheetLines }
  | { widget: "folds"; variant: WidgetVariant<"folds">; label: string | null; lines: LedgerSheetLines }
  | { widget: "notes"; label: string | null; fields: SheetRow[] }
  | { widget: "held"; label: string | null; groups: HeldGroup[] };

const pathsOf = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

/** One widget row as this seat draws it, or null when nothing in it reached the seat (or the widget is not known). */
export function widgetOf({
  ruleset,
  actor,
  row,
}: {
  ruleset: Ruleset;
  actor: SheetActor;
  row: WidgetRow;
}): WidgetModel | null {
  const one = (slot: string) => {
    const path = pathsOf(row.bind[slot])[0];
    return path === undefined ? null : rowFor({ ruleset, actor, path });
  };
  const many = (slot: string) => pathsOf(row.bind[slot]).flatMap((path) => rowFor({ ruleset, actor, path }) ?? []);
  // A list slot read row by row: null where the seat holds no value.
  const aligned = (slot: string) => pathsOf(row.bind[slot]).map((path) => rowFor({ ruleset, actor, path }));
  const label = row.label ?? null;
  const lines = () => sheetLinesOf(actor.ledger?.sheet);
  switch (row.widget) {
    case "strip": {
      const title = one("title");
      const values = many("values");
      return title || values.length > 0 ? { widget: "strip", label, title, values } : null;
    }
    case "grid": {
      const variant = row.variant === "pairs" ? "pairs" : "columns";
      const [bonus, total, link] = [aligned("bonus"), aligned("total"), aligned("link")];
      const rows = aligned("ratings").flatMap((rating, i) =>
        rating ? [{ rating, bonus: bonus[i] ?? null, total: total[i] ?? null, link: link[i] ?? null }] : [],
      );
      if (rows.length === 0) return null;
      const every = (key: "bonus" | "total" | "link") => rows.every((r) => r[key] !== null);
      return {
        widget: "grid",
        variant,
        label,
        rows,
        columns: { bonus: every("bonus"), total: every("total"), link: every("link") },
      };
    }
    case "frames": {
      const values = many("values");
      return values.length > 0 ? { widget: "frames", label, values } : null;
    }
    case "sum": {
      const total = one("total");
      const bound = pathsOf(row.bind.parts);
      const parts = many("parts");
      return total ? { widget: "sum", label, parts: parts.length === bound.length ? parts : [], total } : null;
    }
    case "track": {
      const value = one("value");
      return value ? { widget: "track", label, value, max: one("max") } : null;
    }
    case "pips": {
      const value = one("value");
      return value && row.steps ? { widget: "pips", label, value, steps: row.steps } : null;
    }
    case "cards": {
      const l = lines();
      const variant = (["armour", "gear", "powers"] as const).find((v) => v === row.variant) ?? "weapons";
      const has = l && (variant === "armour" ? l.armour !== null : l[variant].length > 0);
      return l && has ? { widget: "cards", variant, label, lines: l } : null;
    }
    case "folds": {
      const l = lines();
      const variant = (["talents", "abilities"] as const).find((v) => v === row.variant) ?? "both";
      const count = l ? (variant === "both" ? l.talents.length + l.abilities.length : l[variant].length) : 0;
      return l && count > 0 ? { widget: "folds", variant, label, lines: l } : null;
    }
    case "notes": {
      const fields = many("fields");
      return fields.length > 0 ? { widget: "notes", label, fields } : null;
    }
    case "held": {
      const groups = Object.entries(ruleset.held ?? {}).flatMap(([kind, k]) => {
        const records = (actor.held ?? []).filter((r) => r.kind === kind);
        return records.length > 0 ? [{ kind, label: k.label, records }] : [];
      });
      return groups.length > 0 ? { widget: "held", label, groups } : null;
    }
    default:
      return null;
  }
}

/** The kinds of the saved build's lines a layout draws through widgets: the sheet leaves them out of its own list. */
export function ledgerLaidOut(models: readonly WidgetModel[]): Set<string> {
  const out = new Set<string>();
  for (const m of models) {
    if (m.widget === "cards") out.add(m.variant);
    if (m.widget === "folds") for (const k of m.variant === "both" ? ["talents", "abilities"] : [m.variant]) out.add(k);
  }
  return out;
}

/** The value a row stands for on this character, as the server sent it. */
export function valueOf({ actor, row }: { actor: SheetActor; row: SheetRow }) {
  if (row.kind === "derived") return actor.derived[row.id];
  if (row.kind === "resource") return actor.resources[row.id];
  return actor.fields[row.id];
}

/** A row's value as a number; 0 when it is not one. */
export const numberOf = ({ actor, row }: { actor: SheetActor; row: SheetRow }): number => {
  const v = valueOf({ actor, row });
  return typeof v === "number" ? v : 0;
};

/** The bonus a grid prints: signed, with a true minus. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** How many pips each step fills for a count: full steps, then the rest, then none. */
export function pipsFilled({ value, steps }: { value: number; steps: readonly PipStep[] }): number[] {
  let left = Math.max(0, value);
  return steps.map((s) => {
    const filled = Math.min(left, s.size);
    left -= filled;
    return filled;
  });
}

/** The step a count has reached: the last with a pip filled; -1 at none. */
export function stepReached({ value, steps }: { value: number; steps: readonly PipStep[] }): number {
  return pipsFilled({ value, steps }).findLastIndex((n) => n > 0);
}
