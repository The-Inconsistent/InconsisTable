"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { CodexEntry } from "@inconsistable/core-schema";

type VisibilityBadgeProps = {
  entry: CodexEntry;
  /** The names of the characters a listed entry reaches; given, the badge opens them (#218). */
  names?: readonly string[];
};

// Who can read an entry, in words: gm, party or public, and "listed" when only chosen characters do. With the names,
// a listed badge is a button that shows them under it.
export function VisibilityBadge({ entry, names }: VisibilityBadgeProps) {
  const t = useTranslations("codex");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const listed = entry.visibility !== "gm" && entry.audienceMode === "listed";
  const words = `${t(`visibility.${entry.visibility}`)}${listed ? ` · ${t("listed", { count: entry.audience.length })}` : ""}`;
  if (!listed || names === undefined) return <span className="chip">{words}</span>;
  return (
    <>
      <button
        type="button"
        className="chip reach-chip"
        aria-expanded={open}
        aria-label={t("readersOf", { title: entry.title })}
        onClick={() => setOpen(!open)}
      >
        {words}
      </button>
      {open && (
        <p className="small reach-names">
          {names.length > 0 ? new Intl.ListFormat(locale).format(names) : t("noCharacters")}
        </p>
      )}
    </>
  );
}
