"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor, CodexEntry, Spotlight } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type ShowingBarProps = {
  spotlight: Spotlight | null;
  entries: readonly CodexEntry[];
  actors: readonly Actor[];
  send: Send;
};

// "Showing … CLEAR" (#2): while an entry is up in front of the table, what it is and to whom, and CLEAR to take it down.
// Clearing unreveals nothing.
export function ShowingBar({ spotlight, entries, actors, send }: ShowingBarProps) {
  const t = useTranslations("spotlight");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  if (!spotlight) return null;
  const title = entries.find((e) => e.id === spotlight.entryId)?.title ?? "…";
  const names = spotlight.audience.flatMap((id) => actors.find((a) => a.id === id)?.name ?? []);
  const to = names.length > 0 ? new Intl.ListFormat(locale).format(names) : t("everyone");

  // CLEAR: takes the card down on every phone and the TV.
  const handleClear = async () => {
    const r = await send({ type: "spotlight.clear" });
    setError(r.ok ? null : r.error);
  };

  return (
    <div className="showing-bar row between" role="status">
      <span className="showing-text">{t("showing", { title, to })}</span>
      <button className="btn sm" onClick={handleClear} aria-label={t("clearLabel", { title })}>
        {t("clear")}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
