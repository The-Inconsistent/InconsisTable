"use client";
import { useTranslations } from "next-intl";

import type { PickLine } from "@inconsistable/core-schema";

import { RowChips } from "@/components/ui/entry-fields/entry-fields";
import { rowName } from "@/lib/entry-fields/entry-fields";
import { pickedField, pickedRows, type PrepWorld } from "@/lib/scene-prep/scene-prep";

type PickedRowsProps = {
  line: PickLine;
  world: PrepWorld;
  /** Flips one row's switch; the scene's prep is saved whole, as any line change is. */
  onSwitch: (rowId: string) => void;
  busy: boolean;
};

// A pick line at the table (house decision #89): each picked row as its chips, with the switch the ruleset names, read
// and ticked during play. A row its entry no longer holds is shown broken and has no switch.
export function PickedRows({ line, world, onSwitch, busy }: PickedRowsProps) {
  const t = useTranslations("prep");
  const field = pickedField({ line, world });
  if (!field || !field.def.pick) return null;
  const label = field.def.pick.label;
  return (
    <ul className="list" aria-label={t("pickedRows", { field: field.def.label })} style={{ flexBasis: "100%" }}>
      {pickedRows({ line, world }).map(({ rowId, on, row }) => (
        <li key={rowId} className="row between" data-state={on ? "on" : undefined} style={{ flexWrap: "wrap" }}>
          {row ? (
            <>
              <RowChips ruleset={world.ruleset ?? null} def={field.def} row={row} />
              <button
                className="btn"
                aria-pressed={on}
                aria-label={t("switchRow", { label, row: rowName({ def: field.def, row }) })}
                disabled={busy}
                onClick={() => onSwitch(rowId)}
              >
                {on ? `✓ ${label}` : label}
              </button>
            </>
          ) : (
            <span className="chip" data-state="broken">
              {t("missing.row")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
