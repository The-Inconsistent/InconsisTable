"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import {
  splitMentions,
  type ActionInput,
  type ActionResult,
  type CodexEntry,
  type CodexKind,
} from "@inconsistable/core-schema";

import type { Ruleset } from "@inconsistable/rules-engine";

import {
  EntryFieldsForm,
  type FieldsDraft,
} from "@/components/gm/codex/components/entry-fields-form/entry-fields-form";
import { PrepLines } from "@/components/gm/prep/components/prep-lines/prep-lines";
import { BudgetLines } from "@/components/ui/budget-lines/budget-lines";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { MentionTextarea } from "@/components/ui/mention-textarea/mention-textarea";
import { declaredFields, fieldsPatch, type EntryFieldValue } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";
import {
  groupLinks,
  LINKABLE_KINDS,
  linkCandidates,
  nameMatchesNone,
  namedNotLinked,
  PLANNED_TESTS_MAX,
} from "@/lib/prep/prep";
import { savePatch } from "@/lib/codex/codex";
import { EMPTY_PREP, type LineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";
import { rosterPicks, spawnRoom } from "@/lib/spawn/spawn";
import { testWords } from "@/lib/test-inputs/test-inputs";

/** The parts of the editor, so a page can open one: the declared fields, the texts, the links, the lines, the Tests. */
export const SCENE_SECTIONS = ["fields", "text", "links", "lines", "tests"] as const;
export type SceneSection = (typeof SCENE_SECTIONS)[number];

type SceneEditorProps = {
  /** Draws only this part, without the card around it; absent: the whole editor. */
  only?: SceneSection;
  /** Called after a SAVE the server took. */
  onSaved?: () => void;
  campaignId: string;
  /** Pack entries this seat already read, to name a picked ref in a declared field. */
  known: readonly RulesEntry[];
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  /** The ruleset's Test ids; a planned id outside it is shown greyed (the ruleset may have changed). */
  testIds: readonly string[];
  canSecrets: boolean;
  /** What the scene's prepared lines are resolved against, and the names they read. */
  world: PrepWorld;
  names: LineNames;
  ruleset: Ruleset | null;
  act: (a: ActionInput) => Promise<ActionResult>;
  onCall: (testId: string) => void;
  onOpenCodex: (entryId: string) => void;
};

// The most candidates the link picker lists at once; the filter narrows the rest.
const PICKER_ROWS = 8;

// One scene: its text and GM notes, the entries it links and the Tests it plans. Links and planned Tests are saved as
// they are changed; the text is saved with SAVE.
export function SceneEditor({
  only,
  onSaved,
  campaignId,
  known,
  scene,
  entries,
  testIds,
  canSecrets,
  world,
  names,
  ruleset,
  act,
  onCall,
  onOpenCodex,
}: SceneEditorProps) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const [draft, setDraft] = useState({ title: scene.title, body: scene.body, gmNotes: scene.gmNotes });
  const [query, setQuery] = useState("");
  // What the last + NEW or LINK EVERYTHING NAMED did, when the error line does not say it.
  const [note, setNote] = useState<string | null>(null);
  const declared = declaredFields({ ruleset, kind: "scene" });
  const [fieldsDraft, setFieldsDraft] = useState<FieldsDraft>(() =>
    Object.fromEntries(
      declared.map(({ id }) => [id, Object.hasOwn(scene.fields, id) ? (scene.fields[id] ?? null) : null]),
    ),
  );
  const patch = savePatch({ entry: scene, draft, canSecrets });
  const fields = fieldsPatch({ entry: scene, draft: fieldsDraft });
  const dirty = (Object.keys(patch).length > 0 || fields !== null) && draft.title.trim() !== "";
  const show = (part: SceneSection) => only === undefined || only === part;
  const groups = groupLinks({ entry: scene, entries });
  const named = namedNotLinked({ scene, entries });
  const candidates = linkCandidates({ entry: scene, entries, query }).slice(0, PICKER_ROWS);
  const addable = testIds.filter((id) => !scene.plannedTests.includes(id));
  // The roster's entries by pack and key, for the budget (house decision #92).
  const bodies = new Map(
    world.spawnable.entries.flatMap((e) => (e.body ? [[`${e.pack}/${e.key}`, e.body] as const] : [])),
  );

  // A text field of the draft.
  const handleField = (field: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [field]: e.target.value });

  // A declared field of the draft.
  const handleDeclared = ({ id, value }: { id: string; value: EntryFieldValue | null }) =>
    setFieldsDraft({ ...fieldsDraft, [id]: value });

  // SAVE sends only the texts and fields that changed.
  const handleSave = async () => {
    if (!dirty) return;
    const r = await act({ type: "codex.save", id: scene.id, kind: "scene", ...patch, ...(fields ? { fields } : {}) });
    if (r.ok) onSaved?.();
  };

  // + NEW: makes an entry of that kind from the typed name, then links the scene to it. An entry made but not linked is
  // told, never deleted; a refusal shows in the editor's error line.
  const handleNew = async (kind: CodexKind) => {
    const title = query.trim();
    const made = await act({ type: "codex.save", kind, title });
    if (!made.ok || !made.id) return;
    const linked = await act({ type: "codex.link", id: scene.id, targetId: made.id });
    setNote(linked.ok ? null : t("newNotLinked", { title }));
    if (linked.ok) setQuery("");
  };

  // LINK EVERYTHING NAMED: links each entry the text mentions, in order, and stops at the first refusal.
  const handleLinkNamed = async () => {
    let done = 0;
    for (const target of named) {
      const r = await act({ type: "codex.link", id: scene.id, targetId: target.id });
      if (!r.ok) break;
      done += 1;
    }
    setNote(t("linkedNamed", { done, total: named.length }));
  };

  // Plans a Test the ruleset has, or drops a planned one.
  const setPlanned = (plannedTests: string[]) => act({ type: "codex.save", id: scene.id, kind: "scene", plannedTests });

  // The Test picker: plans the chosen Test.
  const handlePlan = async (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value) await setPlanned([...scene.plannedTests, e.target.value]);
  };

  return (
    <section className={only ? "stack" : "card stack"} aria-label={scene.title} style={{ minWidth: 0 }}>
      {show("fields") && declared.length > 0 && (
        <EntryFieldsForm
          ruleset={ruleset}
          fields={declared}
          draft={fieldsDraft}
          onChange={handleDeclared}
          campaignId={campaignId}
          known={known}
          disabled={false}
          entryId={scene.id}
          entries={entries}
          onOpenEntry={onOpenCodex}
          act={act}
        />
      )}
      {show("text") && (
        <>
          <label className="stack">
            {tCodex("titleLabel")}
            <input id="scene-title" value={draft.title} onChange={handleField("title")} maxLength={200} />
          </label>
          <label className="stack">
            {tCodex("body")}
            <MentionTextarea
              id="scene-body"
              rows={5}
              value={draft.body}
              onChange={(body) => setDraft({ ...draft, body })}
              entries={entries}
              selfId={scene.id}
              maxLength={20_000}
            />
          </label>
          {splitMentions(draft.body).some((p) => "id" in p) && (
            <p className="dim" style={{ whiteSpace: "pre-wrap" }}>
              <MentionText body={draft.body} entries={entries} onOpen={onOpenCodex} />
            </p>
          )}
          {canSecrets && (
            <label className="stack">
              {tCodex("gmNotes")}
              <textarea
                id="scene-gm-notes"
                rows={4}
                value={draft.gmNotes}
                onChange={handleField("gmNotes")}
                maxLength={20_000}
              />
            </label>
          )}
        </>
      )}
      {(show("text") || show("fields")) && (
        <div className="row">
          <button className="btn primary" disabled={!dirty} onClick={handleSave}>
            {tCodex("save")}
          </button>
        </div>
      )}

      {show("links") && (
        <div className="stack">
          <h3 className="head">{t("links")}</h3>
          {groups.length === 0 && <p className="dim">{t("noLinks")}</p>}
          {named.length > 0 && (
            <button className="btn primary" onClick={handleLinkNamed}>
              {t("linkNamed", { count: named.length })}
            </button>
          )}
          {note && (
            <p className="small dim" role="status">
              {note}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.kind} className="stack">
              <span className="dim small">{tCodex(`kind.${g.kind}`)}</span>
              <ul className="list">
                {g.entries.map((e) => (
                  <li key={e.id} className="row between">
                    <strong>{e.title}</strong>
                    <span className="row">
                      <button className="btn sm" onClick={() => onOpenCodex(e.id)}>
                        {t("openInCodex")}
                      </button>
                      <button
                        className="btn sm"
                        aria-label={t("unlink", { title: e.title })}
                        onClick={() => act({ type: "codex.unlink", id: scene.id, targetId: e.id })}
                      >
                        {t("remove")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <input
            id="scene-link-filter"
            type="search"
            aria-label={t("linkFilter")}
            placeholder={t("linkFilter")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {nameMatchesNone({ entries, name: query }) && (
            <div className="row" role="group" aria-label={t("newEntryGroup")} style={{ flexWrap: "wrap" }}>
              {LINKABLE_KINDS.map((kind) => (
                <button key={kind} className="btn" onClick={() => handleNew(kind)}>
                  {t("newEntry", { kind: tCodex(`kind.${kind}`), title: query.trim() })}
                </button>
              ))}
            </div>
          )}
          <ul className="list">
            {candidates.length === 0 && <li className="dim">{t("noCandidates")}</li>}
            {candidates.map((e) => (
              <li key={e.id}>
                <button
                  className="btn"
                  onClick={() => act({ type: "codex.link", id: scene.id, targetId: e.id })}
                  style={{ flex: 1, justifyContent: "space-between", textAlign: "left" }}
                >
                  <strong>{e.title}</strong>
                  <span className="small dim">{tCodex(`kind.${e.kind}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {show("lines") && (
        <>
          <PrepLines
            scene={scene}
            world={world}
            names={names}
            ruleset={ruleset}
            act={act}
            heading={only === undefined}
          />
          <BudgetLines
            ruleset={ruleset}
            picks={rosterPicks({ prep: scene.prep ?? EMPTY_PREP, bodies })}
            room={spawnRoom(world.state)}
          />
        </>
      )}

      {show("tests") && (
        <div className="stack">
          <h3 className="head">{t("plannedTests")}</h3>
          {scene.plannedTests.length === 0 && <p className="dim">{t("noTests")}</p>}
          <ul className="list">
            {scene.plannedTests.map((id) => {
              const known = testIds.includes(id);
              const name = testWords(names.test(id) ?? { id }).test;
              return (
                <li key={id} className="row between">
                  <span className={known ? undefined : "dim"}>
                    <strong>{name}</strong>
                    {!known && <span className="small"> {t("unknownTest")}</span>}
                  </span>
                  <span className="row">
                    {known && (
                      <button className="btn sm primary" onClick={() => onCall(id)}>
                        {t("call")}
                      </button>
                    )}
                    <button
                      className="btn sm"
                      aria-label={t("unplan", { id: name })}
                      onClick={() => setPlanned(scene.plannedTests.filter((p) => p !== id))}
                    >
                      {t("remove")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {scene.plannedTests.length < PLANNED_TESTS_MAX && addable.length > 0 && (
            <select id="scene-plan-test" aria-label={t("planTest")} value="" onChange={handlePlan}>
              <option value="">{t("planTest")}</option>
              {addable.map((id) => (
                <option key={id} value={id}>
                  {testWords(names.test(id) ?? { id }).test}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </section>
  );
}
