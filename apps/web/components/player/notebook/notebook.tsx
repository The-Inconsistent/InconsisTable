"use client";
import { useTranslations } from "next-intl";

import { CodexKind, type Codex } from "@inconsistable/core-schema";

type NotebookProps = { codex: Codex | null };

// The phone's notebook: what the GM revealed, by kind and tapped open, then the recaps, newest first.
export function Notebook({ codex }: NotebookProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const tRecaps = useTranslations("recaps");
  const entries = codex?.entries ?? [];
  const recaps = codex?.recaps ?? [];
  if (!entries.length && !recaps.length) return <p className="dim">{t("nothing")}</p>;
  return (
    <div className="stack">
      {CodexKind.options.map((kind) => {
        const ofKind = entries.filter((e) => e.kind === kind);
        return (
          ofKind.length > 0 && (
            <section key={kind} className="stack">
              <h2 className="head">{tKind(kind)}</h2>
              {ofKind.map((e) => (
                <details key={e.id} className="card">
                  <summary>
                    <strong>{e.title}</strong>
                  </summary>
                  <p style={{ whiteSpace: "pre-wrap" }}>{e.body}</p>
                </details>
              ))}
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
