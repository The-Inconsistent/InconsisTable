"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { SessionTitle, type ActionInput, type JournalSession } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { RECAP_MAX } from "@/lib/codex/codex";

type JournalProps = {
  /** Every session of the room, newest first (house decision #85). */
  journal: readonly JournalSession[];
  send: Send;
  onError: (error: string | null) => void;
  /** The ruleset gives XP at a session's end: a session's award is shown (house decision #120). */
  showAward: boolean;
  /** A room with a GM: the session side keeps notes (in a room without one nobody but an admin reads them). */
  notes: boolean;
};

type Draft = { id: string; title: string; recap: string; notes: string };

// The journal (#220, Auspex P35 and P36): every session newest first with its number, title, dates and award, one in
// progress marked; EDIT changes the title, an ended session's recap and the GM's notes, sending only what changed. The
// notes stay closed behind a tap, so the table cannot read them over a shoulder. Needs session:run, which the caller
// checks.
export function Journal({ journal, send, onError, showAward, notes }: JournalProps) {
  const t = useTranslations("journal");
  const format = useFormatter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  // EDIT: the editor opens on the session as it stands.
  const handleEdit = (s: JournalSession) => setEditing({ id: s.id, title: s.title, recap: s.recap, notes: s.notes });
  // SAVE: only the fields that changed, a recap only once the session has ended (the server refuses one before).
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const was = journal.find((s) => s.id === editing?.id);
    if (!editing || !was) return;
    const title = SessionTitle.safeParse(editing.title);
    if (!title.success) return onError(t("titleInvalid"));
    const action: ActionInput = {
      type: "session.edit",
      sessionId: editing.id,
      ...(title.data !== was.title ? { title: title.data } : {}),
      ...(was.endedAt !== null && editing.recap !== was.recap ? { recap: editing.recap } : {}),
      ...(notes && editing.notes !== was.notes ? { notes: editing.notes } : {}),
    };
    if (Object.keys(action).length > 2) {
      const r = await send(action);
      onError(r.ok ? null : r.error);
      if (!r.ok) return;
    }
    setEditing(null);
  };

  return (
    <section className="stack">
      <h2 className="head">{t("heading")}</h2>
      {journal.length === 0 && <p className="dim">{t("empty")}</p>}
      <ul className="list">
        {journal.map((s) => (
          // One full-width column per session: the heading line, then the recap, notes or editor under it.
          <li key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
            <span className="row between" style={{ flexWrap: "wrap" }}>
              <span>
                <strong>{[t("session", { number: s.number }), s.title].filter(Boolean).join(": ")}</strong>{" "}
                <span className="dim small">
                  {s.endedAt === null
                    ? t("since", { start: day(s.startedAt) })
                    : t("dates", { start: day(s.startedAt), end: day(s.endedAt) })}
                </span>{" "}
                {s.endedAt === null && <span className="chip">{t("inProgress")}</span>}
                {s.abandoned && <span className="chip">{t("abandoned")}</span>}
                {showAward && s.award !== null && (
                  <span className="small" data-stat="xp">
                    {" "}
                    {t("award", { xp: s.award })}
                  </span>
                )}
              </span>
              {editing?.id !== s.id && (
                <button
                  className="btn sm"
                  aria-label={t("editLabel", { number: s.number })}
                  onClick={() => handleEdit(s)}
                >
                  {t("edit")}
                </button>
              )}
            </span>
            {editing?.id !== s.id && s.recap && <p className="small">{s.recap}</p>}
            {editing?.id !== s.id && notes && s.notes && (
              <details className="small">
                <summary>{t("notes")}</summary>
                <p style={{ whiteSpace: "pre-wrap" }}>{s.notes}</p>
              </details>
            )}
            {editing?.id === s.id && (
              <form className="stack" onSubmit={handleSave}>
                <label className="stack">
                  {t("title")}
                  <input
                    id={`journal-title-${s.id}`}
                    value={editing.title}
                    maxLength={100}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                </label>
                {s.endedAt !== null && (
                  <label className="stack">
                    {t("recap")}
                    <textarea
                      id={`journal-recap-${s.id}`}
                      rows={6}
                      value={editing.recap}
                      maxLength={RECAP_MAX}
                      onChange={(e) => setEditing({ ...editing, recap: e.target.value })}
                    />
                  </label>
                )}
                {notes && (
                  <label className="stack">
                    {t("notesLabel")}
                    <textarea
                      id={`journal-notes-${s.id}`}
                      rows={4}
                      value={editing.notes}
                      maxLength={10_000}
                      onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    />
                  </label>
                )}
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
