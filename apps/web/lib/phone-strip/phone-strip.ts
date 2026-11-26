import type { LayoutRow, Ruleset } from "@inconsistable/rules-engine";

import { rowFor, widgetOf, type SheetActor, type SheetRow } from "@/lib/sheet-widgets/sheet-widgets";

// The phone's strip (house decision #115): the short values the ruleset's `phoneStrip` rows name, in order, drawn as
// label and value on every tab, and folded into one line on scroll.

/** One value of the strip, and the limit a track row draws it against. */
export type StripCell = { row: SheetRow; max: SheetRow | null };

/**
 * The strip's values for this character: a path row's own value, then each widget's values as the sheet reads them (a
 * strip's title and values, a grid's totals or ratings, a sum's total, a track's counter with its limit); a widget that
 * lists records draws none here. Only what the seat was sent.
 */
export function stripCellsOf({
  ruleset,
  actor,
  rows,
}: {
  ruleset: Ruleset;
  actor: SheetActor;
  rows: readonly LayoutRow[];
}): StripCell[] {
  const plain = (list: readonly SheetRow[]) => list.map((row) => ({ row, max: null }));
  return rows.flatMap((r): StripCell[] => {
    if (typeof r === "string") {
      const row = rowFor({ ruleset, actor, path: r });
      return row ? [{ row, max: null }] : [];
    }
    const m = widgetOf({ ruleset, actor, row: r });
    switch (m?.widget) {
      case "strip":
        return plain([...(m.title ? [m.title] : []), ...m.values]);
      case "grid":
        return plain(m.rows.map((g) => g.total ?? g.rating));
      case "frames":
        return plain(m.values);
      case "sum":
        return plain([m.total]);
      case "track":
        return [{ row: m.value, max: m.max }];
      case "pips":
        return plain([m.value]);
      default:
        return [];
    }
  });
}
