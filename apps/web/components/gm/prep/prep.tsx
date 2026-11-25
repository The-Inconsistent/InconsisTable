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

import { PackAdder } from "@/components/gm/codex/components/pack-adder/pack-adder";
import { ImportAdventure } from "@/components/gm/prep/components/import-adventure/import-adventure";
import { SceneBoard } from "@/components/gm/prep/components/scene-board/scene-board";
import { SceneGlance } from "@/components/gm/prep/components/scene-board/components/scene-glance/scene-glance";
import { ScenePage } from "@/components/gm/prep/components/scene-page/scene-page";
import { SceneRun } from "@/components/gm/prep/components/scene-run/scene-run";
import type { Send } from "@/hooks/use-table/use-table";
import { fromKinds } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";
import { prepTree, stepIndex } from "@/lib/prep/prep";
import { lineNames, prepWorld, type Spawnable } from "@/lib/scene-prep/scene-prep";

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
  /** Pack entries this seat already read, to name a picked ref in a scene's fields. */
  known: readonly RulesEntry[];
  /** RUN FROM HERE began a scene: the shell goes to the SCENE tab. */
  onPlay: () => void;
  /** The address (house decision #111): the scene whose page is open and how it is looked at. */
  openId: string | null;
  mode: PrepMode;
  /** Moves the address; opening a scene or switching mode is one step of the browser's history. */
  onNav: (patch: { scene?: string; mode?: PrepMode }) => void;
};

// PREP: the GM's adventures as scenes in play order, each scene linked to the NPCs, places and handouts it needs and the
// Tests it plans (docs/design.md §3.4). Revealing stays in CODEX.
export function Prep({
  me,
  state,
  codex,
  send,
  ruleset,
  spawnable,
  onCall,
  onOpenCodex,
  known,
  onPlay,
  openId,
  mode,
  onNav,
}: PrepProps) {
  const t = useTranslations("prep");
  // The board's selection is what the glance reads; the open scene (the address) is the page.
  const [selectedId, setSelectedId] = useState<string | null>(openId);
  const setOpenId = (scene: string) => onNav({ scene, mode });
  const setMode = (next: PrepMode) => onNav({ scene: openId ?? undefined, mode: next });
  const [newAdventure, setNewAdventure] = useState("");
  const [sceneFor, setSceneFor] = useState<string | null>(null);
  const [newScene, setNewScene] = useState("");
  // The adventure a scene is being made for from a pack entry (house decision #97).
  const [packFor, setPackFor] = useState<string | null>(null);
  const sceneKinds = useMemo(() => fromKinds(ruleset).filter((k) => k.kind === "scene"), [ruleset]);
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const tree = useMemo(() => prepTree(entries), [entries]);
  const selected = entries.find((e) => e.id === selectedId && e.kind === "scene") ?? null;
  const opened = entries.find((e) => e.id === openId && e.kind === "scene") ?? null;
  // The scenes beside the open one: its adventure's, else the loose ones.
  const siblings = opened
    ? (tree.adventures.find((a) => a.scenes.some((s) => s.id === opened.id))?.scenes ?? tree.loose)
    : [];
  const secrets = canInCampaign({ ctx: me, perm: "codex:read_secret" });
  const world = useMemo(() => prepWorld({ state, entries, spawnable, ruleset }), [state, entries, spawnable, ruleset]);
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
    handleFlip(made.id);
  };

  // A scene chosen to work on: selected on the board and its page opened.
  const handleFlip = (id: string) => {
    setSelectedId(id);
    setOpenId(id);
  };

  // UP / DOWN: one step among the siblings; the server renumbers them.
  const handleStep = async ({ siblings, id, step }: { siblings: readonly CodexEntry[]; id: string; step: -1 | 1 }) => {
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
        onClick={() => handleStep({ siblings, id: e.id, step: -1 })}
      >
        ↑
      </button>
      <button
        className="btn sm"
        aria-label={t("moveDown", { title: e.title })}
        disabled={stepIndex({ siblings, id: e.id, step: 1 }) === null}
        onClick={() => handleStep({ siblings, id: e.id, step: 1 })}
      >
        ↓
      </button>
    </span>
  );

  const adventureList = tree.adventures.map((a) => a.adventure);
  // One adventure's board, with the glance beside it while the selected scene is one of its.
  const board = (scenes: readonly CodexEntry[]) => (
    <div className="scene-board-wrap">
      <div className="scene-board-body">
        <SceneBoard
          scenes={scenes}
          entries={entries}
          ruleset={ruleset}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onStep={handleStep}
        />
        {selected && scenes.some((s) => s.id === selected.id) && (
          <SceneGlance
            key={selected.id}
            scene={selected}
            entries={entries}
            ruleset={ruleset}
            act={act}
            onOpen={() => setOpenId(selected.id)}
            onPlay={onPlay}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {/* No page open: the board takes the full width, so the glance sits beside it; open, the page takes the other column. */}
      <div
        className="grid"
        style={{ alignItems: "start", ...(opened ? {} : { gridTemplateColumns: "minmax(0, 1fr)" }) }}
      >
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
          {canInCampaign({ ctx: me, perm: "codex:write" }) && (
            <ImportAdventure campaignId={me.campaignId} entries={entries} actors={state.actors} send={send} />
          )}
          {tree.adventures.length === 0 && tree.loose.length === 0 && <p className="dim">{t("empty")}</p>}
          {tree.adventures.map(({ adventure, scenes }) => (
            <section key={adventure.id} className="card stack" aria-label={adventure.title}>
              <div className="row between">
                <h2 className="head">{adventure.title}</h2>
                {stepButtons(adventureList, adventure)}
              </div>
              {scenes.length === 0 ? <p className="dim">{t("noScenes")}</p> : board(scenes)}
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
              ) : packFor === adventure.id ? (
                <PackAdder
                  kinds={sceneKinds}
                  parentId={adventure.id}
                  campaignId={me.campaignId}
                  ruleset={ruleset}
                  act={act}
                  onMade={(ids) => ids[0] && handleFlip(ids[0])}
                  onClose={() => setPackFor(null)}
                />
              ) : (
                <div className="row">
                  <button className="btn" onClick={() => setSceneFor(adventure.id)}>
                    {t("newScene")}
                  </button>
                  {sceneKinds.length > 0 && (
                    <button className="btn" onClick={() => setPackFor(adventure.id)}>
                      {t("sceneFromPack")}
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}
          {tree.loose.length > 0 && (
            <section className="card stack" aria-label={t("loose")}>
              <h2 className="head">{t("loose")}</h2>
              {board(tree.loose)}
            </section>
          )}
        </div>
        {opened ? (
          <div className="stack" style={{ minWidth: 0 }}>
            <div className="row" role="group" aria-label={t("mode.label")}>
              {PREP_MODES.map((m) => (
                <button key={m} className="btn" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {t(`mode.${m}`)}
                </button>
              ))}
            </div>
            {mode === "run" ? (
              <SceneRun
                scene={opened}
                world={world}
                names={names}
                act={act}
                sided={ruleset?.initiative?.strategy === "sides"}
                latestBegin={codex?.latestBegin ?? null}
                onOpenScene={handleFlip}
              />
            ) : (
              <ScenePage
                key={opened.id}
                scene={opened}
                siblings={siblings}
                entries={entries}
                ruleset={ruleset}
                world={world}
                names={names}
                testIds={state.testDefs.map((d) => d.id)}
                canSecrets={secrets}
                campaignId={me.campaignId}
                known={known}
                act={act}
                onCall={onCall}
                onOpenCodex={onOpenCodex}
                onFlip={handleFlip}
                onStep={handleStep}
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
