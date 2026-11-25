"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { stepIndex } from "@/lib/prep/prep";
import { sceneFixes, sceneTagline } from "@/lib/scene-play/scene-play";
import { EMPTY_PREP } from "@/lib/scene-prep/scene-prep";

type SceneBoardProps = {
  /** One adventure's scenes, in play order (or the scenes outside any adventure). */
  scenes: readonly CodexEntry[];
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  selectedId: string | null;
  onSelect: (sceneId: string) => void;
  /** One step among the siblings, as the list's arrows did. */
  onStep: (args: { siblings: readonly CodexEntry[]; id: string; step: -1 | 1 }) => void;
};

// The scenes of one adventure as cards on a spine in play order: number, title, a tagline, where the scene stands, whether
// it is ready for the table, and where its exits lead (house decision #107). Words carry every state, never colour alone.
export function SceneBoard({ scenes, entries, ruleset, selectedId, onSelect, onStep }: SceneBoardProps) {
  const t = useTranslations("prep.board");
  const tCodex = useTranslations("codex");
  const titles = new Map(entries.map((e) => [e.id, e.title]));
  return (
    <ol className="scene-board">
      {scenes.map((s, i) => {
        const fixes = sceneFixes({ ruleset, scene: s, entries }).length;
        const tagline = sceneTagline({ ruleset, scene: s });
        return (
          <li key={s.id} className="scene-card" data-selected={selectedId === s.id ? "" : undefined}>
            <span className="scene-node" aria-hidden="true">
              {i + 1}
            </span>
            <button
              className="scene-pick"
              aria-pressed={selectedId === s.id}
              aria-label={t("pick", { number: i + 1, title: s.title })}
              onClick={() => onSelect(s.id)}
            >
              <strong className="scene-title">{s.title}</strong>
              {tagline && <span className="small dim scene-tagline">{tagline}</span>}
              <span className="row">
                <span className="chip">{tCodex(`status.${s.status ?? "planned"}`)}</span>
                <span className="chip" data-ready={fixes === 0 ? "" : undefined}>
                  {fixes === 0 ? t("ready") : t("toFix", { count: fixes })}
                </span>
                {(s.prep ?? EMPTY_PREP).exits.map((x) => (
                  <span key={x.id} className="chip" data-exit={titles.has(x.sceneId) ? "" : "nowhere"}>
                    {titles.has(x.sceneId) ? t("exit", { label: x.label }) : t("nowhere", { label: x.label })}
                  </span>
                ))}
              </span>
            </button>
            <span className="row scene-steps">
              <button
                className="btn sm"
                aria-label={t("moveUp", { title: s.title })}
                disabled={stepIndex({ siblings: scenes, id: s.id, step: -1 }) === null}
                onClick={() => onStep({ siblings: scenes, id: s.id, step: -1 })}
              >
                ↑
              </button>
              <button
                className="btn sm"
                aria-label={t("moveDown", { title: s.title })}
                disabled={stepIndex({ siblings: scenes, id: s.id, step: 1 }) === null}
                onClick={() => onStep({ siblings: scenes, id: s.id, step: 1 })}
              >
                ↓
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
