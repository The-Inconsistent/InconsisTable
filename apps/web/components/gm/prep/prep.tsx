"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";

import {
  canInCampaign,
  type ActionInput,
  type Codex,
  type CodexEntry,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { SceneEditor } from "@/components/gm/prep/components/scene-editor/scene-editor";
import { SceneRun } from "@/components/gm/prep/components/scene-run/scene-run";
import type { Send } from "@/hooks/use-table/use-table";
import { prepTree, stepIndex } from "@/lib/prep/prep";
import { lineNames, type PrepWorld, type Spawnable } from "@/lib/scene-prep/scene-prep";

import { PREP_MODES, type PrepMode } from "./constants";

type PrepProps = {
  me: Me;
  state: LiveState;
  codex: Codex | null;
  send: Send;
  /** The pinned ruleset, for the kinds of line a scene offers. */
  ruleset: Ruleset | null;
  /** The attached packs' creatures; null when the page could not read them (no roster line is called broken). */
  spawnable: Spawnable | null;
  /** CALL on a planned Test: switches to TESTS with that Test selected. */
  onCall: (testId: string) => void;
  /** "Open in CODEX" on a linked entry. */
  onOpenCodex: (entryId: string) => void;
};

// PREP: the GM's adventures as scenes in play order, each scene linked to the NPCs, places and handouts it needs and the
// Tests it plans (docs/design.md §3.4). Revealing stays in CODEX.
export function Prep({ me, state, codex, send, ruleset, spawnable, onCall, onOpenCodex }: PrepProps) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<PrepMode>("prepare");
  const [newAdventure, setNewAdventure] = useState("");
  const [sceneFor, setSceneFor] = useState<string | null>(null);
  const [newScene, setNewScene] = useState("");
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const tree = useMemo(() => prepTree(entries), [entries]);
  const selected = entries.find((e) => e.id === selectedId && e.kind === "scene") ?? null;
  const secrets = canInCampaign({ ctx: me, perm: "codex:read_secret" });
  // What a scene's lines are resolved against: what this device already holds.
  const world = useMemo<PrepWorld>(
    () => ({ state, entries, spawnable: spawnable ?? { packs: [], entries: [], complete: false } }),
    [state, entries, spawnable],
  );
  const names = useMemo(() => lineNames(world), [world]);

  // Sends an action and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };

  // NEW ADVENTURE: creates it and leaves the field empty.
  const handleNewAdventure = async (e: FormEvent) => {
    e.preventDefault();
    const title = newAdventure.trim();
    if (!title) return;
    if ((await act({ type: "codex.save", kind: "adventure", title })).ok) setNewAdventure("");
  };

  // NEW SCENE under an adventure: creates it, puts it last in that adventure and opens it.
  const handleNewScene = async (e: FormEvent) => {
    e.preventDefault();
    const title = newScene.trim();
    const adventure = tree.adventures.find((a) => a.adventure.id === sceneFor);
    if (!title || !adventure) return;
    const made = await act({ type: "codex.save", kind: "scene", title });
    if (!made.ok || !made.id) return;
    const moved = await act({
      type: "codex.move",
      id: made.id,
      parentId: adventure.adventure.id,
      position: adventure.scenes.length,
    });
    if (!moved.ok) return;
    setNewScene("");
    setSceneFor(null);
    setSelectedId(made.id);
  };

  // UP / DOWN: one step among the siblings; the server renumbers them.
  const handleStep = (siblings: readonly CodexEntry[], id: string, step: -1 | 1) => async () => {
    const to = stepIndex({ siblings, id, step });
    if (to === null) return;
    const parent = siblings.find((s) => s.id === id)?.parentId ?? null;
    await act({ type: "codex.move", id, parentId: parent, position: to });
  };

  const stepButtons = (siblings: readonly CodexEntry[], e: CodexEntry) => (
    <span className="row">
      <button
        className="btn sm"
        aria-label={t("moveUp", { title: e.title })}
        disabled={stepIndex({ siblings, id: e.id, step: -1 }) === null}
        onClick={handleStep(siblings, e.id, -1)}
      >
        ↑
      </button>
      <button
        className="btn sm"
        aria-label={t("moveDown", { title: e.title })}
        disabled={stepIndex({ siblings, id: e.id, step: 1 }) === null}
        onClick={handleStep(siblings, e.id, 1)}
      >
        ↓
      </button>
    </span>
  );

  const adventureList = tree.adventures.map((a) => a.adventure);
  const sceneRow = (siblings: readonly CodexEntry[], s: CodexEntry) => (
    <li key={s.id} className="row">
      <button
        className="btn"
        aria-pressed={selectedId === s.id}
        onClick={() => setSelectedId(s.id)}
        style={{ flex: 1, justifyContent: "space-between", textAlign: "left" }}
      >
        <strong>{s.title}</strong>
        <span className="row">
          {s.status === "active" && <span className="chip">{tCodex("status.active")}</span>}
          {s.plannedTests.length > 0 && (
            <span className="chip">{t("testsCount", { count: s.plannedTests.length })}</span>
          )}
        </span>
      </button>
      {stepButtons(siblings, s)}
    </li>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="grid" style={{ alignItems: "start" }}>
        <div className="stack" style={{ minWidth: 0 }}>
          <form className="row" onSubmit={handleNewAdventure}>
            <input
              id="prep-new-adventure"
              aria-label={t("adventureTitle")}
              placeholder={t("adventureTitle")}
              value={newAdventure}
              onChange={(e) => setNewAdventure(e.target.value)}
              maxLength={200}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn primary">{t("newAdventure")}</button>
          </form>
          {tree.adventures.length === 0 && tree.loose.length === 0 && <p className="dim">{t("empty")}</p>}
          {tree.adventures.map(({ adventure, scenes }) => (
            <section key={adventure.id} className="card stack" aria-label={adventure.title}>
              <div className="row between">
                <h2 className="head">{adventure.title}</h2>
                {stepButtons(adventureList, adventure)}
              </div>
              <ul className="list">
                {scenes.length === 0 && <li className="dim">{t("noScenes")}</li>}
                {scenes.map((s) => sceneRow(scenes, s))}
              </ul>
              {sceneFor === adventure.id ? (
                <form className="row" onSubmit={handleNewScene}>
                  <input
                    id="prep-new-scene"
                    aria-label={t("sceneTitle")}
                    placeholder={t("sceneTitle")}
                    value={newScene}
                    onChange={(e) => setNewScene(e.target.value)}
                    maxLength={200}
                    style={{ flex: 1, minWidth: 0 }}
                    autoFocus
                  />
                  <button className="btn primary">{t("create")}</button>
                  <button type="button" className="btn" onClick={() => setSceneFor(null)}>
                    {t("cancel")}
                  </button>
                </form>
              ) : (
                <button className="btn" style={{ justifySelf: "start" }} onClick={() => setSceneFor(adventure.id)}>
                  {t("newScene")}
                </button>
              )}
            </section>
          ))}
          {tree.loose.length > 0 && (
            <section className="card stack" aria-label={t("loose")}>
              <h2 className="head">{t("loose")}</h2>
              <ul className="list">{tree.loose.map((s) => sceneRow(tree.loose, s))}</ul>
            </section>
          )}
        </div>
        {selected ? (
          <div className="stack" style={{ minWidth: 0 }}>
            <div className="row" role="group" aria-label={t("mode.label")}>
              {PREP_MODES.map((m) => (
                <button key={m} className="btn" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {t(`mode.${m}`)}
                </button>
              ))}
            </div>
            {mode === "run" ? (
              <SceneRun scene={selected} world={world} names={names} act={act} onOpenScene={setSelectedId} />
            ) : (
              <SceneEditor
                key={selected.id}
                scene={selected}
                entries={entries}
                testIds={state.testDefs.map((d) => d.id)}
                canSecrets={secrets}
                world={world}
                names={names}
                ruleset={ruleset}
                act={act}
                onCall={onCall}
                onOpenCodex={onOpenCodex}
              />
            )}
          </div>
        ) : (
          <p className="dim">{t("pickScene")}</p>
        )}
      </div>
    </div>
  );
}
