"use client";
import { useTranslations } from "next-intl";

import type { PlayStrip } from "@/lib/scene-play/scene-play";

type SceneStripProps = {
  strip: PlayStrip;
  /** The scene being previewed, if any. */
  previewId: string | null;
  onPreview: (sceneId: string) => void;
  /** Back to the scene being played. */
  onPlaying: () => void;
};

// The adventure's scenes as numbered tabs. A played one is ticked and the one being played is marked, both in words;
// tapping another opens its preview, and tapping the one being played goes back to its page.
export function SceneStrip({ strip, previewId, onPreview, onPlaying }: SceneStripProps) {
  const t = useTranslations("scene.strip");
  if (strip.length === 0) return null;
  return (
    <nav className="scene-strip" aria-label={t("label")}>
      {strip.map(({ scene, played, playing }, i) => (
        <button
          key={scene.id}
          className="btn"
          aria-current={playing && previewId === null ? "step" : undefined}
          aria-pressed={previewId === scene.id}
          aria-label={t("tab", { number: i + 1, title: scene.title })}
          onClick={() => (playing ? onPlaying() : onPreview(scene.id))}
        >
          <span aria-hidden="true">{i + 1}</span>
          {played && <span className="small"> ✓ {t("played")}</span>}
          {playing && <span className="small"> ▶ {t("playing")}</span>}
        </button>
      ))}
    </nav>
  );
}
