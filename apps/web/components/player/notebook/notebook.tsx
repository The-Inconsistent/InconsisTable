"use client";
import { useTranslations } from "next-intl";

import { CodexKind, type Codex, type CodexEntry } from "@inconsistable/core-schema";

type NotebookProps = { codex: Codex | null };

// The phone's notebook: open quests first, then what the GM revealed by kind and tapped open (closed quests with their
// outcome under Quest), then the recaps, newest first.
export function Notebook({ codex }: NotebookProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const tStatus = useTranslations("codex.status");
  const tRecaps = useTranslations("recaps");
  const entries = codex?.entries ?? [];
  const recaps = codex?.recaps ?? [];
  if (!entries.length && !recaps.length) return <p className="dim">{t("nothing")}</p>;
  const openQuests = entries.filter((e) => e.kind === "quest" && e.status === "open");
  const rest = entries.filter((e) => !openQuests.includes(e));
  const card = (e: CodexEntry) => (
    <details key={e.id} className="card">
      <summary>
        <strong>{e.title}</strong>
        {e.status && e.status !== "open" && <span className="chip">{tStatus(e.status)}</span>}
      </summary>
      <p style={{ whiteSpace: "pre-wrap" }}>{e.body}</p>
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
    </div>
  );
}
