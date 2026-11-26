"use client";
import { useTranslations } from "next-intl";
import { useState, type SyntheticEvent } from "react";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { EntryFieldChips, EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { EntryPath } from "@/components/ui/entry-path/entry-path";
import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { forYourEyes, type TreeRow } from "@/lib/codex/codex";
import type { RulesEntry } from "@/lib/library/library";
import { entrySeenKey } from "@/lib/seen/seen";

/** What every card in the notebook reads: the seat's entries and manifest, and where a link opens. */
export type CardScope = {
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  campaignId: string;
  /** The campaign fields in play, for an entry's reminders. */
  campaign: Readonly<Record<string, string | number | boolean>>;
  known: readonly RulesEntry[];
  /** The characters this seat holds, for FOR YOUR EYES ONLY. */
  held: readonly string[];
  /** The keys unseen when the notebook was opened (lib/seen): their cards carry NEW. */
  fresh: ReadonlySet<string>;
  /** Opens an entry's peek. */
  onPeek: (entryId: string) => void;
};

type EntryCardProps = { row: TreeRow; scope: CardScope; defaultOpen?: boolean };

// One entry in the notebook, tapped open: path, picture, the fields the party sees, then the body or the handout. It sits
// indented under its parent; a link inside opens the peek.
export function EntryCard({ row: { entry: e, depth }, scope, defaultOpen = false }: EntryCardProps) {
  const t = useTranslations("notebook");
  const tStatus = useTranslations("codex.status");
  const tPeek = useTranslations("peek");
  const { entries, ruleset, campaignId, campaign, known, held, fresh, onPeek } = scope;
  // Opened once: from then on it may read its refs' names (no read per closed card).
  const [read, setRead] = useState(defaultOpen);
  // A card opened by a tap keeps its read.
  const handleToggle = (ev: SyntheticEvent<HTMLDetailsElement>) => {
    if (ev.currentTarget.open) setRead(true);
  };
  return (
    <details
      className={depth > 0 ? "card tree-child" : "card"}
      style={{ marginInlineStart: depth * 12 }}
      open={defaultOpen || undefined}
      onToggle={handleToggle}
    >
      <summary>
        <strong>{e.title}</strong>
        {fresh.has(entrySeenKey(e)) && <span className="chip">{t("new")}</span>}
        {forYourEyes({ entry: e, held }) && (
          <span className="chip" data-eyes="only">
            {tPeek("eyesOnly")}
          </span>
        )}
        {e.status && e.status !== "open" && <span className="chip">{tStatus(e.status)}</span>}
        <EntryFieldChips ruleset={ruleset} entry={e} />
      </summary>
      <EntryPath entries={entries} entry={e} onOpen={onPeek} />
      <EntryPicture campaignId={campaignId} entry={e} />
      <EntryFields
        ruleset={ruleset}
        entry={e}
        campaignId={campaignId}
        known={known}
        enumChips={false}
        entries={entries}
        onOpenEntry={onPeek}
        readNames={read}
        campaign={campaign}
      />
      {e.layout !== null ? (
        <HandoutDoc
          layout={e.layout}
          header={e.header ?? ""}
          title={e.title}
          body={e.body}
          entries={entries}
          onOpen={onPeek}
        />
      ) : (
        <p style={{ whiteSpace: "pre-wrap" }}>
          <MentionText body={e.body} entries={entries} onOpen={onPeek} self={e.id} />
        </p>
      )}
    </details>
  );
}
