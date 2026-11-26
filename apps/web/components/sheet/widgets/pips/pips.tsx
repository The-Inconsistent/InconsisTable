"use client";
import { useTranslations } from "next-intl";

import { Term } from "@/components/ui/term-card/term-card";
import {
  numberOf,
  type PipStep,
  pipsFilled,
  type SheetRow,
  stepReached,
  termOf,
} from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";

type PipsProps = { value: SheetRow; steps: readonly PipStep[]; env: WidgetEnv };

// Pips in rows, one row per named step, filled up to the count; the step reached is marked by weight and a sign, not
// by colour alone. A resource keeps its steppers above the pips.
export function Pips({ value, steps, env }: PipsProps) {
  const t = useTranslations("sheet.widget");
  const n = numberOf({ actor: env.actor, row: value });
  const filled = pipsFilled({ value: n, steps });
  const now = stepReached({ value: n, steps });
  const step = steps[now]?.label ?? t("noStep");
  return (
    <div className="w-pips-box">
      {value.kind === "resource" ? (
        env.rowView(value)
      ) : (
        <div className="sheet-row" data-stat={value.id} data-kind={value.kind}>
          <span className="stack" style={{ gap: 2 }}>
            <Term term={termOf(value)} env={env} className="stat-label" />
            <span className="small dim">{step}</span>
          </span>
          <strong className="sheet-num">{n}</strong>
        </div>
      )}
      <div className="w-pips" role="img" aria-label={t("pipsOf", { label: value.label, value: n, step })}>
        {steps.map((s, i) => (
          <div key={i} className="w-pip-row" data-now={i === now || undefined}>
            {Array.from({ length: s.size }, (_, j) => (
              <i key={j} className="w-pip" data-on={j < (filled[i] ?? 0) || undefined} />
            ))}
            <b>{s.label}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
