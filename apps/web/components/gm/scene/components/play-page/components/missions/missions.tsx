"use client";
import { useTranslations } from "next-intl";

import type { Actor, CodexEntry } from "@inconsistable/core-schema";

import { sceneMissions } from "@/lib/scene-play/scene-play";

type MissionsProps = {
  scene: CodexEntry;
  adventure: CodexEntry | null;
  entries: readonly CodexEntry[];
  actors: readonly Actor[];
  /** A mission opens in Codex. */
  onOpenEntry: (entryId: string) => void;
};

// MISSIONS: the quests linked to this scene or to its adventure, each with its status and the characters it is listed to
// (house decision #108). Nothing is drawn when there are none.
export function Missions({ scene, adventure, entries, actors, onOpenEntry }: MissionsProps) {
  const t = useTranslations("scene.missions");
  const tCodex = useTranslations("codex");
  const missions = sceneMissions({ scene, adventure, entries });
  if (missions.length === 0) return null;
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return (
    <section className="stack scene-missions" aria-label={t("title")}>
      <h3 className="w-label">{t("title")}</h3>
      <ul className="list">
        {missions.map(({ quest, status, audience }) => (
          <li key={quest.id}>
            <button
              className="btn"
              aria-label={t("open", { title: quest.title })}
              onClick={() => onOpenEntry(quest.id)}
              style={{ width: "100%", justifyContent: "space-between", textAlign: "left", flexWrap: "wrap" }}
            >
              <strong>{quest.title}</strong>
              <span className="row small" style={{ flexWrap: "wrap" }}>
                {status && <span>{tCodex(`status.${status}`)}</span>}
                <span className="dim">
                  {audience.length > 0
                    ? t("listedTo", { names: audience.flatMap((id) => names.get(id) ?? []).join(", ") })
                    : t("everyone")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
