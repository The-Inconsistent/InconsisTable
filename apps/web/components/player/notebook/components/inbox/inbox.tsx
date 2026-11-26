"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { CodexEntry } from "@inconsistable/core-schema";

import { EntryButton } from "../entry-button/entry-button";
import type { CardScope } from "../entry-card/entry-card";

type InboxProps = {
  /** The entries unseen when the notebook was opened, newest revealed first (lib/seen `inboxEntries`). */
  inbox: readonly CodexEntry[];
  scope: CardScope;
  /** This session's whispers, on top. */
  whispers: ReactNode;
  onMarkAll: () => void;
};

// INBOX: this session's whispers, then what the GM revealed since this phone last opened the notebook, quietly: no sound,
// no buzz, no popup (principle 8). A card opens the peek; MARK ALL READ empties it.
export function Inbox({ inbox, scope, whispers, onMarkAll }: InboxProps) {
  const t = useTranslations("notebook");
  return (
    <div className="stack">
      {whispers}
      {inbox.length === 0 ? (
        <p className="dim">{t("inboxEmpty")}</p>
      ) : (
        <section className="stack" aria-label={t("views.inbox")}>
          <ul className="list notebook-list">
            {inbox.map((e) => (
              <li key={e.id}>
                <EntryButton entry={e} scope={scope} />
              </li>
            ))}
          </ul>
          <button className="btn" style={{ justifySelf: "start" }} onClick={onMarkAll}>
            {t("markAllRead")}
          </button>
        </section>
      )}
    </div>
  );
}
