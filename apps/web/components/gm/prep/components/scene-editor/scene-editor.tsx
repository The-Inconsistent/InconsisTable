"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import { splitMentions, type ActionInput, type CodexEntry } from "@inconsistable/core-schema";

import type { Ruleset } from "@inconsistable/rules-engine";

import { PrepLines } from "@/components/gm/prep/components/prep-lines/prep-lines";
import { BudgetLines } from "@/components/ui/budget-lines/budget-lines";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { MentionTextarea } from "@/components/ui/mention-textarea/mention-textarea";
import { groupLinks, linkCandidates, PLANNED_TESTS_MAX } from "@/lib/prep/prep";
import { savePatch } from "@/lib/codex/codex";
import { EMPTY_PREP, type LineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";
import { rosterPicks, spawnRoom } from "@/lib/spawn/spawn";
import { testWords } from "@/lib/test-inputs/test-inputs";

type SceneEditorProps = {
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  /** The ruleset's Test ids; a planned id outside it is shown greyed (the ruleset may have changed). */
  testIds: readonly string[];
  canSecrets: boolean;
  /** What the scene's prepared lines are resolved against, and the names they read. */
  world: PrepWorld;
  names: LineNames;
  ruleset: Ruleset | null;
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  onCall: (testId: string) => void;
  onOpenCodex: (entryId: string) => void;
};

// The most candidates the link picker lists at once; the filter narrows the rest.
const PICKER_ROWS = 8;

// One scene: its text and GM notes, the entries it links and the Tests it plans. Links and planned Tests are saved as
// they are changed; the text is saved with SAVE.
export function SceneEditor({
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
  const patch = savePatch({ entry: scene, draft, canSecrets });
  const dirty = Object.keys(patch).length > 0 && draft.title.trim() !== "";
  const groups = groupLinks({ entry: scene, entries });
  const candidates = linkCandidates({ entry: scene, entries, query }).slice(0, PICKER_ROWS);
  const addable = testIds.filter((id) => !scene.plannedTests.includes(id));
  // The roster's entries by pack and key, for the budget (house decision #92).
  const bodies = new Map(
    world.spawnable.entries.flatMap((e) => (e.body ? [[`${e.pack}/${e.key}`, e.body] as const] : [])),
  );

  // A text field of the draft.
  const handleField = (field: keyof typeof draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [field]: e.target.value });

  // SAVE sends only the fields that changed.
  const handleSave = async () => {
    if (dirty) await act({ type: "codex.save", id: scene.id, kind: "scene", ...patch });
  };

  // Plans a Test the ruleset has, or drops a planned one.
  const setPlanned = (plannedTests: string[]) => act({ type: "codex.save", id: scene.id, kind: "scene", plannedTests });

  // The Test picker: plans the chosen Test.
  const handlePlan = async (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value) await setPlanned([...scene.plannedTests, e.target.value]);
  };

  return (
    <section className="card stack" aria-label={scene.title} style={{ minWidth: 0 }}>
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
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={handleSave}>
          {tCodex("save")}
        </button>
      </div>

      <div className="stack">
        <h3 className="head">{t("links")}</h3>
        {groups.length === 0 && <p className="dim">{t("noLinks")}</p>}
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

      <PrepLines scene={scene} world={world} names={names} ruleset={ruleset} act={act} />
      <BudgetLines
        ruleset={ruleset}
        picks={rosterPicks({ prep: scene.prep ?? EMPTY_PREP, bodies })}
        room={spawnRoom(world.state)}
      />

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
    </section>
  );
}
