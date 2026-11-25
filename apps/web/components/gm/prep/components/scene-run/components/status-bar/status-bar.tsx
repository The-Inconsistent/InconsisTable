"use client";
import { useTranslations } from "next-intl";

import { SceneStatus, type CodexEntry } from "@inconsistable/core-schema";

import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";

type StatusBarProps = {
  scene: CodexEntry;
  sender: LineSender;
};

// The scene's four status buttons (PLAY THIS SCENE begins it), TAKE BACK of the room's latest begin with the names it
// revealed, and the line saying what was just sent.
export function StatusBar({ scene, sender }: StatusBarProps) {
  const t = useTranslations("prep");
  const { taken, sent, revealedTitles } = sender;
  return (
    <>
      <div className="row" role="group" aria-label={t("sceneStatus")}>
        {SceneStatus.options.map((s) => (
          <button key={s} className="btn sm" aria-pressed={scene.status === s} onClick={sender.handleStatus(s)}>
            {t(`setStatus.${s}`)}
          </button>
        ))}
        {taken && (
          <button className="btn sm" onClick={sender.handleTakeBack}>
            {t("takeBack", { title: taken.scene.title })}
          </button>
        )}
      </div>
      {taken && revealedTitles && <p className="small dim">{t("takeBackRevealed", { titles: revealedTitles })}</p>}
      {sent && (
        <p className="small" role="status">
          {sent}
        </p>
      )}
    </>
  );
}
