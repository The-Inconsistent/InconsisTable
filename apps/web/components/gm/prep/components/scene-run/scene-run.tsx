"use client";
import { useTranslations } from "next-intl";

import type { ActionInput, ActionResult, CodexEntry, LatestBegin } from "@inconsistable/core-schema";

import { LineList } from "@/components/gm/prep/components/scene-run/components/line-list/line-list";
import { StatusBar } from "@/components/gm/prep/components/scene-run/components/status-bar/status-bar";
import { useLineSender } from "@/hooks/use-line-sender/use-line-sender";
import { PREP_ORDER, type LineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";

type SceneRunProps = {
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

// RUN: the scene's prepared lines at the table, one button each, large enough to read and tap at arm's length on the
// GM's tablet. The send path is use-line-sender's, which the SCENE tab shares: refused as the action is, and in the log
// and Undo as that action is.
export function SceneRun({ scene, world, names, act, sided, latestBegin, onOpenScene }: SceneRunProps) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const sender = useLineSender({ scene, world, names, act, sided, latestBegin, onOpenScene });
  const empty = PREP_ORDER.every((k) => sender.prep[k].length === 0);

  return (
    <section className="card stack" aria-label={scene.title} data-mode="run" style={{ minWidth: 0 }}>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h2 className="head" style={{ overflowWrap: "anywhere" }}>
          {scene.title}
        </h2>
        {scene.status && <span className="chip">{tCodex(`status.${scene.status}`)}</span>}
      </div>
      <StatusBar scene={scene} sender={sender} />
      {empty && <p className="dim">{t("noLines")}</p>}
      <LineList sender={sender} world={world} names={names} kinds={PREP_ORDER} fightInHeading />
    </section>
  );
}
