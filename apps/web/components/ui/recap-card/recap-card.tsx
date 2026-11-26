"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry, SessionRecap } from "@inconsistable/core-schema";

import { MentionText } from "@/components/ui/mention-text/mention-text";

type RecapCardProps = {
  recap: SessionRecap;
  /** The entries this seat holds, for the recap's mentions. */
  entries: readonly CodexEntry[];
  /** Opens a mentioned entry (a phone's peek); without it (the TV) a mention is marked text. */
  onPeek?: (entryId: string) => void;
  onDismiss?: () => void;
};

// "Last time...": the newest recap at the start of a session. On the TV it reads at the density's far-away size; on a
// phone it carries a dismiss button. Its mentions read as the notebook's do: the server already hid what this seat may not.
export function RecapCard({ recap, entries, onPeek, onDismiss }: RecapCardProps) {
  const t = useTranslations("recaps");
  return (
    <section className="card" aria-label={t("lastTime")}>
      <h2 className="head" style={{ fontSize: "var(--fs-name)" }}>
        {t("lastTime")}
      </h2>
      <strong>{[t("session", { number: recap.number }), recap.title].filter(Boolean).join(": ")}</strong>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        <MentionText body={recap.recap} entries={entries} onOpen={onPeek} />
      </p>
      {onDismiss && (
        <button className="btn" onClick={onDismiss} style={{ justifySelf: "start" }}>
          {t("dismiss")}
        </button>
      )}
    </section>
  );
}
