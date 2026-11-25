"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import {
  HandoutLayout,
  QuestStatus,
  splitMentions,
  type ActionInput,
  type ActionResult,
  type Actor,
  type BookSource,
  type CodexEntry,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PictureField } from "@/components/gm/codex/components/entry-editor/components/picture-field/picture-field";
import { AddToScene } from "@/components/gm/codex/components/add-to-scene/add-to-scene";
import {
  EntryFieldsForm,
  type FieldsDraft,
} from "@/components/gm/codex/components/entry-fields-form/entry-fields-form";
import { ItemGive } from "@/components/gm/codex/components/item-give/item-give";
import { RevealForm } from "@/components/gm/codex/components/reveal-form/reveal-form";
import { RollInto } from "@/components/gm/codex/components/roll-into/roll-into";
import { Cite } from "@/components/ui/cite/cite";
import { EntryFields, EntryReminders } from "@/components/ui/entry-fields/entry-fields";
import { EntryPath } from "@/components/ui/entry-path/entry-path";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { MentionTextarea } from "@/components/ui/mention-textarea/mention-textarea";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import { useRoomHandouts } from "@/components/ui/room-handouts/room-handouts";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { parentOptions, savePatch, type EntryDraft } from "@/lib/codex/codex";
import { declaredFields, fieldsPatch, type EntryFieldValue } from "@/lib/entry-fields/entry-fields";
import { offeredLayouts } from "@/lib/handout/handout";
import type { RulesEntry } from "@/lib/library/library";
import type { Spawnable } from "@/lib/scene-prep/scene-prep";

type EntryEditorProps = {
  campaignId: string;
  entry: CodexEntry;
  characters: readonly Actor[];
  /** Every entry this seat reads: the `@` picker lists them, a mention in the body opens one. */
  entries: readonly CodexEntry[];
  onOpenEntry: (entryId: string) => void;
  can: { write: boolean; secrets: boolean; reveal: boolean };
  act: (a: ActionInput) => Promise<ActionResult>;
  onDeleted: () => void;
  /** The manifest as this seat reads it: the entry's declared fields (house decision #71). */
  ruleset: Ruleset | null;
  /** Pack entries this seat already read, to name a ref. */
  known: readonly RulesEntry[];
  /** The campaign fields in play, which a kind's reminders may read (house decision #97). */
  campaign?: Readonly<Record<string, string | number | boolean>>;
  /** Books a GM tablet serves: the page an entry made from a pack entry cites opens through them. */
  books?: readonly BookSource[];
  requestPage?: RequestPage;
  /** The attached packs' creatures: an entry made from one offers ADD TO SCENE. Null when they could not be read. */
  spawnable?: Spawnable | null;
};

