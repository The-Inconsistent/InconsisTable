"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { FloatingSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { EntryPath } from "@/components/ui/entry-path/entry-path";
import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { forYourEyes } from "@/lib/codex/codex";
import { canHoldUp } from "@/lib/spotlight/spotlight";
import type { RulesEntry } from "@/lib/library/library";

type PeekProps = {
  /** The entry shown; one this seat no longer holds shows the missing line. */
  entryId: string;
  /** The entries this seat holds: the peek reads only these, never the server. */
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  campaignId: string;
  /** The campaign fields in play, for the entry's reminders. */
  campaign: Readonly<Record<string, string | number | boolean>>;
  known: readonly RulesEntry[];
  /** The characters this seat holds, for FOR YOUR EYES ONLY. */
  held: readonly string[];
  /** A link inside the peek: swaps the entry shown. */
  onOpen: (entryId: string) => void;
  onClose: () => void;
  /** GO TO, for a seat that may write the codex: the entry in CODEX, where it is edited. */
  onGoTo?: (entryId: string) => void;
  /** SHOW THE TABLE, on a phone: a handout or a picture held up full-screen (#2). */
  onHold?: (entryId: string) => void;
};

// One look at an entry over the current screen (#218): from a mention, a search hit or an inbox card, on the GM's app and
// on a phone, never on the table screen. Path, picture, fields, and the body or handout, as this seat reads them.
export function Peek({
  entryId,
  entries,
  ruleset,
  campaignId,
  campaign,
  known,
  held,
  onOpen,
  onClose,
  onGoTo,
  onHold,
}: PeekProps) {
  const t = useTranslations("peek");
  const tKind = useTranslations("codex.kind");
  const tStatus = useTranslations("codex.status");
  const entry = entries.find((e) => e.id === entryId);
  if (!entry)
    return (
      <FloatingSheet title={t("title")} onClose={onClose}>
        <p className="dim">{t("missing")}</p>
      </FloatingSheet>
    );
  return (
    <FloatingSheet title={entry.title} onClose={onClose}>
      <div className="row">
        <span className="chip">{tKind(entry.kind)}</span>
        {entry.status && <span className="chip">{tStatus(entry.status)}</span>}
        {forYourEyes({ entry, held }) && (
          <span className="chip" data-eyes="only">
            {t("eyesOnly")}
          </span>
        )}
        {onHold && canHoldUp(entry) && (
          <button
            className="btn sm"
            onClick={() => onHold(entry.id)}
            aria-label={t("holdLabel", { title: entry.title })}
          >
            {t("hold")}
          </button>
        )}
        {onGoTo && (
          <button
            className="btn sm"
            onClick={() => onGoTo(entry.id)}
            aria-label={t("goToLabel", { title: entry.title })}
          >
            {t("goTo")}
          </button>
        )}
      </div>
      <EntryPath entries={entries} entry={entry} onOpen={onOpen} />
      <EntryPicture campaignId={campaignId} entry={entry} />
      <EntryFields
        ruleset={ruleset}
        entry={entry}
        campaignId={campaignId}
        known={known}
        entries={entries}
        onOpenEntry={onOpen}
        campaign={campaign}
      />
      {entry.layout !== null ? (
        <HandoutDoc
          layout={entry.layout}
          header={entry.header ?? ""}
          title={entry.title}
          body={entry.body}
          entries={entries}
          onOpen={onOpen}
        />
      ) : (
        entry.body && (
          <p className="term-text" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText body={entry.body} entries={entries} onOpen={onOpen} self={entry.id} />
          </p>
        )
      )}
    </FloatingSheet>
  );
}
