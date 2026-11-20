"use client";
import { useTranslations } from "next-intl";

import type { TestDef } from "@inconsistable/core-schema";

type MarkSwitchesProps = {
  /** The Test's marks (house decision #80): the yes-or-no the GM sets when calling it. */
  marks: NonNullable<TestDef["marks"]>;
  /** Which marks are on, by id; one left out is off. */
  on: (id: string) => boolean;
  onChange: (id: string, on: boolean) => void;
  /** Prefixes each switch's id; unique on the page. */
  idPrefix: string;
};

// The marks of a Test as switches, in the ruleset's words: the call form's and a prepared line's.
export function MarkSwitches({ marks, on, onChange, idPrefix }: MarkSwitchesProps) {
  const t = useTranslations("callForm");
  if (marks.length === 0) return null;
  return (
    <div className="row" role="group" aria-label={t("marks")}>
      {marks.map((m) => (
        <label key={m.id} className="row" style={{ minHeight: 44 }}>
          <input
            id={`${idPrefix}-${m.id}`}
            type="checkbox"
            role="switch"
            checked={on(m.id)}
            onChange={(e) => onChange(m.id, e.target.checked)}
            style={{ minHeight: 24 }}
          />
          {m.label}
        </label>
      ))}
    </div>
  );
}
