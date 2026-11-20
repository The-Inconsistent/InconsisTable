"use client";
import { useTranslations } from "next-intl";

import { CodexKind, type Codex, type CodexEntry, type Me, type Safety } from "@inconsistable/core-schema";

import { SafetySection } from "@/components/player/notebook/safety-section";
import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import type { Send } from "@/hooks/use-table/use-table";

type NotebookProps = { codex: Codex | null; me: Me; safety: Safety; send: Send };

// The phone's notebook: open quests first, then what the GM revealed by kind and tapped open (closed quests with their
// outcome under Quest), then the recaps, newest first.
export function Notebook({ codex, me, safety, send }: NotebookProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const tStatus = useTranslations("codex.status");
  const tRecaps = useTranslations("recaps");
  const entries = codex?.entries ?? [];
  const recaps = codex?.recaps ?? [];
  const safetySection = <SafetySection me={me} safety={safety} send={send} />;
  if (!entries.length && !recaps.length)
    return (
      <div className="stack">
        <p className="dim">{t("nothing")}</p>
        {safetySection}
      </div>
    );
  const openQuests = entries.filter((e) => e.kind === "quest" && e.status === "open");
  const rest = entries.filter((e) => !openQuests.includes(e));
  // A mention opens the entry it names and scrolls to it.
  const handleOpen = (id: string) => {
    const el = document.getElementById(`entry-${id}`);
    if (!(el instanceof HTMLDetailsElement)) return;
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const card = (e: CodexEntry) => (
    <details key={e.id} id={`entry-${e.id}`} className="card">
      <summary>
        <strong>{e.title}</strong>
        {e.status && e.status !== "open" && <span className="chip">{tStatus(e.status)}</span>}
      </summary>
      <EntryPicture campaignId={me.campaignId} entry={e} />
      <p style={{ whiteSpace: "pre-wrap" }}>
        <MentionText body={e.body} entries={entries} onOpen={handleOpen} />
      </p>
    </details>
  );
  return (
    <div className="stack">
      {openQuests.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("openQuests")}</h2>
          {openQuests.map(card)}
        </section>
      )}
      {CodexKind.options.map((kind) => {
        const ofKind = rest.filter((e) => e.kind === kind);
        return (
          ofKind.length > 0 && (
            <section key={kind} className="stack">
              <h2 className="head">{tKind(kind)}</h2>
              {ofKind.map(card)}
            </section>
          )
        );
      })}
      {recaps.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("recaps")}</h2>
          {recaps.map((r) => (
            <details key={r.sessionId} className="card">
              <summary>
                <strong>{[tRecaps("session", { number: r.number }), r.title].filter(Boolean).join(": ")}</strong>
              </summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{r.recap}</p>
            </details>
          ))}
        </section>
      )}
      {safetySection}
    </div>
  );
}
