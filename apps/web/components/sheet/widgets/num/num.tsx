"use client";
import { useTranslations } from "next-intl";

import { numberOf, type SheetRow } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";

type NumProps = {
  row: SheetRow;
  env: WidgetEnv;
  className?: string;
  /** How the number prints (a signed bonus); its own digits by default. */
  format?: (n: number) => string;
};

// One number of a widget. A derived value is a button that opens where it comes from, as on the plain sheet rows.
export function Num({ row, env, className = "", format = String }: NumProps) {
  const t = useTranslations("sheet");
  const n = numberOf({ actor: env.actor, row });
  if (row.kind !== "derived")
    return (
      <span className={className} data-stat={row.id}>
        {format(n)}
      </span>
    );
  return (
    <button
      className={`w-num-btn ${className}`}
      data-stat={row.id}
      aria-label={t("showWhere", { label: row.label, value: n })}
      onClick={() => env.onOpen(row.id)}
    >
      {format(n)}
    </button>
  );
}
