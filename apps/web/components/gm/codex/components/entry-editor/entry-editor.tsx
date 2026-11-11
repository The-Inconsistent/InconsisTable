"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { ActionInput, Actor, CodexEntry } from "@inconsistable/core-schema";

import { RevealForm } from "@/components/gm/codex/components/reveal-form/reveal-form";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import { savePatch } from "@/lib/codex/codex";

type EntryEditorProps = {
  entry: CodexEntry;
  characters: readonly Actor[];
  can: { write: boolean; secrets: boolean; reveal: boolean };
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  onDeleted: () => void;
};

// One entry open: its title, body and (for a seat that may read them) GM notes, who sees it, and delete.
export function EntryEditor({ entry, characters, can, act, onDeleted }: EntryEditorProps) {
  const t = useTranslations("codex");
  const [draft, setDraft] = useState({ title: entry.title, body: entry.body, gmNotes: entry.gmNotes });
  const [confirming, setConfirming] = useState(false);
  const patch = savePatch({ entry, draft, canSecrets: can.secrets });
  const dirty = Object.keys(patch).length > 0;

  // A text field of the draft.
  const handleField = (field: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [field]: e.target.value });

  // SAVE sends only the fields that changed.
  const handleSave = async () => {
    if (!dirty) return;
    await act({ type: "codex.save", id: entry.id, kind: entry.kind, ...patch });
  };

  // DELETE, after the confirm step.
  const handleDelete = async () => {
    if ((await act({ type: "codex.delete", id: entry.id })).ok) onDeleted();
  };

  return (
    <section className="card stack" aria-label={entry.title} style={{ minWidth: 0 }}>
      <div className="row between">
        <span className="dim small">{t(`kind.${entry.kind}`)}</span>
        <VisibilityBadge entry={entry} />
      </div>
      <label className="stack">
        {t("titleLabel")}
        <input
          id="codex-title"
          value={draft.title}
          onChange={handleField("title")}
          maxLength={200}
          disabled={!can.write}
        />
      </label>
      <label className="stack">
        {t("body")}
        <textarea
          id="codex-body"
          rows={6}
          value={draft.body}
          onChange={handleField("body")}
          maxLength={20_000}
          disabled={!can.write}
        />
      </label>
      {can.secrets && (
        <label className="stack">
          {t("gmNotes")}
          <textarea
            id="codex-gm-notes"
            rows={4}
            value={draft.gmNotes}
            onChange={handleField("gmNotes")}
            maxLength={20_000}
            disabled={!can.write}
          />
        </label>
      )}
      {can.write && (
        <div className="row">
          <button className="btn primary" disabled={!dirty} onClick={handleSave}>
            {t("save")}
          </button>
          {confirming ? (
            <>
              <button className="btn" onClick={handleDelete}>
                {t("confirmDelete", { title: entry.title })}
              </button>
              <button className="btn" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirming(true)}>
              {t("delete")}
            </button>
          )}
        </div>
      )}
      {can.reveal && <RevealForm entry={entry} characters={characters} act={act} />}
    </section>
  );
}
