"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

import type { nextUp } from "@/lib/scene-play/scene-play";

type NoSceneProps = {
  offers: ReturnType<typeof nextUp>;
  /** The seat can start a fight (`encounter:run`): the fight layer holds the tracker's own start control. */
  canFight: boolean;
  busy: boolean;
  onBegin: (scene: CodexEntry) => void;
  onFight: () => void;
};

// With no scene being played: each adventure's next scene to BEGIN (running adventures first), or a fight with no scene.
export function NoScene({ offers, canFight, busy, onBegin, onFight }: NoSceneProps) {
  const t = useTranslations("scene.none");
  return (
    <section className="stack" aria-label={t("title")}>
      <h2 className="title">{t("title")}</h2>
      <p className="dim">{t("intro")}</p>
      {offers.length === 0 && <p className="dim">{t("empty")}</p>}
      <div className="grid">
        {offers.map(({ adventure, scene, running }) => (
          <article key={scene.id} className="card stack" aria-label={scene.title}>
            <p className="small dim">
              {t("next", { adventure: adventure.title })}
              {running && <span className="chip"> {t("running")}</span>}
            </p>
            <h3 className="head" style={{ overflowWrap: "anywhere" }}>
              {scene.title}
            </h3>
            <button
              className="btn primary"
              aria-label={t("beginName", { title: scene.title })}
              disabled={busy}
              onClick={() => onBegin(scene)}
            >
              {t("begin")}
            </button>
          </article>
        ))}
      </div>
      {canFight && (
        <div>
          <button className="btn" onClick={onFight}>
            {t("fight")}
          </button>
        </div>
      )}
    </section>
  );
}
