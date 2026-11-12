"use client";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";

import type { OutcomeSpec } from "@inconsistable/core-schema";

type OutcomePadProps = {
  /** What the ruleset lists, best first. */
  outcomes: readonly OutcomeSpec[];
  /** Who is reporting, for the screen reader. */
  who: string;
  /** Sends the picked outcome id; resolves with the server's refusal, or null once it was taken. */
  onReport: (outcome: string) => Promise<string | null>;
};

// A reported Test: the table rolled and worked it out, so the phone only asks which result came up. One large button
// per outcome, best first; a pick is confirmed before it is sent, because a player's first report stands.
export function OutcomePad({ outcomes, who, onReport }: OutcomePadProps) {
  const t = useTranslations("outcomePad");
  const [picked, setPicked] = useState<OutcomeSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // REPORT: sends the pick; a refusal stays on screen so it can be fixed or told to the GM.
  const handleReport = async () => {
    if (picked === null || busy) return;
    setBusy(true);
    setError(await onReport(picked.id));
    setBusy(false);
  };

  return (
    <div className="stack outcome-pad">
      <div className="stack" role="group" aria-label={t("pickFor", { who })}>
        {outcomes.map((o, i) => (
          <button
            key={o.id}
            className="btn outcome-option"
            style={{ "--i": i } as CSSProperties}
            aria-pressed={picked?.id === o.id}
            onClick={() => setPicked(o)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary pool-report" disabled={picked === null || busy} onClick={handleReport}>
        {picked === null ? t("pickFirst") : t("report", { label: picked.label })}
      </button>
    </div>
  );
}
