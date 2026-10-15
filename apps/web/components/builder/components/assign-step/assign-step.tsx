"use client";
import { useFormatter, useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import type { EntityType } from "@inconsistable/rules-engine";

import { type AssignStep as AssignStepDef, canStep, pointsSpent, tableLeft } from "@/lib/builder/builder";

type AssignStepProps = {
  step: AssignStepDef;
  /** The entity the scores land on, for the field names. */
  def: EntityType | undefined;
  value: Readonly<Record<string, number>>;
  onChange: (scores: Record<string, number>) => void;
};

const labelOf = ({ def, id }: { def: EntityType | undefined; id: string }) => def?.fields[id]?.label ?? id;

// ASSIGN: scores from the ruleset's own table (each value once) or its point buy (a budget, shown as the points left).
// The numbers are the manifest's; the builder never invents a method.
export function AssignStep({ step, def, value, onChange }: AssignStepProps) {
  const t = useTranslations("assignStep");
  const format = useFormatter();
  const method = step.method;

  // TABLE: gives one field the chosen value, or takes it back.
  const handleTable = (field: string) => (e: ChangeEvent<HTMLSelectElement>) => {
    const { [field]: _gone, ...rest } = value;
    onChange(e.target.value === "" ? rest : { ...rest, [field]: Number(e.target.value) });
  };

  if (method.kind === "table") {
    const left = tableLeft({ values: method.values, scores: value });
    return (
      <div className="stack">
        <p className="small dim">
          {t("leftToHandOut", { list: left.length > 0 ? format.list(left.map(String)) : t("none") })}
        </p>
        {step.fields.map((f) => {
          const now = value[f];
          const options = now === undefined ? left : [now, ...left];
          return (
            <label key={f} className="score-row">
              {labelOf({ def, id: f })}
              <select value={now ?? ""} onChange={handleTable(f)} style={{ minWidth: 96 }}>
                <option value="">–</option>
                {[...new Set(options)]
                  .toSorted((a, b) => b - a)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          );
        })}
      </div>
    );
  }

  const scores = Object.fromEntries(step.fields.map((f) => [f, value[f] ?? method.min]));
  const left = method.budget - pointsSpent({ method, scores });

  // POINT BUY: moves one field a step; every field is then answered at its current (or minimum) score.
  const handleBuy = ({ field, by }: { field: string; by: 1 | -1 }) => {
    if (canStep({ method, scores, field, by })) onChange({ ...scores, [field]: scores[field]! + by }); // field is a key of scores
  };

  return (
    <div className="stack">
      <p className="row" aria-live="polite">
        <span className="points-left">{left}</span>
        <span className="dim">{t("pointsLeft", { budget: method.budget })}</span>
      </p>
      {step.fields.map((f) => (
        <div key={f} className="score-row">
          <span>{labelOf({ def, id: f })}</span>
          <span className="stepper">
            <button
              type="button"
              className="btn"
              aria-label={t("lower", { label: labelOf({ def, id: f }) })}
              disabled={!canStep({ method, scores, field: f, by: -1 })}
              onClick={() => handleBuy({ field: f, by: -1 })}
            >
              −
            </button>
            <output aria-label={t("score", { label: labelOf({ def, id: f }) })}>{scores[f]}</output>
            <button
              type="button"
              className="btn"
              aria-label={t("raise", { label: labelOf({ def, id: f }) })}
              disabled={!canStep({ method, scores, field: f, by: 1 })}
              onClick={() => handleBuy({ field: f, by: 1 })}
            >
              +
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
