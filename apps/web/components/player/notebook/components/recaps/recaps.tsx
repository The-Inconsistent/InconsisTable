"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry, SessionRecap } from "@inconsistable/core-schema";

import { MentionText } from "@/components/ui/mention-text/mention-text";

type RecapsProps = {
  /** Newest first, as the codex sends them. */
  recaps: readonly SessionRecap[];
  entries: readonly CodexEntry[];
  onPeek: (entryId: string) => void;
};

// The recaps, newest first, the latest open for a player catching up. The server already hid the mentions this seat may
// not read.
export function Recaps({ recaps, entries, onPeek }: RecapsProps) {
  const t = useTranslations("notebook");
  const tRecaps = useTranslations("recaps");
  if (recaps.length === 0) return null;
  return (
    <section className="stack">
      <h2 className="head">{t("recaps")}</h2>
      {recaps.map((r, i) => (
        <details key={r.sessionId} className="card" open={i === 0 || undefined}>
          <summary>
            <strong>{[tRecaps("session", { number: r.number }), r.title].filter(Boolean).join(": ")}</strong>
          </summary>
          <p style={{ whiteSpace: "pre-wrap" }}>
            <MentionText body={r.recap} entries={entries} onOpen={onPeek} />
          </p>
        </details>
      ))}
    </section>
  );
}
