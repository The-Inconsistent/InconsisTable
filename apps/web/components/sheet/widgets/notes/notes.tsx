"use client";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useState } from "react";

import { stepsFor } from "@inconsistable/rules-engine";

import { type SheetRow, valueOf } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";
import { NOTE_MAX_LENGTH } from "./constants";

type NotesProps = { fields: readonly SheetRow[]; env: WidgetEnv };

// Long texts written in place: each one folded under its label, and one WRITE or EDIT that opens them all for a seat
// that may change them (the GM's, or the owner's when the field says so). SAVE sends one `field.set` per text changed.
export function Notes({ fields, env }: NotesProps) {
  const t = useTranslations("sheet.widget");
  const def = env.ruleset.entities.find((e) => e.id === env.actor.entity);
  const textOf = (row: SheetRow) => {
    const v = valueOf({ actor: env.actor, row });
    return typeof v === "string" ? v : "";
  };
  const writable = fields.filter((f) => {
    const field = def && Object.hasOwn(def.fields, f.id) ? def.fields[f.id] : undefined;
    return field !== undefined && stepsFor({ editableBy: field.editableBy, gmSide: env.gm }).inc;
  });
  const maxLengthOf = (id: string) => {
    const field = def && Object.hasOwn(def.fields, id) ? def.fields[id] : undefined;
    return field?.type === "text" ? (field.maxLength ?? NOTE_MAX_LENGTH) : NOTE_MAX_LENGTH;
  };
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const written = fields.filter((f) => textOf(f) !== "");

  // EDIT: copies the texts this seat may change into the editor.
  const handleEdit = () => setDraft(Object.fromEntries(writable.map((f) => [f.id, textOf(f)])));
  // A textarea: keeps its text in the draft.
  const handleChange = (id: string) => (e: ChangeEvent<HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [id]: e.target.value }));
  // SAVE: one field write per text that changed; on a refusal the editor stays open with the reason shown.
  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    for (const f of writable) {
      const value = draft[f.id] ?? "";
      if (value === textOf(f)) continue;
      const r = await env.send({ type: "field.set", actorId: env.actor.id, field: f.id, value });
      if (!r.ok) {
        env.onError(r.error);
        setBusy(false);
        return;
      }
    }
    env.onError(null);
    setBusy(false);
    setDraft(null);
  };

  if (draft)
    return (
      <div className="w-notes stack">
        {writable.map((f) => (
          <label key={f.id} className="field">
            <span className="stat-label">{f.label}</span>
            <textarea value={draft[f.id] ?? ""} maxLength={maxLengthOf(f.id)} rows={4} onChange={handleChange(f.id)} />
          </label>
        ))}
        <div className="row">
          <button className="btn sm primary" aria-busy={busy || undefined} disabled={busy} onClick={handleSave}>
            {t("save")}
          </button>
          <button className="btn sm" disabled={busy} onClick={() => setDraft(null)}>
            {t("cancel")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="w-notes stack">
      {written.length === 0 ? (
        <p className="dim">{t("notWritten", { fields: fields.map((f) => f.label).join(", ") })}</p>
      ) : (
        written.map((f) => (
          <details key={f.id} className="w-fold" data-stat={f.id}>
            <summary>
              <span className="w-fold-title">{f.label}</span>
            </summary>
            <div className="w-fold-body">
              <p className="w-note-text">{textOf(f)}</p>
            </div>
          </details>
        ))
      )}
      {writable.length > 0 && (
        <div className="row">
          <button className="btn sm" onClick={handleEdit}>
            {written.length === 0 ? t("write") : t("edit")}
          </button>
        </div>
      )}
    </div>
  );
}
