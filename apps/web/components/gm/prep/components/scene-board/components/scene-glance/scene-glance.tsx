"use client";
import { useTranslations } from "next-intl";

import type { ActionInput, ActionResult, CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { sceneFixes, sceneGlance } from "@/lib/scene-play/scene-play";

type SceneGlanceProps = {
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
  /** The seat holds `codex:read_secret`: only then do `gm` fields count as fixes. */
  secrets: boolean;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** OPEN: the scene's page. */
  onOpen: () => void;
  /** RUN FROM HERE began the scene: the shell goes to the SCENE tab. */
  onPlay: () => void;
};

// The selected scene at a glance (house decision #107): what it holds, what is shown the moment it begins, what is left
// to fix before the table, and the two ways on: open its page, or begin it and go to the SCENE tab.
export function SceneGlance({ scene, entries, ruleset, secrets, act, onOpen, onPlay }: SceneGlanceProps) {
  const t = useTranslations("prep.glance");
  const tCodex = useTranslations("codex");
  const glance = sceneGlance({ scene, entries });
  const fixes = sceneFixes({ ruleset, scene, entries, secrets });

  // RUN FROM HERE: `scene.begin` of this scene, then the SCENE tab; a refusal stays on the page for the GM to read.
  const handleRun = async () => {
    const r = await act({ type: "scene.begin", sceneId: scene.id });
    if (r.ok) onPlay();
  };

  const counts = [
    ...glance.byKind.map((g) => ({ key: g.kind, label: tCodex(`kind.${g.kind}`), count: g.count })),
    { key: "tests", label: t("tests"), count: glance.tests },
    { key: "fight", label: t("fight"), count: glance.combatants },
    { key: "exits", label: t("exits"), count: glance.exits },
  ].filter((c) => c.count > 0);

  return (
    <aside className="card stack scene-glance" aria-label={t("label", { title: scene.title })}>
      <h3 className="head">{scene.title}</h3>
      {counts.length === 0 ? (
        <p className="dim">{t("empty")}</p>
      ) : (
        <ul className="row" aria-label={t("holds")}>
          {counts.map((c) => (
            <li key={c.key} className="chip">
              {t("count", { label: c.label, count: c.count })}
            </li>
          ))}
        </ul>
      )}
      <div className="stack">
        <h4 className="small">{t("onEntry")}</h4>
        {glance.shownOnEntry.length === 0 ? (
          <p className="dim small">{t("nothingOnEntry")}</p>
        ) : (
          <p className="small">{glance.shownOnEntry.map((e) => e.title).join(", ")}</p>
        )}
      </div>
      <div className="stack">
        {fixes.length === 0 ? (
          <p>
            <strong>{t("readyForTable")}</strong>
          </p>
        ) : (
          <>
            <h4 className="small">{t("toFix", { count: fixes.length })}</h4>
            <ul className="list">
              {fixes.map((f) => (
                <li key={f.kind === "field" ? f.fieldId : f.lineId}>
                  {f.kind === "field" ? t("fixField", { label: f.label }) : t("fixExit", { label: f.label })}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="row">
        <button className="btn" onClick={onOpen}>
          {t("open")}
        </button>
        <button className="btn primary" onClick={handleRun}>
          {t("run")}
        </button>
      </div>
    </aside>
  );
}
