"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import { QuestStatus, splitMentions, type ActionInput, type Actor, type CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import {
  EntryFieldsForm,
  type FieldsDraft,
} from "@/components/gm/codex/components/entry-fields-form/entry-fields-form";
import { RevealForm } from "@/components/gm/codex/components/reveal-form/reveal-form";
import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { MentionTextarea } from "@/components/ui/mention-textarea/mention-textarea";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import { savePatch } from "@/lib/codex/codex";
import { declaredFields, fieldsPatch, type EntryFieldValue } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

type EntryEditorProps = {
  entry: CodexEntry;
  characters: readonly Actor[];
  /** Every entry this seat reads: the `@` picker lists them, a mention in the body opens one. */
  entries: readonly CodexEntry[];
  onOpenEntry: (entryId: string) => void;
  can: { write: boolean; secrets: boolean; reveal: boolean };
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  onDeleted: () => void;
  /** The manifest as this seat reads it: the entry's declared fields (house decision #71). */
  ruleset: Ruleset | null;
  campaignId: string;
  /** Pack entries this seat already read, to name a ref. */
  known: readonly RulesEntry[];
};

// One entry open: its title, its declared fields, body and (for a seat that may read them) GM notes, who sees it, and
// delete.
export function EntryEditor(props: EntryEditorProps) {
  const { entry, characters, entries, onOpenEntry, can, act, onDeleted, ruleset, campaignId, known } = props;
  const t = useTranslations("codex");
  const [draft, setDraft] = useState({ title: entry.title, body: entry.body, gmNotes: entry.gmNotes });
  const declared = declaredFields({ ruleset, kind: entry.kind });
  const [fieldsDraft, setFieldsDraft] = useState<FieldsDraft>(() =>
    Object.fromEntries(
      declared.map(({ id }) => [id, Object.hasOwn(entry.fields, id) ? (entry.fields[id] ?? null) : null]),
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const patch = savePatch({ entry, draft, canSecrets: can.secrets });
  const fields = fieldsPatch({ entry, draft: fieldsDraft });
  const hasMention = splitMentions(draft.body).some((p) => "id" in p);
  const dirty = (Object.keys(patch).length > 0 || fields !== null) && draft.title.trim() !== "";

  // A text field of the draft.
  const handleField = (field: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [field]: e.target.value });

  // A declared field of the draft.
  const handleDeclared = ({ id, value }: { id: string; value: EntryFieldValue | null }) =>
    setFieldsDraft({ ...fieldsDraft, [id]: value });

  // SAVE sends only the texts and fields that changed.
  const handleSave = async () => {
    if (!dirty) return;
    await act({ type: "codex.save", id: entry.id, kind: entry.kind, ...patch, ...(fields ? { fields } : {}) });
  };

  // A quest's status is saved as soon as it is picked.
  const handleStatus = async (e: ChangeEvent<HTMLSelectElement>) => {
    const status = QuestStatus.safeParse(e.target.value);
    if (status.success) await act({ type: "codex.save", id: entry.id, kind: entry.kind, status: status.data });
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
      {can.write ? (
        <EntryFieldsForm
          ruleset={ruleset}
          fields={declared}
          draft={fieldsDraft}
          onChange={handleDeclared}
          campaignId={campaignId}
          known={known}
          disabled={false}
        />
      ) : (
        <EntryFields ruleset={ruleset} entry={entry} campaignId={campaignId} known={known} />
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
