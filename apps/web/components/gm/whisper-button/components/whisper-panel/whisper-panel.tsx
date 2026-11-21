"use client";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import { PARTY_KINDS, WHISPER_MAX, type LiveState } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type WhisperPanelProps = { state: LiveState; send: Send };

// The GM's whispers (house decision #93): pick the party's characters (all or some), one line, send; then this
// session's whispers, each with who has read it and each reply, and a take-back.
export function WhisperPanel({ state, send }: WhisperPanelProps) {
  const t = useTranslations("whisper");
  const id = useId();
  const party = state.actors.filter((a) => PARTY_KINDS.has(a.kind));
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = party.length > 0 && party.every((a) => picked.has(a.id));
  const nameOf = (actorId: string) => names.get(actorId) ?? t("gone");

  // A character's chip: in or out of the whisper.
  const handlePick = (actorId: string) => {
    const next = new Set(picked);
    if (!next.delete(actorId)) next.add(actorId);
    setPicked(next);
  };
  // ALL: every character of the party, or none.
  const handleAll = () => setPicked(all ? new Set() : new Set(party.map((a) => a.id)));
  // SEND: the line to the picked characters; the line clears once the server has it, the picks stay.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send({ type: "whisper.send", to: party.filter((a) => picked.has(a.id)).map((a) => a.id), text });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setText("");
  };
  // TAKE BACK: the whisper is gone from every phone.
  const handleDelete = async (whisperId: string) => {
    const r = await send({ type: "whisper.delete", id: whisperId });
    setError(r.ok ? null : r.error);
  };

  if (party.length === 0) return <p className="dim">{t("noCharacters")}</p>;
  return (
    <div className="stack">
      <form className="stack" onSubmit={handleSubmit}>
        <div className="row" role="group" aria-label={t("to")}>
          <button type="button" className="btn sm" aria-pressed={all} onClick={handleAll}>
            {t("all")}
          </button>
          {party.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn sm"
              aria-pressed={picked.has(a.id)}
              onClick={() => handlePick(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
        <label className="small dim" htmlFor={id}>
          {t("text")}
        </label>
        <textarea id={id} rows={2} value={text} maxLength={WHISPER_MAX} onChange={(e) => setText(e.target.value)} />
        <span className="row between">
          <span className="small dim" aria-live="polite">
            {t("counter", { used: text.length, max: WHISPER_MAX })}
          </span>
          <button className="btn primary" type="submit" disabled={busy || picked.size === 0 || text.trim() === ""}>
            {t("send")}
          </button>
        </span>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3 className="head">{t("thisSession")}</h3>
      {state.whispers.length === 0 && <p className="dim">{t("none")}</p>}
      {state.whispers.map((w) => {
        const to = w.readers.map((r) => nameOf(r.actorId)).join(", ");
        return (
          <article key={w.id} className="card stack">
            <span className="row between">
              <strong>{t("toNames", { names: to })}</strong>
              <button
                className="btn sm"
                aria-label={t("takeBackLabel", { names: to })}
                onClick={() => handleDelete(w.id)}
              >
                {t("takeBack")}
              </button>
            </span>
            <p className="whisper-text">{w.text}</p>
            <ul className="stack whisper-readers">
              {w.readers.map((r) => (
                <li key={r.actorId}>
                  <strong>{nameOf(r.actorId)}</strong>{" "}
                  <span className="chip">{r.readAt !== null ? t("read") : t("unread")}</span>
                  {r.reply !== null && <span>{` ${r.reply}`}</span>}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
