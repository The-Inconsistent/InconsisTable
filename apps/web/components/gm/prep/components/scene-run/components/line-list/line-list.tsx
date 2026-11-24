"use client";
import { useTranslations } from "next-intl";

import type { PrepKind, PrepLine } from "@inconsistable/core-schema";

import { LineText } from "@/components/gm/prep/components/line-text/line-text";
import { FightButton } from "@/components/gm/prep/components/scene-run/components/fight-button/fight-button";
import { PickedRows } from "@/components/gm/prep/components/scene-run/components/picked-rows/picked-rows";
import { TestInputField } from "@/components/gm/tests/components/test-input/test-input";
import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";
import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import { lineAsks, lineName, resolveLine, type LineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";
import { testWords } from "@/lib/test-inputs/test-inputs";

type LineListProps = {
  sender: LineSender;
  world: PrepWorld;
  names: LineNames;
  /** The groups to draw, in order; a group the scene has no lines of is left out. */
  kinds: readonly PrepKind[];
  /** A read-only page (a preview): the lines as text, no button and no switch. */
  readOnly?: boolean;
  /** The roster's heading carries START THE FIGHT (the run view); the SCENE tab puts it in its side panel. */
  fightInHeading?: boolean;
};

// A scene's prepared lines by kind, one big button each, large enough to read and tap at arm's length on the GM's
// tablet. A tap sends the action the line stands for (use-line-sender).
export function LineList({ sender, world, names, kinds, readOnly = false, fightInHeading = false }: LineListProps) {
  const t = useTranslations("prep");
  const words = useSummaryWords();
  const { prep, busy, asking, filled } = sender;
  return (
    <>
      {kinds
        .filter((k) => prep[k].length > 0)
        .map((kind) => (
          <div key={kind} className="stack" data-kind={kind}>
            <div className="row between">
              <h3 className="head">{t(`kind.${kind}`)}</h3>
              {kind === "roster" && fightInHeading && !readOnly && <FightButton sender={sender} world={world} />}
            </div>
            <ul className="list">
              {(prep[kind] as PrepLine[]).map((line) => {
                const resolved = resolveLine({ kind, line, world, filled: filled[line.id] });
                const what = lineName({ kind, line, names, t: words });
                const ask =
                  "testId" in line
                    ? {
                        inputs: lineAsks({ line, world }),
                        words: testWords(names.test(line.testId) ?? { id: line.testId }),
                      }
                    : null;
                return (
                  <li key={line.id} className="row between" style={{ flexWrap: "wrap", alignItems: "start" }}>
                    <span className="stack" style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <LineText kind={kind} line={line} names={names} resolved={resolved} large />
                      {kind === "picks" && "rows" in line && !readOnly && (
                        <PickedRows
                          line={line}
                          world={world}
                          onSwitch={sender.handleSwitch(line)}
                          busy={busy !== null}
                        />
                      )}
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
                    {readOnly ? null : resolved.state === "ready" ? (
                      <button
                        className="btn primary"
                        aria-label={t("sendLine", { what })}
                        aria-busy={busy === line.id}
                        disabled={busy !== null}
                        onClick={sender.handleSend(line.id, what, resolved.action)}
                      >
                        {t("send")}
                      </button>
                    ) : resolved.state === "pick" ? (
                      <button
                        className="btn primary"
                        aria-label={t("sendLine", { what })}
                        aria-expanded={asking === line.id}
                        onClick={() => sender.setAsking(asking === line.id ? null : line.id)}
                      >
                        {t("who")}
                      </button>
                    ) : resolved.state === "blocked" || resolved.state === "fill" ? (
                      <button className="btn" aria-label={t("sendLine", { what })} disabled>
                        {"takers" in line && line.takers === "pick" && resolved.state === "fill" ? t("who") : t("send")}
                      </button>
                    ) : null}
                    {!readOnly && ask && ask.inputs.length > 0 && (
                      <div
                        className="row"
                        role="group"
                        aria-label={t("fillFor", { what })}
                        style={{ flexBasis: "100%", alignItems: "end" }}
                      >
                        <span className="small dim" style={{ flexBasis: "100%" }}>
                          {t("fillIn")}
                        </span>
                        {ask.inputs.map((input) => (
                          <TestInputField
                            key={input.id}
                            id={`run-${line.id}-${input.id}`}
                            input={input}
                            words={ask.words}
                            value={filled[line.id]?.[input.id]}
                            onChange={sender.handleFill(line.id, input.id)}
                          />
                        ))}
                      </div>
                    )}
                    {!readOnly && resolved.state === "pick" && asking === line.id && (
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
                                onClick={sender.handleSend(line.id, `${what} · ${a.name}`, picked.action)}
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
    </>
  );
}
