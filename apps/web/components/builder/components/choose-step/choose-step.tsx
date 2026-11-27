"use client";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import type { CreationStep, EntityType } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
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
  const t = useTranslations("chooseStep");
  const single = step.count === 1;

  // A pick: replaces the choice (one pick) or toggles it (several), never past the count.
  const handlePick = (key: string) => (e: ChangeEvent<HTMLInputElement>) => {
    if (single) return onChange([key]);
    if (!e.target.checked) return onChange(value.filter((k) => k !== key));
    if (value.length < step.count) onChange([...value, key]);
  };

  if (entries.length === 0) return <p className="dim">{t("none", { label: def?.label ?? step.pick })}</p>;
  return (
    <div className="stack" role={single ? "radiogroup" : "group"} aria-label={step.label}>
      {!single && <p className="small dim">{t("pickCount", { count: step.count, chosen: value.length })}</p>}
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
            {e.cite && <Cite cite={e.cite} />}
          </span>
        </label>
      ))}
    </div>
  );
}
