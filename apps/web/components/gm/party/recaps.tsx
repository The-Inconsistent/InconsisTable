"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { SessionRecap } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { RECAP_MAX } from "@/lib/codex/codex";

type RecapsProps = { recaps: readonly SessionRecap[]; send: Send; onError: (error: string | null) => void };

// Past recaps, each editable in place (session.edit by id). Needs session:run, which the caller checks.
export function Recaps({ recaps, send, onError }: RecapsProps) {
  const t = useTranslations("recaps");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const r = await send({ type: "session.edit", sessionId: editing.id, recap: editing.text });
    onError(r.ok ? null : r.error);
    if (r.ok) setEditing(null);
  };

  return (
    <section className="stack">
      <h2 className="head">{t("heading")}</h2>
      {recaps.length === 0 && <p className="dim">{t("empty")}</p>}
      <ul className="list">
        {recaps.map((r) => (
          <li key={r.sessionId}>
            <span>
              <strong>{[t("session", { number: r.number }), r.title].filter(Boolean).join(": ")}</strong>{" "}
              <span className="dim small">{new Date(r.endedAt).toLocaleDateString()}</span>
            </span>
            {editing?.id !== r.sessionId && (
              <button
                className="btn sm"
                aria-label={t("editLabel", { number: r.number })}
                onClick={() => setEditing({ id: r.sessionId, text: r.recap })}
              >
                {t("edit")}
              </button>
            )}
            {editing?.id === r.sessionId && (
              <form className="stack" onSubmit={handleSave} style={{ width: "100%" }}>
                <textarea
                  aria-label={t("text")}
                  rows={6}
                  value={editing.text}
                  maxLength={RECAP_MAX}
                  onChange={(e) => setEditing({ id: r.sessionId, text: e.target.value })}
                  autoFocus
                />
                <div className="row">
                  <button className="btn primary">{t("save")}</button>
                  <button type="button" className="btn" onClick={() => setEditing(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
