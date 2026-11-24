"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { PlayStrip } from "@/lib/scene-play/scene-play";
import { resolveLine, type PrepWorld } from "@/lib/scene-prep/scene-prep";

type WhereNextProps = {
  sender: LineSender;
  world: PrepWorld;
  /** The adventure's scenes: OTHER SCENE lists the ones not being played, to preview. */
  strip: PlayStrip;
  onPreview: (sceneId: string) => void;
};

// WHERE NEXT: one button per exit line, which begins the scene it names (the exit line's own `scene.begin`). An exit
// whose scene is gone is disabled and says why. OTHER SCENE lists the adventure's other scenes to preview.
export function WhereNext({ sender, world, strip, onPreview }: WhereNextProps) {
  const t = useTranslations("scene.whereNext");
  const tPrep = useTranslations("prep");
  const [others, setOthers] = useState(false);
  const rest = strip.filter((s) => !s.playing);
  return (
    <footer className="card stack scene-next" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      {sender.prep.exits.length === 0 && <p className="dim">{t("none")}</p>}
      <ul className="list">
        {sender.prep.exits.map((line) => {
          const resolved = resolveLine({ kind: "exits", line, world });
          return (
            <li key={line.id} className="row" style={{ flexWrap: "wrap" }}>
              {resolved.state === "ready" ? (
                <button
                  className="btn primary scene-exit"
                  aria-busy={sender.busy === line.id}
                  disabled={sender.busy !== null}
                  onClick={sender.handleSend(line.id, line.label, resolved.action)}
                >
                  {line.label}
                </button>
              ) : (
                <>
                  <button className="btn scene-exit" disabled>
                    {line.label}
                  </button>
                  {resolved.state === "broken" && (
                    <span className="small dim">{tPrep(`missing.${resolved.missing}`)}</span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="stack">
        <button className="btn" aria-expanded={others} onClick={() => setOthers(!others)}>
          {t("other")}
        </button>
        {others && (
          <div className="stack" role="group" aria-label={t("otherTitle")}>
            {rest.length === 0 && <p className="dim">{t("noOthers")}</p>}
            <ul className="list">
              {rest.map(({ scene }) => (
                <li key={scene.id}>
                  <button className="btn" onClick={() => onPreview(scene.id)}>
                    {scene.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </footer>
  );
}
