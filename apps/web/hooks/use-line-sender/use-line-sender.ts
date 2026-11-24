"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type {
  ActionInput,
  ActionResult,
  CodexEntry,
  LatestBegin,
  PickLine,
  RosterLine,
  SceneStatus,
} from "@inconsistable/core-schema";

import {
  EMPTY_PREP,
  fightSteps,
  revealedNames,
  withLine,
  withSwitch,
  type FightStep,
  type LineNames,
  type PrepWorld,
} from "@/lib/scene-prep/scene-prep";
import type { InputDraft } from "@/lib/test-inputs/test-inputs";
import { beginTakenBack } from "@/lib/scene-play/scene-play";

type LineSenderArgs = {
  scene: CodexEntry;
  world: PrepWorld;
  names: LineNames;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The ruleset's turn order is `sides`: the server picks each actor's side. */
  sided: boolean;
  /** The room's latest begin from the codex payload (null for none): what TAKE BACK takes back. */
  latestBegin: LatestBegin | null;
  /** A scene begun here (an exit, PLAY THIS SCENE): opens it here. */
  onOpenScene: (sceneId: string) => void;
};

export type LineSender = ReturnType<typeof useLineSender>;

// The one send path for a scene's prepared lines, shared by PREP's run view and the SCENE tab: a tap sends the action
// the line stands for, through the table's one path (refused as that action is, in the log and Undo as that action is).
// Nothing records that a line was sent; a line can be sent again.
export function useLineSender({ scene, world, names, act, sided, latestBegin, onOpenScene }: LineSenderArgs) {
  const t = useTranslations("prep");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // the `pick` Test line whose takers are shown
  // What the GM filled in on a Test line that lacked inputs, by line id: for the next send only, never saved.
  const [filled, setFilled] = useState<Record<string, InputDraft>>({});
  const prep = scene.prep ?? EMPTY_PREP;
  const creatureName = (line: RosterLine) => line.label || names.creature(line.pack, line.key) || line.key;
  const stepName = (step: FightStep) =>
    step.line ? creatureName(step.line) : t(step.action.type === "encounter.start" ? "fight.start" : "fight.party");

  // SEND: the line's action; the status line says what went out, the refusal shows where every refusal does. What the
  // GM filled in on the line served this send and is cleared. An exit begins its scene, which then opens here.
  const handleSend = (id: string, what: string, action: ActionInput) => async () => {
    setBusy(id);
    setAsking(null);
    const r = await act(action);
    setBusy(null);
    setSent(r.ok ? t("sent", { what }) : null);
    if (r.ok) setFilled((cur) => Object.fromEntries(Object.entries(cur).filter(([lineId]) => lineId !== id)));
    if (r.ok && action.type === "scene.begin") onOpenScene(action.sceneId);
  };

  // PLAY THIS SCENE begins it (house decision #86); the other statuses are set as they are.
  const handleStatus = (status: SceneStatus) => async () => {
    if (status !== "active") {
      await act({ type: "codex.save", id: scene.id, kind: "scene", status });
      return;
    }
    const r = await act({ type: "scene.begin", sceneId: scene.id });
    if (r.ok) onOpenScene(scene.id);
  };

  // TAKE BACK: the room's latest begin, which the server carries only while its scene is the one being played.
  const taken = beginTakenBack({ begin: latestBegin, entries: world.entries });
  const revealedTitles = taken ? revealedNames({ begin: taken.begin, entries: world.entries }) : "";
  const handleTakeBack = async () => {
    if (!taken) return;
    const what = t("takeBack", { title: taken.scene.title });
    const r = await act({ type: "scene.undoBegin", beginId: taken.begin.id });
    setSent(r.ok ? t("sent", { what }) : null);
  };

  // A picked row's switch (house decision #89): an ordinary save of the scene's prep with the row flipped.
  const handleSwitch = (line: PickLine) => async (rowId: string) => {
    setBusy(line.id);
    await act({
      type: "codex.save",
      id: scene.id,
      kind: "scene",
      prep: withLine({ prep, kind: "picks", line: withSwitch({ line, rowId }) }),
    });
    setBusy(null);
  };

  // An input a Test line lacked, filled in on the line.
  const handleFill = (lineId: string, inputId: string) => (value: string | boolean) =>
    setFilled((cur) => ({ ...cur, [lineId]: { ...cur[lineId], [inputId]: value } }));

  // START THE FIGHT: each step sent once the one before it went through; a refusal stops the rest and says where.
  const handleFight = async () => {
    const { steps, skipped } = fightSteps({ prep, world, sided });
    setBusy("fight");
    for (const step of steps) {
      if (!(await act(step.action)).ok) {
        setBusy(null);
        setSent(t("fight.stopped", { what: stepName(step) }));
        return;
      }
    }
    setBusy(null);
    const lines = skipped.map((s) => creatureName(s.line)).join(", ");
    setSent(skipped.length > 0 ? t("fight.skipped", { lines }) : t("fight.done"));
  };

  return {
    scene,
    prep,
    busy,
    sent,
    asking,
    setAsking,
    filled,
    taken,
    revealedTitles,
    handleSend,
    handleStatus,
    handleTakeBack,
    handleSwitch,
    handleFill,
    handleFight,
  };
}
