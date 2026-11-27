"use client";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import type { ActionInput, ActionResult, CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { SceneEditor, type SceneSection } from "@/components/gm/prep/components/scene-editor/scene-editor";
import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import { declaredFields, shownFields } from "@/lib/entry-fields/entry-fields";
import { groupLinks, stepIndex } from "@/lib/prep/prep";
import type { RulesEntry } from "@/lib/library/library";
import { lineSummary, PREP_ORDER, type LineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";
import { testWords } from "@/lib/test-inputs/test-inputs";

type ScenePageProps = {
  scene: CodexEntry;
  /** The scenes beside it: the adventure's, in play order. */
  siblings: readonly CodexEntry[];
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  world: PrepWorld;
  names: LineNames;
  testIds: readonly string[];
  canSecrets: boolean;
  campaignId: string;
  known: readonly RulesEntry[];
  act: (a: ActionInput) => Promise<ActionResult>;
  onCall: (testId: string) => void;
  onOpenCodex: (entryId: string) => void;
  /** Flips to another scene of the adventure. */
  onFlip: (sceneId: string) => void;
  onStep: (args: { siblings: readonly CodexEntry[]; id: string; step: -1 | 1 }) => void;
  /** DELETE went through: the page closes. */
  onDeleted: () => void;
};

// A scene as a page (house decision #107): its parts drawn to read, a pencil on each that opens only that part's editor,
// flip to the scene before or after it, and DONE or SKIP. The editor does the saving; nothing here writes by itself.
export function ScenePage({
  scene,
  siblings,
  entries,
  ruleset,
  world,
  names,
  testIds,
  canSecrets,
  campaignId,
  known,
  act,
  onCall,
  onOpenCodex,
  onFlip,
  onStep,
  onDeleted,
}: ScenePageProps) {
  const t = useTranslations("prep.page");
  const tPrep = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const words = useSummaryWords();
  const [editing, setEditing] = useState<SceneSection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const at = siblings.findIndex((s) => s.id === scene.id);
  const before = siblings[at - 1];
  const after = siblings[at + 1];
  const groups = groupLinks({ entry: scene, entries });
  const prep = scene.prep;
  const hasLines = prep !== null && PREP_ORDER.some((k) => prep[k].length > 0);

  // DONE and SKIP set the status as the status buttons do; the scene stays where it is on the board.
  const handleStatus = (status: "done" | "skipped") => async () => {
    await act({ type: "codex.save", id: scene.id, kind: "scene", status });
  };

  // DELETE, after the confirm step: codex.delete as CODEX's entry editor sends it; a refusal shows above.
  const handleDelete = async () => {
    const r = await act({ type: "codex.delete", id: scene.id });
    if (r.ok) onDeleted();
  };

  // The pencil opens that part's editor, or closes it.
  const handlePencil = (part: SceneSection) => () => setEditing(editing === part ? null : part);

  // One part of the page: its heading with the pencil, then what it holds, or its editor while the pencil is down.
  const part = (key: SceneSection, title: string, read: ReactNode) => (
    <section className="scene-part" aria-label={title}>
      <div className="row between">
        <h3 className="head">{title}</h3>
        <button
          className="btn sm"
          aria-pressed={editing === key}
          aria-label={t(editing === key ? "closeEdit" : "edit", { part: title })}
          onClick={handlePencil(key)}
        >
          {editing === key ? t("close") : "✎"}
        </button>
      </div>
      {editing === key ? (
        <SceneEditor
          only={key}
          scene={scene}
          entries={entries}
          testIds={testIds}
          canSecrets={canSecrets}
          world={world}
          names={names}
          ruleset={ruleset}
          campaignId={campaignId}
          known={known}
          act={act}
          onCall={onCall}
          onOpenCodex={onOpenCodex}
          onSaved={() => setEditing(null)}
        />
      ) : (
        read
      )}
    </section>
  );

  return (
    <section className="card stack scene-page" aria-label={scene.title} style={{ minWidth: 0 }}>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!before} onClick={() => before && onFlip(before.id)}>
          {t("previous")}
        </button>
        <span className="small dim">{t("position", { number: at + 1, total: siblings.length })}</span>
        <button className="btn sm" disabled={!after} onClick={() => after && onFlip(after.id)}>
          {t("next")}
        </button>
      </div>
      <nav className="scene-strip" aria-label={t("strip")}>
        {siblings.map((s, i) => (
          <button
            key={s.id}
            className="btn"
            aria-current={s.id === scene.id ? "page" : undefined}
            aria-label={t("tab", { number: i + 1, title: s.title })}
            onClick={() => onFlip(s.id)}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h2 className="head" style={{ overflowWrap: "anywhere" }}>
          {scene.title}
        </h2>
        <span className="chip">{tCodex(`status.${scene.status ?? "planned"}`)}</span>
      </div>
      <div className="row" role="group" aria-label={tPrep("sceneStatus")}>
        <button className="btn sm" aria-pressed={scene.status === "done"} onClick={handleStatus("done")}>
          {tPrep("setStatus.done")}
        </button>
        <button className="btn sm" aria-pressed={scene.status === "skipped"} onClick={handleStatus("skipped")}>
          {tPrep("setStatus.skipped")}
        </button>
        <button
          className="btn sm"
          aria-label={tPrep("moveUp", { title: scene.title })}
          disabled={stepIndex({ siblings, id: scene.id, step: -1 }) === null}
          onClick={() => onStep({ siblings, id: scene.id, step: -1 })}
        >
          ↑
        </button>
        <button
          className="btn sm"
          aria-label={tPrep("moveDown", { title: scene.title })}
          disabled={stepIndex({ siblings, id: scene.id, step: 1 }) === null}
          onClick={() => onStep({ siblings, id: scene.id, step: 1 })}
        >
          ↓
        </button>
      </div>

      {declaredFields({ ruleset, kind: "scene" }).length > 0 &&
        part(
          "fields",
          t("fields"),
          shownFields({ ruleset, entry: scene }).length === 0 ? (
            <p className="dim">{t("nothingWritten")}</p>
          ) : (
            <EntryFields
              ruleset={ruleset}
              entry={scene}
              campaignId={campaignId}
              known={known}
              entries={entries}
              onOpenEntry={onOpenCodex}
            />
          ),
        )}
      {part(
        "text",
        t("text"),
        <div className="stack">
          {scene.body === "" && (!canSecrets || scene.gmNotes === "") ? (
            <p className="dim">{t("nothingWritten")}</p>
          ) : (
            <>
              <p style={{ whiteSpace: "pre-wrap" }}>
                <MentionText body={scene.body} entries={entries} onOpen={onOpenCodex} />
              </p>
              {canSecrets && scene.gmNotes !== "" && (
                <p className="dim" style={{ whiteSpace: "pre-wrap" }}>
                  <strong>{tCodex("gmNotes")}: </strong>
                  {scene.gmNotes}
                </p>
              )}
            </>
          )}
        </div>,
      )}
      {part(
        "links",
        tPrep("links"),
        groups.length === 0 ? (
          <p className="dim">{tPrep("noLinks")}</p>
        ) : (
          <div className="stack">
            {groups.map((g) => (
              <p key={g.kind} className="row">
                <span className="dim small">{tCodex(`kind.${g.kind}`)}</span>
                {g.entries.map((e) => (
                  <button key={e.id} className="mention" onClick={() => onOpenCodex(e.id)}>
                    {e.title}
                  </button>
                ))}
              </p>
            ))}
          </div>
        ),
      )}
      {part(
        "lines",
        tPrep("lines"),
        !hasLines || prep === null ? (
          <p className="dim">{tPrep("noLines")}</p>
        ) : (
          <div className="stack">
            {PREP_ORDER.filter((k) => prep[k].length > 0).map((k) => (
              <div key={k} className="stack">
                <span className="dim small">{tPrep(`kind.${k}`)}</span>
                <ul className="list">
                  {prep[k].map((line) => (
                    <li key={line.id}>{lineSummary({ kind: k, line, names, t: words })}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ),
      )}
      {part(
        "tests",
        tPrep("plannedTests"),
        scene.plannedTests.length === 0 ? (
          <p className="dim">{tPrep("noTests")}</p>
        ) : (
          <ul className="list">
            {scene.plannedTests.map((id) => (
              <li key={id}>{testWords(names.test(id) ?? { id }).test}</li>
            ))}
          </ul>
        ),
      )}
      <div className="row">
        {confirming ? (
          <>
            <button className="btn" onClick={handleDelete}>
              {tCodex("confirmDelete", { title: scene.title })}
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              {tCodex("cancel")}
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirming(true)}>
            {tCodex("delete")}
          </button>
        )}
      </div>
    </section>
  );
}
