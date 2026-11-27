"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { BookSource, LiveState } from "@inconsistable/core-schema";
import type { CampaignField, Ruleset } from "@inconsistable/rules-engine";

import { TermMark, type TermEnv } from "@/components/ui/term-card/term-card";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { controlOf } from "@/lib/campaign-field/campaign-field";
import { anchorId } from "@/lib/checklist/checklist";

type Value = number | string | boolean;
type CampaignSettingsProps = {
  ruleset: Ruleset | null;
  state: LiveState;
  send: Send;
  canEdit: boolean;
  /** The served books and the page relay, for a field's ⓘ (house decision #126). */
  books: readonly BookSource[];
  requestPage: RequestPage;
};
type FieldRowProps = {
  id: string;
  field: CampaignField;
  value: Value;
  busy: boolean;
  canEdit: boolean;
  onSet: (id: string, value: Value) => void;
  terms: TermEnv | undefined;
};

// One field: label on the left with its ⓘ when the ruleset says what it means, its control (or just the value,
// read-only) on the right.
function FieldRow({ id, field, value, busy, canEdit, onSet, terms }: FieldRowProps) {
  const t = useTranslations("rulesPanel");
  const control = controlOf(field);
  const [draft, setDraft] = useState(String(value));
  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(n) && n !== value;

  // Number input: sends the typed value; the api refuses one outside min and max.
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSet(id, n);
  };

  const shown = typeof value === "boolean" ? t(value ? "on" : "off") : String(value);
  return (
    <fieldset className="row between" style={{ border: 0, margin: 0, padding: 0 }} disabled={busy}>
      <legend className="sr-only">{field.label}</legend>
      <span>
        <span aria-hidden="true">{field.label}</span>
        <TermMark term={field} env={terms} />
      </span>
      {!canEdit ? (
        <strong>{shown}</strong>
      ) : control.kind === "number" ? (
        <form className="row" onSubmit={handleSubmit}>
          <input
            type="number"
            inputMode="numeric"
            min={control.min}
            max={control.max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={field.label}
            style={{ width: 90 }}
          />
          <button className="btn sm" type="submit" disabled={!valid}>
            {t("save")}
          </button>
        </form>
      ) : (
        <span className="seg" role="group" aria-label={field.label}>
          {(control.kind === "switch" ? [true, false] : control.options).map((o) => (
            <button
              key={String(o)}
              type="button"
              className="btn"
              aria-pressed={value === o}
              onClick={() => onSet(id, o)}
            >
              {typeof o === "boolean" ? t(o ? "on" : "off") : String(o)}
            </button>
          ))}
        </span>
      )}
    </fieldset>
  );
}

// CAMPAIGN SETTINGS: the values the pinned ruleset declares for the whole campaign (house decisions #55, #58). A seat
// that may update the campaign sets them, any time; the others read them. Nothing here locks during a session.
export function CampaignSettings({ ruleset, state, send, canEdit, books, requestPage }: CampaignSettingsProps) {
  const t = useTranslations("rulesPanel");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = Object.entries(ruleset?.campaignFields ?? {});
  if (fields.length === 0) return null;

  // Sends one value; a refusal shows under that row.
  const handleSet = async (id: string, value: Value) => {
    setBusy(id);
    const r = await send({ type: "campaign.setField", fieldId: id, value });
    setBusy(null);
    setErrors(({ [id]: _old, ...rest }) => (r.ok ? rest : { ...rest, [id]: r.error }));
  };

  return (
    <section className="stack" id={anchorId("settings")} tabIndex={-1}>
      <h2 className="head">{t("settings")}</h2>
      <p className="small dim">{t("settingsHint")}</p>
      {fields.map(([id, field]) => (
        <div key={id} className="stack" style={{ gap: 4 }}>
          <FieldRow
            id={id}
            field={field}
            value={state.campaign.fields[id] ?? field.default}
            busy={busy === id}
            canEdit={canEdit}
            onSet={handleSet}
            terms={ruleset ? { ruleset, books, requestPage } : undefined}
          />
          {errors[id] && (
            <p className="error" role="alert">
              {errors[id]}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
