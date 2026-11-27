"use client";
import { useTranslations } from "next-intl";

import type { CampaignField } from "@inconsistable/rules-engine";

import { controlOf } from "@/lib/campaign-field/campaign-field";
import type { CampaignValue } from "@/lib/games/room-document";

type CampaignStepProps = {
  fields: Readonly<Record<string, CampaignField>>;
  values: Readonly<Record<string, CampaignValue>>;
  onChange: (change: { id: string; value: CampaignValue }) => void;
};

// CAMPAIGN: the values the game declares for the whole campaign (house decisions #55, #58), each at its default until
// the GM picks another, with the same controls the Rules tab gives them.
export function CampaignStep({ fields, values, onChange }: CampaignStepProps) {
  const t = useTranslations("rulesPanel");
  return (
    <div className="stack">
      {Object.entries(fields).map(([id, field]) => {
        const control = controlOf(field);
        const value = values[id] ?? field.default;
        return (
          <fieldset key={id} className="row between" style={{ border: 0, margin: 0, padding: 0, flexWrap: "wrap" }}>
            <legend className="sr-only">{field.label}</legend>
            <span aria-hidden="true">
              {field.label}
              {field.cite && <span className="small dim"> · {field.cite}</span>}
            </span>
            {control.kind === "number" ? (
              <input
                type="number"
                inputMode="numeric"
                min={control.min}
                max={control.max}
                value={String(value)}
                onChange={(e) => e.target.value !== "" && onChange({ id, value: Number(e.target.value) })}
                aria-label={field.label}
                style={{ width: 90 }}
              />
            ) : (
              <span className="seg" role="group" aria-label={field.label} style={{ flexWrap: "wrap" }}>
                {(control.kind === "switch" ? [true, false] : control.options).map((o) => (
                  <button
                    key={String(o)}
                    type="button"
                    className="btn"
                    aria-pressed={value === o}
                    onClick={() => onChange({ id, value: o })}
                  >
                    {typeof o === "boolean" ? t(o ? "on" : "off") : String(o)}
                  </button>
                ))}
              </span>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
