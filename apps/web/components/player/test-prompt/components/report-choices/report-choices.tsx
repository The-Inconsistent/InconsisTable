"use client";
import { useTranslations } from "next-intl";

import type { ChoiceSpec, TestChoiceValues } from "@inconsistable/core-schema";

type ReportChoicesProps = {
  /** What the Test lets its taker choose while reporting (house decision #170). */
  choices: readonly ChoiceSpec[];
  /** What is chosen so far; a choice left out is off, or 0. */
  values: TestChoiceValues;
  /** Who is reporting, for the screen reader. */
  who: string;
  onChange: (values: TestChoiceValues) => void;
};

// What the taker chooses before reporting, such as a point spent to lower the number: a switch, or a number from 0 to
// its max. The phone only says what was chosen; the server works out what it changes.
export function ReportChoices({ choices, values, who, onChange }: ReportChoicesProps) {
  const t = useTranslations("testPrompt");

  // SET: one choice's new value, the others kept.
  const handleSet = (id: string, value: boolean | number) => onChange({ ...values, [id]: value });

  return (
    <div className="stack small" role="group" aria-label={t("choicesFor", { who })}>
      {choices.map((c) => {
        if (c.max === undefined) {
          const on = values[c.id] === true;
          return (
            <button key={c.id} className="btn" aria-pressed={on} onClick={() => handleSet(c.id, !on)}>
              {c.label}
            </button>
          );
        }
        const n = typeof values[c.id] === "number" ? (values[c.id] as number) : 0;
        return (
          <div key={c.id} className="row" style={{ alignItems: "center", gap: 8 }}>
            <span>{c.label}</span>
            <button
              className="btn"
              aria-label={t("less", { label: c.label })}
              disabled={n <= 0}
              onClick={() => handleSet(c.id, n - 1)}
            >
              −
            </button>
            <b aria-live="polite">{n}</b>
            <button
              className="btn"
              aria-label={t("more", { label: c.label })}
              disabled={n >= c.max}
              onClick={() => handleSet(c.id, n + 1)}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}
