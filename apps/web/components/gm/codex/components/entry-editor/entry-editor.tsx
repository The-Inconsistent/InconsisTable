"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import { QuestStatus, splitMentions, type ActionInput, type Actor, type CodexEntry } from "@inconsistable/core-schema";

import { RevealForm } from "@/components/gm/codex/components/reveal-form/reveal-form";
import { EntryPath } from "@/components/ui/entry-path/entry-path";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { MentionTextarea } from "@/components/ui/mention-textarea/mention-textarea";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import { parentOptions, savePatch } from "@/lib/codex/codex";

type EntryEditorProps = {
  entry: CodexEntry;
  characters: readonly Actor[];
  /** Every entry this seat reads: the `@` picker lists them, a mention in the body opens one. */
  entries: readonly CodexEntry[];
  onOpenEntry: (entryId: string) => void;
  can: { write: boolean; secrets: boolean; reveal: boolean };
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  onDeleted: () => void;
};

// One entry open: its title, body and (for a seat that may read them) GM notes, who sees it, and delete.
export function EntryEditor({ entry, characters, entries, onOpenEntry, can, act, onDeleted }: EntryEditorProps) {
  const t = useTranslations("codex");
  const [draft, setDraft] = useState({ title: entry.title, body: entry.body, gmNotes: entry.gmNotes });
  const [confirming, setConfirming] = useState(false);
  const patch = savePatch({ entry, draft, canSecrets: can.secrets });
  const hasMention = splitMentions(draft.body).some((p) => "id" in p);
  const dirty = Object.keys(patch).length > 0 && draft.title.trim() !== "";
  const parents = parentOptions({ entries, entry });

  // A text field of the draft.
  const handleField = (field: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [field]: e.target.value });

  // SAVE sends only the fields that changed.
  const handleSave = async () => {
    if (!dirty) return;
    await act({ type: "codex.save", id: entry.id, kind: entry.kind, ...patch });
  };

  // A quest's status is saved as soon as it is picked.
  const handleStatus = async (e: ChangeEvent<HTMLSelectElement>) => {
    const status = QuestStatus.safeParse(e.target.value);
    if (status.success) await act({ type: "codex.save", id: entry.id, kind: entry.kind, status: status.data });
  };

  // INSIDE moves the entry as soon as a parent is picked, to the end of its new siblings; a refusal shows above.
  const handleParent = async (e: ChangeEvent<HTMLSelectElement>) => {
    const parentId = e.target.value || null;
    const position = entries.filter(
      (s) => s.kind === entry.kind && s.parentId === parentId && s.id !== entry.id,
    ).length;
    await act({ type: "codex.move", id: entry.id, parentId, position });
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
      <EntryPath entries={entries} entry={entry} onOpen={onOpenEntry} />
      {entry.status && (
        <label className="stack">
          {t("statusLabel")}
          <select id="codex-status" value={entry.status} onChange={handleStatus} disabled={!can.write}>
            {QuestStatus.options.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
      )}
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
      {(parents.length > 0 || entry.parentId !== null) && (
        <label className="stack">
          {t("insideLabel")}
          <select id="codex-parent" value={entry.parentId ?? ""} onChange={handleParent} disabled={!can.write}>
            <option value="">{t("insideNone")}</option>
            {parents.map(({ entry: p, depth }) => (
              <option key={p.id} value={p.id}>
                {" ".repeat(depth * 3)}
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="stack">
        {t("body")}
        <MentionTextarea
          id="codex-body"
          rows={6}
          value={draft.body}
          onChange={(body) => setDraft({ ...draft, body })}
          entries={entries}
          selfId={entry.id}
          maxLength={20_000}
          disabled={!can.write}
        />
      </label>
      {hasMention && (
        <p className="dim" style={{ whiteSpace: "pre-wrap" }}>
          <MentionText body={draft.body} entries={entries} onOpen={onOpenEntry} />
        </p>
      )}
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