// One entry open: its title, where it sits, its declared fields, a handout's layout and header, body and (for a seat that
// may read them) GM notes, who sees it, and delete.
export function EntryEditor(props: EntryEditorProps) {
  const { entry, characters, entries, onOpenEntry, can, act, onDeleted, ruleset, campaignId, known, campaign } = props;
  const titleRoll = ruleset?.codex?.kinds[entry.kind]?.titleRoll;
  const t = useTranslations("codex");
  const tHandout = useTranslations("handout");
  const handouts = useRoomHandouts();
  const [draft, setDraft] = useState<EntryDraft>({
    title: entry.title,
    body: entry.body,
    gmNotes: entry.gmNotes,
    ...(entry.kind === "handout" ? { layout: entry.layout ?? "plain", header: entry.header ?? "" } : {}),
  });
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
  const parents = parentOptions({ entries, entry });

  // A text field of the draft.
  const handleField =
    (field: "title" | "gmNotes" | "header") => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft({ ...draft, [field]: e.target.value });

  // A handout's layout, from the layouts the room's World offers.
  const handleLayout = (e: ChangeEvent<HTMLSelectElement>) => {
    const layout = HandoutLayout.safeParse(e.target.value);
    if (layout.success) setDraft({ ...draft, layout: layout.data });
  };

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

  // INSIDE moves the entry as soon as a parent is picked, to the end of its new siblings; a refusal shows above.
  const handleParent = async (e: ChangeEvent<HTMLSelectElement>) => {
    const parentId = e.target.value || null;
    const position = entries.filter(
      (s) => s.kind === entry.kind && s.parentId === parentId && s.id !== entry.id,
    ).length;
    await act({ type: "codex.move", id: entry.id, parentId, position });
  };

  // An adventure with scenes goes with them, once its title is typed (house decision #86), as a room is deleted.
  const withScenes = entry.kind === "adventure" && entries.some((e) => e.kind === "scene" && e.parentId === entry.id);
  const [typedTitle, setTypedTitle] = useState("");

  // DELETE, after the confirm step.
  const handleDelete = async () => {
    const r = await act({ type: "codex.delete", id: entry.id, ...(withScenes ? { withScenes: true } : {}) });
    if (r.ok) onDeleted();
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
      {titleRoll && can.write && (
        <RollInto
          roll={titleRoll}
          ruleset={ruleset}
          label={t("titleLabel")}
          act={act}
          disabled={false}
          onRolled={(title) => title && setDraft({ ...draft, title: title.slice(0, 200) })}
        />
      )}
      {entry.source && (
        <p className="row small dim" data-field="source">
          <span>{t("madeFrom", { key: entry.source.key })}</span>
          {entry.source.cite &&
            (ruleset && props.books && props.requestPage ? (
              <Cite cite={entry.source.cite} ruleset={ruleset} books={props.books} requestPage={props.requestPage} />
            ) : (
              <span>{entry.source.cite}</span>
            ))}
        </p>
      )}
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
      {can.write && <EntryReminders ruleset={ruleset} entry={entry} campaign={campaign} />}
      {can.write ? (
        <EntryFieldsForm
          ruleset={ruleset}
          fields={declared}
          draft={fieldsDraft}
          onChange={handleDeclared}
          campaignId={campaignId}
          known={known}
          disabled={false}
          entryId={entry.id}
          entries={entries}
          onOpenEntry={onOpenEntry}
          act={act}
        />
      ) : (
        <EntryFields
          ruleset={ruleset}
          entry={entry}
          campaignId={campaignId}
          known={known}
          entries={entries}
          onOpenEntry={onOpenEntry}
        />
      )}
      {draft.layout !== undefined && (
        <>
          <label className="stack">
            {tHandout("layoutLabel")}
            <select id="codex-layout" value={draft.layout} onChange={handleLayout} disabled={!can.write}>
              {offeredLayouts({ handouts, current: entry.layout }).map((l) => (
                <option key={l} value={l}>
                  {handouts?.names[l] ?? tHandout(`layout.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            {tHandout("headerLabel")}
            <input
              id="codex-header"
              value={draft.header ?? ""}
              onChange={handleField("header")}
              maxLength={120}
              disabled={!can.write}
            />
          </label>
        </>
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
      {draft.layout !== undefined ? (
        <section className="stack" aria-label={tHandout("preview")}>
          <span className="dim small">{tHandout("preview")}</span>
          <HandoutDoc
            layout={draft.layout}
            header={draft.header ?? ""}
            title={draft.title}
            body={draft.body}
            entries={entries}
            onOpen={onOpenEntry}
          />
        </section>
      ) : (
        hasMention && (
          <p className="dim" style={{ whiteSpace: "pre-wrap" }}>
            <MentionText body={draft.body} entries={entries} onOpen={onOpenEntry} />
          </p>
        )
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
              {withScenes && (
                <input
                  aria-label={t("typeToDeleteScenes")}
                  placeholder={entry.title}
                  value={typedTitle}
                  onChange={(e) => setTypedTitle(e.target.value)}
                />
              )}
              <button
                className="btn"
                disabled={withScenes && typedTitle.trim() !== entry.title.trim()}
                onClick={handleDelete}
              >
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
      <PictureField campaignId={campaignId} entry={entry} can={can} act={act} />
      {entry.kind === "item" && can.write && ruleset?.items?.give && (
        <ItemGive entry={entry} characters={characters} act={act} />
      )}
      {can.write && props.spawnable && (
        <AddToScene entry={entry} entries={entries} spawnable={props.spawnable} act={act} />
      )}
      {can.reveal && <RevealForm entry={entry} characters={characters} act={act} />}
    </section>
  );
}
