"use client";
import type { ChangeEvent } from "react";

import type { CreationStep, EntityType } from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";
import { summaryOf } from "@/lib/builder/builder";

type ChooseStepProps = {
  step: Extract<CreationStep, { kind: "choose" }>;
  entries: readonly RulesEntry[];
  /** The entity type the picks are of, for the one-line summaries. */
  def: EntityType | undefined;
  value: readonly string[];
  onChange: (keys: string[]) => void;
};

// CHOOSE: pick `count` entries the table has attached, each shown by name, a short summary and its page. One pick is a
// radio; more are checkboxes that stop at the count.
export function ChooseStep({ step, entries, def, value, onChange }: ChooseStepProps) {
  const single = step.count === 1;

  // A pick: replaces the choice (one pick) or toggles it (several), never past the count.
  const handlePick = (key: string) => (e: ChangeEvent<HTMLInputElement>) => {
    if (single) return onChange([key]);
    if (!e.target.checked) return onChange(value.filter((k) => k !== key));
    if (value.length < step.count) onChange([...value, key]);
  };

  if (entries.length === 0)
    return <p className="dim">No {def?.label ?? step.pick} is attached to this table yet. Ask the GM.</p>;
  return (
    <div className="stack" role={single ? "radiogroup" : "group"} aria-label={step.label}>
      {!single && (
        <p className="small dim">
          Pick {step.count}: {value.length} chosen
        </p>
      )}
      {entries.map((e) => (
        <label key={e.key} className="pick">
          <input
            type={single ? "radio" : "checkbox"}
            name={`pick-${step.id}`}
            checked={value.includes(e.key)}
            onChange={handlePick(e.key)}
          />
          <span className="stack" style={{ gap: 2 }}>
            <span className="pick-name">{e.name}</span>
            <span className="small dim">{summaryOf({ entry: e, def })}</span>
            {e.cite && <span className="small dim">{e.cite}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
