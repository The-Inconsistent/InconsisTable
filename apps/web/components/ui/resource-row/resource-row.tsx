"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

type ResourceRowProps = {
  label: string;
  /** Drawn in the label's place (a name that opens what it means); the label still names the buttons. */
  title?: ReactNode;
  /** The resource's id: a structural hook for the Theme (never its label). */
  stat?: string;
  value: number;
  /** Bounds for this holder, when they can be worked out; the − and + stop at them. */
  range: { min: number; max: number | null } | null;
  steps: { dec: boolean; inc: boolean };
  /** Names the holder in the buttons' labels ("Decrease HP of Ash"). */
  holder: string;
  /** Under the label: when it refills, its cite. */
  note?: ReactNode;
  onStep: (delta: number) => void;
};

// One resource with its − and + (44px each), as the sheet and the combat tracker show them. A button the seat may not
// press is not drawn at all: "tell the GM" is the rule for everything else.
export function ResourceRow({ stat, label, title, value, range, steps, holder, note, onStep }: ResourceRowProps) {
  const t = useTranslations("resourceRow");
  return (
    <div className="sheet-row" data-stat={stat} data-kind="resource">
      <div className="stack" style={{ gap: 2 }}>
        <span className="stat-label">{title ?? label}</span>
        {note}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {steps.dec && (
          <button
            className="btn step"
            aria-label={t("decrease", { label, holder })}
            disabled={range !== null && value <= range.min}
            onClick={() => onStep(-1)}
          >
            −
          </button>
        )}
        <strong
          className="sheet-num"
          aria-label={
            range?.max != null ? t("valueOf", { label, value, max: range.max }) : t("value", { label, value })
          }
        >
          {value}
          {range?.max != null && <span className="dim small"> / {range.max}</span>}
        </strong>
        {steps.inc && (
          <button
            className="btn step"
            aria-label={t("increase", { label, holder })}
            disabled={range?.max != null && value >= range.max}
            onClick={() => onStep(1)}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
