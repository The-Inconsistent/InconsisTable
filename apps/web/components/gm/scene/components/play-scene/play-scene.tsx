"use client";
import {
  canInCampaign,
  type ActionInput,
  type ActionResult,
  type CodexEntry,
  type LatestBegin,
  type Me,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { InThisScene } from "@/components/gm/scene/components/in-this-scene/in-this-scene";
import { PlayPage } from "@/components/gm/scene/components/play-page/play-page";
import { ScenePreview } from "@/components/gm/scene/components/scene-preview/scene-preview";
import { SceneStrip } from "@/components/gm/scene/components/scene-strip/scene-strip";
import { WhereNext } from "@/components/gm/scene/components/where-next/where-next";
import { useLineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { RulesEntry } from "@/lib/library/library";
import { sceneNumber, type scenePlay } from "@/lib/scene-play/scene-play";
import type { LineNames, PrepWorld } from "@/lib/scene-prep/scene-prep";

type PlaySceneProps = {
  me: Me;
  play: ReturnType<typeof scenePlay>;
  /** The scene being played (`play.playing`, not null). */
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  world: PrepWorld;
  names: LineNames;
  ruleset: Ruleset | null;
  known: readonly RulesEntry[];
  act: (a: ActionInput) => Promise<ActionResult>;
  latestBegin: LatestBegin | null;
  onOpenCodex: (entryId: string) => void;
  /** The address: the scene previewed (null: none), and a move of it, one step of the browser's history. */
  previewId: string | null;
  onPreview: (id: string | null) => void;
};

// The scene being played: the strip of the adventure's scenes, the page with its lines, IN THIS SCENE beside it and WHERE
// NEXT under it; or the preview of another scene of the adventure.
export function PlayScene({
  me,
  play,
  scene,
  entries,
  world,
  names,
  ruleset,
  known,
  act,
  latestBegin,
  onOpenCodex,
  previewId,
  onPreview: setPreviewId,
}: PlaySceneProps) {
  const sender = useLineSender({
    scene,
    world,
    names,
    act,
    sided: ruleset?.initiative?.strategy === "sides",
    latestBegin,
    onOpenScene: () => setPreviewId(null),
  });
  const previewed = previewId === null ? null : (play.strip.find((s) => s.scene.id === previewId)?.scene ?? null);
  const secrets = canInCampaign({ ctx: me, perm: "codex:read_secret" });
  const page = { ruleset, entries, known, campaignId: me.campaignId, secrets, world, names, onOpenEntry: onOpenCodex };

  // BEGIN THIS SCENE on a preview: `scene.begin`, after which the begun scene is the page.
  const handleBegin = async (sceneId: string) => {
    const r = await act({ type: "scene.begin", sceneId });
    if (r.ok) setPreviewId(null);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <SceneStrip
        strip={play.strip}
        previewId={previewed?.id ?? null}
        onPreview={setPreviewId}
        onPlaying={() => setPreviewId(null)}
      />
      {previewed ? (
        <ScenePreview
          {...page}
          scene={previewed}
          adventure={play.adventure}
          number={sceneNumber({ strip: play.strip, id: previewed.id })}
          act={act}
          onBegin={handleBegin}
          onBack={() => setPreviewId(null)}
        />
      ) : (
        <div className="scene-layout">
          <div className="stack" style={{ minWidth: 0, gap: 16 }}>
            <PlayPage
              {...page}
              scene={scene}
              adventure={play.adventure}
              number={sceneNumber({ strip: play.strip, id: scene.id })}
              sender={sender}
            />
            <WhereNext sender={sender} world={world} strip={play.strip} onPreview={setPreviewId} />
          </div>
          <InThisScene
            scene={scene}
            entries={entries}
            world={world}
            sender={sender}
            act={act}
            canReveal={canInCampaign({ ctx: me, perm: "codex:reveal" })}
            canGive={canInCampaign({ ctx: me, perm: "codex:write" }) && Boolean(ruleset?.items?.give)}
            onOpenEntry={onOpenCodex}
          />
        </div>
      )}
    </div>
  );
}
