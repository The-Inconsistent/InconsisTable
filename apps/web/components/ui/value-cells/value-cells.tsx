"use client";
import { useTranslations } from "next-intl";

import type { StripCell } from "@/lib/phone-strip/phone-strip";
import { numberOf, valueOf, type SheetActor } from "@/lib/sheet-widgets/sheet-widgets";
import { printValue } from "@/lib/sheet/sheet";

type ValueCellsProps = {
  actor: SheetActor;
  cells: readonly StripCell[];
  /** A resource's limit for this character, when a cell has no bound one. */
  maxOf: (resource: string) => number | null;
};

// Short values in a row, each its label over its value and, for a track, the limit after a slash (house decision
// #115). Read only: the steppers and asks stay on the Sheet tab.
export function ValueCells({ actor, cells, maxOf }: ValueCellsProps) {
  const t = useTranslations("sheet");
  return (
    <dl className="value-cells">
      {cells.map(({ row, max }, i) => {
        const limit = max ? numberOf({ actor, row: max }) : row.kind === "resource" ? maxOf(row.id) : null;
        return (
          <div key={`${row.kind}-${row.id}-${i}`} className="value-cell" data-stat={row.id}>
            <dt>{row.label}</dt>
            <dd>
              {printValue({ value: valueOf({ actor, row }), yes: t("yes"), no: t("no") })}
              {limit != null && <span className="value-max"> / {limit}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
