"use client";
import { useTranslations } from "next-intl";

import type { ActionInput, ActionResult, CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PlayPage } from "@/components/gm/scene/components/play-page/play-page";
import { useLineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { RulesEntry } from "@/lib/library/library";
import type { LineNames, PrepWorld } from "@/lib/scene-prep/scene-prep";

type ScenePreviewProps = {
  scene: CodexEntry;
  adventure: CodexEntry | null;
  number: number | null;
  ruleset: Ruleset | null;
  entries: readonly CodexEntry[];
  known: readonly RulesEntry[];
  campaignId: string;
  secrets: boolean;
  world: PrepWorld;
  names: LineNames;
  act: (a: ActionInput) => Promise<ActionResult>;
  onBegin: (sceneId: string) => void;
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
};

// A scene read before it is played: the play page with nothing to send, BEGIN THIS SCENE and BACK. Nothing is sent until
// BEGIN, which is `scene.begin`.
export function ScenePreview({
  scene,
  adventure,
  number,
  ruleset,
  entries,
  known,
  campaignId,
  secrets,
  world,
  names,
  act,
  onBegin,
  onBack,
  onOpenEntry,
}: ScenePreviewProps) {
  const t = useTranslations("scene.preview");
  // Only for the scene's prepared lines: nothing a preview draws sends.
  const sender = useLineSender({
    scene,
    world,
    names,
    act,
    sided: false,
    latestBegin: null,
    onOpenScene: onBegin,
  });
  return (
    <section className="stack" aria-label={t("title", { title: scene.title })}>
      <div className="card row between" style={{ flexWrap: "wrap" }}>
        <p className="dim">{t("note")}</p>
        <span className="row">
          <button className="btn" onClick={onBack}>
            {t("back")}
          </button>
          <button className="btn primary" onClick={() => onBegin(scene.id)}>
            {t("begin")}
          </button>
        </span>
      </div>
      <PlayPage
        scene={scene}
        adventure={adventure}
        number={number}
        ruleset={ruleset}
        entries={entries}
        known={known}
        campaignId={campaignId}
        secrets={secrets}
        sender={sender}
        world={world}
        names={names}
        readOnly
        onOpenEntry={onOpenEntry}
      />
    </section>
  );
}
