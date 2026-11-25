"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { ActionInput, ActionResult, CodexEntry } from "@inconsistable/core-schema";

import { lineId } from "@/components/gm/prep/components/line-form/constants";
import { sceneTargets } from "@/lib/prep/prep";
import { creatureLine, creatureOf, EMPTY_PREP, withLine, type Spawnable } from "@/lib/scene-prep/scene-prep";

type AddToSceneProps = {
  entry: CodexEntry;
  entries: readonly CodexEntry[];
  spawnable: Spawnable;
  act: (a: ActionInput) => Promise<ActionResult>;
};

// ADD TO SCENE on an entry made from a pack creature: pick an adventure, then a scene (the one in play and the planned
// ones first), and the creature joins that scene's prepared fight as one roster line (house decision #108).
export function AddToScene({ entry, entries, spawnable, act }: AddToSceneProps) {
  const t = useTranslations("codex.addToScene");
  const tStatus = useTranslations("codex.status");
  const creature = creatureOf({ entry, spawnable });
  const targets = sceneTargets(entries);
  const [groupAt, setGroupAt] = useState(0);
  const [sceneId, setSceneId] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  if (!creature || targets.length === 0) return null;
  const group = targets[groupAt] ?? targets[0];
  const scenes = group?.scenes ?? [];
  const picked = scenes.find((s) => s.id === sceneId) ?? scenes[0];

  // The adventure picker: its first scene is the one offered.
  const handleGroup = (e: ChangeEvent<HTMLSelectElement>) => {
    setGroupAt(Number(e.target.value));
    setSceneId("");
    setAdded(null);
  };

  // The scene picker.
  const handleScene = (e: ChangeEvent<HTMLSelectElement>) => {
    setSceneId(e.target.value);
    setAdded(null);
  };

  // ADD: appends the roster line to the scene's prepared lines and saves them, as the scene editor does.
  const handleAdd = async () => {
    if (!picked) return;
    const prep = withLine({
      prep: picked.prep ?? EMPTY_PREP,
      kind: "roster",
      line: creatureLine({ creature, id: lineId() }),
    });
    const r = await act({ type: "codex.save", id: picked.id, kind: "scene", prep });
    if (r.ok) setAdded(picked.title);
  };

  return (
    <section className="stack" aria-label={t("title")}>
      <h3 className="head">{t("title")}</h3>
      <label className="stack">
        {t("adventure")}
        <select id="add-to-scene-adventure" value={groupAt} onChange={handleGroup}>
          {targets.map((g, i) => (
            <option key={g.adventure?.id ?? "loose"} value={i}>
              {g.adventure?.title ?? t("noAdventure")}
            </option>
          ))}
        </select>
      </label>
      <label className="stack">
        {t("scene")}
        <select id="add-to-scene-scene" value={picked?.id ?? ""} onChange={handleScene}>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {t("sceneOption", { title: s.title, status: tStatus(s.status ?? "planned") })}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="btn primary" onClick={handleAdd}>
          {t("add", { name: creature.name })}
        </button>
        {added && (
          <span className="small" role="status">
            {t("added", { scene: added })}
          </span>
        )}
      </div>
    </section>
  );
}
