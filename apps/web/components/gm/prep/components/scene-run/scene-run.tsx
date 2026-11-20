"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  SceneStatus,
  type ActionInput,
  type ActionResult,
  type CodexEntry,
  type PrepLine,
  type RosterLine,
} from "@inconsistable/core-schema";

import { LineText } from "@/components/gm/prep/components/line-text/line-text";
import { TestInputField } from "@/components/gm/tests/components/test-input/test-input";
import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import {
  EMPTY_PREP,
  fightSteps,
  lineAsks,
  lineName,
  PREP_ORDER,
  resolveLine,
  type FightStep,
  type LineNames,
  type PrepWorld,
} from "@/lib/scene-prep/scene-prep";
import type { InputDraft } from "@/lib/test-inputs/test-inputs";

type SceneRunProps = {
  scene: CodexEntry;
  world: PrepWorld;
  names: LineNames;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The ruleset's turn order is `sides`: the server picks each actor's side. */
  sided: boolean;
  /** An exit: opens the named scene here. */
  onOpenScene: (sceneId: string) => void;
};

// RUN: the scene's prepared lines at the table, one button each, large enough to read and tap at arm's length on the
// GM's tablet. A tap sends the action the line stands for, through the table's one path: refused as that action is, and
// in the log and Undo as that action is. Nothing records that a line was sent; a line can be sent again.
export function SceneRun({ scene, world, names, act, sided, onOpenScene }: SceneRunProps) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // the `pick` Test line whose takers are shown
  // What the GM filled in on a Test line that lacked inputs, by line id: for the next send only, never saved.
  const [filled, setFilled] = useState<Record<string, InputDraft>>({});
  const words = useSummaryWords();
  const prep = scene.prep ?? EMPTY_PREP;
  const empty = PREP_ORDER.every((k) => prep[k].length === 0);
  const creatureName = (line: RosterLine) => line.label || names.creature(line.pack, line.key) || line.key;
  const stepName = (step: FightStep) =>
    step.line ? creatureName(step.line) : t(step.action.type === "encounter.start" ? "fight.start" : "fight.party");

  // SEND: the line's action; the status line says what went out, the refusal shows where every refusal does. What the
  // GM filled in on the line served this send and is cleared.
  const handleSend = (id: string, what: string, action: ActionInput) => async () => {
    setBusy(id);
    setAsking(null);
    const r = await act(action);
    setBusy(null);
    setSent(r.ok ? t("sent", { what }) : null);
    if (r.ok) setFilled((cur) => Object.fromEntries(Object.entries(cur).filter(([lineId]) => lineId !== id)));
  };

  // An input a Test line lacked, filled in on the line.
  const handleFill = (lineId: string, inputId: string) => (value: string | boolean) =>
    setFilled((cur) => ({ ...cur, [lineId]: { ...cur[lineId], [inputId]: value } }));

  // START THE FIGHT: each step sent once the one before it went through; a refusal stops the rest and says where.
  const handleFight = async () => {
    const { steps, skipped } = fightSteps({ prep, world, sided });
    setBusy("fight");
    for (const step of steps) {
      if (!(await act(step.action)).ok) {
        setBusy(null);
        setSent(t("fight.stopped", { what: stepName(step) }));
        return;
      }
    }
    setBusy(null);
    const lines = skipped.map((s) => creatureName(s.line)).join(", ");
    setSent(skipped.length > 0 ? t("fight.skipped", { lines }) : t("fight.done"));
  };

  return (
    <section className="card stack" aria-label={scene.title} data-mode="run" style={{ minWidth: 0 }}>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h2 className="head" style={{ overflowWrap: "anywhere" }}>
          {scene.title}
        </h2>
        {scene.status && <span className="chip">{tCodex(`status.${scene.status}`)}</span>}
      </div>
      <div className="row" role="group" aria-label={t("sceneStatus")}>
        {SceneStatus.options.map((s) => (
          <button
            key={s}
            className="btn sm"
            aria-pressed={scene.status === s}
            onClick={() => act({ type: "codex.save", id: scene.id, kind: "scene", status: s })}
          >
            {t(`setStatus.${s}`)}
          </button>
        ))}
      </div>
      {sent && (
        <p className="small" role="status">
          {sent}
        </p>
      )}
      {empty && <p className="dim">{t("noLines")}</p>}
      {PREP_ORDER.filter((k) => prep[k].length > 0).map((kind) => (
        <div key={kind} className="stack" data-kind={kind}>
          <div className="row between">
            <h3 className="head">{t(`kind.${kind}`)}</h3>
            {kind === "roster" && (
              <button
                className="btn primary"
                aria-busy={busy === "fight"}
                disabled={busy !== null}
                onClick={handleFight}
              >
                {world.state.encounter ? t("joinFight") : t("startFight")}
              </button>
            )}
          </div>
          <ul className="list">
            {(prep[kind] as PrepLine[]).map((line) => {
              const resolved = resolveLine({ kind, line, world, filled: filled[line.id] });
              const what = lineName({ kind, line, names, t: words });
              const asks = "testId" in line ? lineAsks({ line, world }) : [];
              return (
                <li key={line.id} className="row between" style={{ flexWrap: "wrap", alignItems: "start" }}>
                  <span className="stack" style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <LineText kind={kind} line={line} names={names} resolved={resolved} large />
                    {"outcomes" in line && line.outcomes.length > 0 && (
                      <dl className="stack small" style={{ gap: 4, margin: 0 }}>
                        {line.outcomes.map((o, i) => (
                          <div key={i}>
                            <dt style={{ fontWeight: 700 }}>{o.label}</dt>
                            <dd style={{ margin: 0 }}>{o.text}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </span>
                  {resolved.state === "open" ? (
                    <button
                      className="btn"
                      aria-label={t("openLine", { what })}
                      onClick={() => onOpenScene(resolved.sceneId)}
                    >
                      {t("open")}
                    </button>
                  ) : resolved.state === "ready" ? (
                    <button
                      className="btn primary"
                      aria-label={t("sendLine", { what })}
                      aria-busy={busy === line.id}
                      disabled={busy !== null}
                      onClick={handleSend(line.id, what, resolved.action)}
                    >
                      {t("send")}
                    </button>
                  ) : resolved.state === "pick" ? (
                    <button
                      className="btn primary"
                      aria-label={t("sendLine", { what })}
                      aria-expanded={asking === line.id}
                      onClick={() => setAsking(asking === line.id ? null : line.id)}
                    >
                      {t("who")}
                    </button>
                  ) : resolved.state === "blocked" || resolved.state === "fill" ? (
                    <button className="btn" aria-label={t("sendLine", { what })} disabled>
                      {"takers" in line && line.takers === "pick" && resolved.state === "fill" ? t("who") : t("send")}
                    </button>
                  ) : null}
                  {asks.length > 0 && (
                    <div
                      className="row"
                      role="group"
                      aria-label={t("fillFor", { what })}
                      style={{ flexBasis: "100%", alignItems: "end" }}
                    >
                      <span className="small dim" style={{ flexBasis: "100%" }}>
                        {t("fillIn")}
                      </span>
                      {asks.map((input) => (
                        <TestInputField
                          key={input.id}
                          id={`run-${line.id}-${input.id}`}
                          input={input}
                          value={filled[line.id]?.[input.id]}
                          onChange={handleFill(line.id, input.id)}
                        />
                      ))}
                    </div>
                  )}
                  {resolved.state === "pick" && asking === line.id && (
                    <div
                      className="row"
                      role="group"
                      aria-label={t("whoTakes", { what })}
                      style={{ flexBasis: "100%" }}
                    >
                      {resolved.takers.map((a) => {
                        const picked = resolveLine({ kind, line, world, taker: a.id, filled: filled[line.id] });
                        return (
                          picked.state === "ready" && (
                            <button
                              key={a.id}
                              className="btn"
                              aria-busy={busy === line.id}
                              disabled={busy !== null}
                              onClick={handleSend(line.id, `${what} · ${a.name}`, picked.action)}
                            >
                              {a.name}
                            </button>
                          )
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
