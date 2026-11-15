"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { DraftRecap as Draft } from "@/hooks/use-table/use-table";

type DraftRecapProps = {
  draft: Draft;
  /** What is typed in the recap box now. */
  text: string;
  onFill: (text: string) => void;
  onError: (error: string | null) => void;
};

// "Draft from tonight": fills the recap box with the session's lines. It asks before it replaces typed text.
export function DraftRecap({ draft, text, onFill, onError }: DraftRecapProps) {
  const t = useTranslations("recapDraft");
  const [asking, setAsking] = useState(false);

  const handleDraft = async () => {
    setAsking(false);
    const r = await draft();
    onError(r.ok ? null : r.error);
    if (!r.ok) return;
    if (r.text === "") onError(t("nothing"));
    else onFill(r.text);
  };

  if (asking)
    return (
      <div className="row" role="group" aria-label={t("replaceAsk")}>
        <span>{t("replaceAsk")}</span>
        <button type="button" className="btn sm" onClick={handleDraft}>
          {t("replace")}
        </button>
        <button type="button" className="btn sm" onClick={() => setAsking(false)}>
          {t("keep")}
        </button>
      </div>
    );
  return (
    <button type="button" className="btn sm" onClick={text.trim() === "" ? handleDraft : () => setAsking(true)}>
      {t("draft")}
    </button>
  );
}
