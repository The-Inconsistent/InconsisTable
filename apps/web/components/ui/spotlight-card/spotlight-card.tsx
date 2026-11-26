"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import type { RulesEntry } from "@/lib/library/library";

type SpotlightCardProps = {
  entry: CodexEntry;
  campaignId: string;
  /** The entries this seat holds, for the mentions in the body. */
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  known: readonly RulesEntry[];
  campaign: Readonly<Record<string, string | number | boolean>>;
  /** The line above the title: who holds it up. */
  kicker: string;
  /** DISMISS on a phone; absent on the TV, which has no input and keeps it up until the GM clears it. */
  onClose?: () => void;
  /** The phone's X-card button: the card makes the page behind it inert, and the X-card must stay in reach. */
  xcard?: ReactNode;
};

// One entry full-screen (#2, house decision #139): the GM's SHOW on a phone and on the TV, or a player holding a handout or
// a picture up to the table. Only what this seat reads: the picture, the fields, the handout or the body. In the top
// layer, so no card or row it is opened from can pin it.
export function SpotlightCard({
  entry,
  campaignId,
  entries,
  ruleset,
  known,
  campaign,
  kicker,
  onClose,
  xcard,
}: SpotlightCardProps) {
  const t = useTranslations("spotlight");
  const dialog = useRef<HTMLDialogElement>(null);
  // External system: the dialog element's top layer; opened once mounted, closed when it leaves.
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  // Escape on a phone dismisses; the TV has nothing to dismiss with.
  const handleCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose?.();
  };
  return (
    <dialog
      ref={dialog}
      className="spotlight"
      data-tv={onClose ? undefined : true}
      aria-labelledby="spotlight-title"
      onCancel={handleCancel}
    >
      <div className="spotlight-sheet stack">
        <div className="row between">
          <span className="small spotlight-kicker">{kicker}</span>
          <span className="row">
            {xcard}
            {onClose && (
              <button
                className="btn sm"
                onClick={onClose}
                aria-label={t("closeLabel", { title: entry.title })}
                autoFocus
              >
                {t("close")}
              </button>
            )}
          </span>
        </div>
        <h2 id="spotlight-title" className="title spotlight-title">
          {entry.title}
        </h2>
        <EntryPicture campaignId={campaignId} entry={entry} />
        <EntryFields
          ruleset={ruleset}
          entry={entry}
          campaignId={null}
          known={known}
          entries={entries}
          campaign={campaign}
          readNames={false}
        />
        {entry.layout !== null ? (
          <HandoutDoc
            layout={entry.layout}
            header={entry.header ?? ""}
            title={entry.title}
            body={entry.body}
            entries={entries}
          />
        ) : (
          entry.body && (
            <p className="spotlight-body">
              <MentionText body={entry.body} entries={entries} />
            </p>
          )
        )}
      </div>
    </dialog>
  );
}
