"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  MAX_PREP_LINES,
  type ActionInput,
  type CodexEntry,
  type PrepKind,
  type PrepLine,
  type ScenePrep,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { LineForm } from "@/components/gm/prep/components/line-form/line-form";
import { LineText } from "@/components/gm/prep/components/line-text/line-text";
import {
  EMPTY_PREP,
  offeredKinds,
  PREP_ORDER,
  resolveLine,
  stepLine,
  withLine,
  withoutLine,
  type LineNames,
  type PrepWorld,
} from "@/lib/scene-prep/scene-prep";

type PrepLinesProps = {
  scene: CodexEntry;
  world: PrepWorld;
  names: LineNames;
  ruleset: Ruleset | null;
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  /** False when the page around it already names the section. */
  heading?: boolean;
};

// The scene's prepared lines, grouped by kind as the scene screens show them; each is added, changed, moved or removed,
// and every change saves the whole document. A kind the room cannot use is not offered, but its lines stay, shown
// broken.
export function PrepLines({ scene, world, names, ruleset, act, heading = true }: PrepLinesProps) {
  const t = useTranslations("prep");
  const [editing, setEditing] = useState<{ kind: PrepKind; id: string | null } | null>(null);
  const prep = scene.prep ?? EMPTY_PREP;
  const offered = offeredKinds({ ruleset, spawnable: world.spawnable });
  const kinds = PREP_ORDER.filter((k) => offered.includes(k) || prep[k].length > 0);

  // Saves the whole document; an empty one is stored as none.
  const save = async (next: ScenePrep) => {
    const empty = PREP_ORDER.every((k) => next[k].length === 0);
    return act({ type: "codex.save", id: scene.id, kind: "scene", prep: empty ? null : next });
  };

  // SAVE LINE: puts the line in place (or last) and closes the form once the api took it.
  const handleSave = (kind: PrepKind) => async (line: PrepLine) => {
    if ((await save(withLine({ prep, kind, line: line as never }))).ok) setEditing(null);
  };

  return (
    <div className="stack">
      {heading && <h3 className="head">{t("lines")}</h3>}
      {kinds.map((kind) => {
        const lines = prep[kind] as PrepLine[];
        return (
          <section key={kind} className="stack" aria-label={t(`kind.${kind}`)} data-kind={kind}>
            <span className="dim small">{t(`kind.${kind}`)}</span>
            <ul className="list">
              {lines.map((line, i) =>
                editing?.kind === kind && editing.id === line.id ? (
                  <li key={line.id}>
                    <LineForm
                      kind={kind}
                      line={line}
                      scene={scene}
                      entries={world.entries}
                      state={world.state}
                      ruleset={ruleset}
                      spawnable={world.spawnable}
                      onSave={handleSave(kind)}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li key={line.id} className="row between" style={{ flexWrap: "wrap" }}>
                    <LineText kind={kind} line={line} names={names} resolved={resolveLine({ kind, line, world })} />
                    <span className="row">
                      <button
                        className="btn sm"
                        aria-label={t("moveLineUp")}
                        disabled={i === 0}
                        onClick={() => save(stepLine({ prep, kind, id: line.id, step: -1 }))}
                      >
                        ↑
                      </button>
                      <button
                        className="btn sm"
                        aria-label={t("moveLineDown")}
                        disabled={i === lines.length - 1}
                        onClick={() => save(stepLine({ prep, kind, id: line.id, step: 1 }))}
                      >
                        ↓
                      </button>
                      <button className="btn sm" onClick={() => setEditing({ kind, id: line.id })}>
                        {t("edit")}
                      </button>
                      <button className="btn sm" onClick={() => save(withoutLine({ prep, kind, id: line.id }))}>
                        {t("remove")}
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
            {editing?.kind === kind && editing.id === null ? (
              <LineForm
                kind={kind}
                scene={scene}
                entries={world.entries}
                state={world.state}
                ruleset={ruleset}
                spawnable={world.spawnable}
                onSave={handleSave(kind)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              offered.includes(kind) &&
              lines.length < MAX_PREP_LINES && (
                <button
                  className="btn sm"
                  style={{ justifySelf: "start" }}
                  data-add={kind}
                  onClick={() => setEditing({ kind, id: null })}
                >
                  {t(`add.${kind}`)}
                </button>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
