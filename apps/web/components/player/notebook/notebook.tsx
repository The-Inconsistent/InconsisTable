"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor, Codex, Me, Safety, Whisper } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { Archive } from "@/components/player/notebook/components/archive/archive";
import type { CardScope } from "@/components/player/notebook/components/entry-card/entry-card";
import { Inbox } from "@/components/player/notebook/components/inbox/inbox";
import { Mission } from "@/components/player/notebook/components/mission/mission";
import { NOTEBOOK_VIEWS, type NotebookView } from "@/components/player/notebook/constants";
import { SafetySection } from "@/components/player/notebook/safety-section";
import { WhisperReply } from "@/components/ui/whisper-reply/whisper-reply";
import type { Send } from "@/hooks/use-table/use-table";
import type { RulesEntry } from "@/lib/library/library";
import { inboxEntries } from "@/lib/seen/seen";

type NotebookProps = {
  codex: Codex | null;
  /** This session's whispers to the seat's characters (house decision #93), newest first. */
  whispers: readonly Whisper[];
  actors: readonly Actor[];
  me: Me;
  safety: Safety;
  send: Send;
  /** The manifest as this seat reads it: the fields each kind of entry carries (house decision #71). */
  ruleset: Ruleset | null;
  /** Pack entries this seat already read, to name a ref field's entry. */
  known: readonly RulesEntry[];
  /** The campaign fields in play, for an entry's reminders. */
  campaign: Readonly<Record<string, string | number | boolean>>;
  /** The characters this seat holds. */
  held: readonly string[];
  /** The keys this device had not seen when the notebook was opened (`useSeen`). */
  fresh: ReadonlySet<string>;
  /** MARK ALL READ. */
  onMarkAll: () => void;
  /** Opens an entry's peek. */
  onPeek: (entryId: string) => void;
};

// The phone's notebook (#218), three views in one tab: INBOX (this session's whispers and what is new since the last
// visit), MISSION (the premise, the table's lines, the quests, the adventures and the recaps) and ARCHIVE (everything the
// seat holds, searchable). It opens on INBOX when that holds something, else on ARCHIVE.
export function Notebook({
  codex,
  whispers,
  actors,
  me,
  safety,
  send,
  ruleset,
  known,
  campaign,
  held,
  fresh,
  onMarkAll,
  onPeek,
}: NotebookProps) {
  const t = useTranslations("notebook");
  const tWhisper = useTranslations("whisper");
  const entries = codex?.entries ?? [];
  const recaps = codex?.recaps ?? [];
  const inbox = inboxEntries({ entries, fresh });
  const [picked, setPicked] = useState<NotebookView | null>(null);
  const view = picked ?? (inbox.length > 0 || whispers.length > 0 ? "inbox" : "archive");
  // Adjusting state during render: the view first chosen once the codex is read stays, so MARK ALL READ or a new
  // reveal never moves the player.
  if (picked === null && codex !== null) setPicked(view);
  const scope: CardScope = { entries, ruleset, campaignId: me.campaignId, campaign, known, held, fresh, onPeek };
  const whisperSection = whispers.length > 0 && (
    <section className="stack">
      <h2 className="head">{tWhisper("notebook")}</h2>
      {whispers.map((w) => (
        <article key={w.id} className="card stack">
          <span className="small dim">{tWhisper("fromGm")}</span>
          <p className="whisper-text">{w.text}</p>
          {w.readers.map((r) => (
            <div key={r.actorId} className="stack">
              {w.readers.length > 1 && (
                <span className="small dim">
                  {tWhisper("forName", { name: actors.find((a) => a.id === r.actorId)?.name ?? "" })}
                </span>
              )}
              <WhisperReply whisperId={w.id} reader={r} send={send} />
            </div>
          ))}
        </article>
      ))}
    </section>
  );
  return (
    <div className="stack">
      <div className="seg notebook-views" role="group" aria-label={t("viewsLabel")}>
        {NOTEBOOK_VIEWS.map((v) => {
          const count = v === "inbox" ? inbox.length : 0;
          return (
            <button
              key={v}
              className="btn"
              aria-pressed={view === v}
              aria-label={count > 0 ? t("viewNew", { view: t(`views.${v}`), count }) : undefined}
              onClick={() => setPicked(v)}
            >
              {t(`views.${v}`)}
              {count > 0 && (
                <span className="tab-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {view === "inbox" ? (
        <Inbox inbox={inbox} scope={scope} whispers={whisperSection} onMarkAll={onMarkAll} />
      ) : view === "mission" ? (
        <Mission scope={scope} recaps={recaps} safety={<SafetySection me={me} safety={safety} send={send} />} />
      ) : (
        <Archive scope={scope} recaps={recaps} />
      )}
    </div>
  );
}
