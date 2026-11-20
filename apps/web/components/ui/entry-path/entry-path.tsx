"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

import { entryPath } from "@/lib/codex/codex";

type EntryPathProps = {
  /** The entries this seat reads. */
  entries: readonly CodexEntry[];
  entry: CodexEntry;
  onOpen: (entryId: string) => void;
};

// Where an open entry sits: the ancestors this seat reads, root first, each opening that entry (house decision #69).
export function EntryPath({ entries, entry, onOpen }: EntryPathProps) {
  const t = useTranslations("codex");
  const path = entryPath({ entries, entry });
  if (path.length === 0) return null;
  return (
    <nav aria-label={t("path", { title: entry.title })}>
      <ol className="entry-path small">
        {path.map((e) => (
          <li key={e.id}>
            <button type="button" className="mention" onClick={() => onOpen(e.id)}>
              {e.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
