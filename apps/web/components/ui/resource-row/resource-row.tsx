"use client";
import type { ReactNode } from "react";

type ResourceRowProps = {
  label: string;
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
export function ResourceRow({ label, value, range, steps, holder, note, onStep }: ResourceRowProps) {
  return (
    <div className="sheet-row">
      <div className="stack" style={{ gap: 2 }}>
        <span>{label}</span>
        {note}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {steps.dec && (
          <button
            className="btn step"
            aria-label={`Decrease ${label} of ${holder}`}
            disabled={range !== null && value <= range.min}
            onClick={() => onStep(-1)}
          >
            −
          </button>
        )}
        <strong className="sheet-num" aria-label={`${label}: ${value}${range?.max != null ? ` of ${range.max}` : ""}`}>
          {value}
          {range?.max != null && <span className="dim small"> / {range.max}</span>}
        </strong>
        {steps.inc && (
          <button
            className="btn step"
            aria-label={`Increase ${label} of ${holder}`}
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
