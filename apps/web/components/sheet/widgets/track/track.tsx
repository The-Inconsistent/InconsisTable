"use client";
import { useTranslations } from "next-intl";

import { Term } from "@/components/ui/term-card/term-card";
import { numberOf, type SheetRow, termOf } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";
import { MAX_TRACK_BOXES } from "./constants";

type TrackProps = { value: SheetRow; max: SheetRow | null; env: WidgetEnv };

// A counter with its limit: the counter as the sheet draws it (a resource keeps its steppers and its ask to spend), and
// under it a box for each point of the limit, filled up to the count. Without a limit there are no boxes.
export function Track({ value, max, env }: TrackProps) {
  const t = useTranslations("sheet.widget");
  const n = numberOf({ actor: env.actor, row: value });
  const limit = max
    ? numberOf({ actor: env.actor, row: max })
    : value.kind === "resource"
      ? env.range(value.id)?.max
      : null;
  return (
    <div className="w-track">
      {value.kind === "resource" ? (
        env.rowView(value)
      ) : (
        <div className="sheet-row" data-stat={value.id} data-kind={value.kind}>
          <Term term={termOf(value)} env={env} className="stat-label" />
          <strong className="sheet-num">
            {n}
            {limit != null && <span className="dim small"> / {limit}</span>}
          </strong>
        </div>
      )}
      {limit != null && limit > 0 && limit <= MAX_TRACK_BOXES && (
        <div className="w-boxes" role="img" aria-label={t("trackOf", { label: value.label, value: n, max: limit })}>
          {Array.from({ length: limit }, (_, i) => (
            <i key={i} className="w-box" data-on={i < n || undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
