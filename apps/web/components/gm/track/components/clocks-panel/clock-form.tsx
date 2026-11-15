"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { ClockVisibility, type Clock } from "@inconsistable/core-schema";

import { CLOCK_SEGMENT_PICKS, CLOCK_SEGMENTS_MAX, CLOCK_SEGMENTS_MIN } from "@/components/gm/track/constants";
import { useTableMode, useVisibilities } from "@/lib/table-mode/table-mode";

export type ClockValues = Pick<Clock, "name" | "segments" | "visibility" | "entryId">;

type ClockFormProps = {
  initial: ClockValues;
  entries: readonly { id: string; title: string }[];
  submitLabel: string;
  onSubmit: (values: ClockValues) => Promise<boolean>;
  onCancel: () => void;
};

// The fields of a clock: used to make one and to edit one. Segments are a quick pick (4, 6, 8) or any number 2 to 12.
export function ClockForm({ initial, entries, submitLabel, onSubmit, onCancel }: ClockFormProps) {
  const t = useTranslations("clocks");
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [segments, setSegments] = useState(String(initial.segments));
  const hasGm = useTableMode() === "gm";
  const [visibility, setVisibility] = useState(!hasGm && initial.visibility === "gm" ? "party" : initial.visibility);
  const visibilities = useVisibilities(ClockVisibility.options);
  const [entryId, setEntryId] = useState(initial.entryId ?? "");
  const count = Number(segments);
  const valid =
    name.trim() !== "" && Number.isInteger(count) && count >= CLOCK_SEGMENTS_MIN && count <= CLOCK_SEGMENTS_MAX;
  const isPick = CLOCK_SEGMENT_PICKS.some((n) => String(n) === segments);

  // SAVE: sends the fields; the form closes only when the server took them.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    await onSubmit({ name: name.trim(), segments: count, visibility, entryId: entryId || null });
  };

  return (
    <form className="stack clock-form" onSubmit={handleSubmit}>
      <label htmlFor={`${id}-name`}>{t("name")}</label>
      <input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      <div role="group" aria-label={t("segments")} className="row">
        {CLOCK_SEGMENT_PICKS.map((n) => (
          <button
            key={n}
            type="button"
            className="btn"
            aria-pressed={segments === String(n)}
            onClick={() => setSegments(String(n))}
          >
            {n}
          </button>
        ))}
        <label className="row" htmlFor={`${id}-custom`}>
          <span>{isPick ? t("custom") : t("customLabel")}</span>
          <input
            id={`${id}-custom`}
            inputMode="numeric"
            value={isPick ? "" : segments}
            placeholder={isPick ? String(CLOCK_SEGMENTS_MAX) : undefined}
            onChange={(e) => setSegments(e.target.value)}
            style={{ width: 72 }}
          />
        </label>
      </div>
      <div className="row">
        <label className="row" htmlFor={`${id}-visibility`}>
          {t("visibility")}
          <select
            id={`${id}-visibility`}
            value={visibility}
            onChange={(e) => setVisibility(ClockVisibility.parse(e.target.value))}
          >
            {visibilities.map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        {entries.length > 0 && (
          <label className="row" htmlFor={`${id}-entry`}>
            {t("link")}
            <select id={`${id}-entry`} value={entryId} onChange={(e) => setEntryId(e.target.value)}>
              <option value="">{t("noLink")}</option>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <button type="submit" className="btn primary" disabled={!valid}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
