"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { TestCall, TestTargetState } from "@inconsistable/core-schema";
import type { AdvantageMode } from "@inconsistable/rules-engine";

import { PoolOutcome } from "@/components/ui/pool-outcome/pool-outcome";
import { PoolPad } from "@/components/ui/pool-pad/pool-pad";
import { RollPad } from "@/components/ui/roll-pad/roll-pad";
import type { Send } from "@/hooks/use-table/use-table";
import { outcomeClass, outcomeKey, signed } from "@/lib/roll-slots/roll-slots";

type CallCardProps = { call: TestCall; names: ReadonlyMap<string, string>; send: Send };

// One called Test on the GM's tablet: who was called, what they rolled, and the buttons to report for someone or close.
export function CallCard({ call, names, send }: CallCardProps) {
  const t = useTranslations("callCard");
  const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = call.status === "open";
  const inputs = Object.entries(call.inputs)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(", ");

  // A reported roll in one line, GM side: the die, the modifier, the total and the outcome the server resolved.
  const resultText = (target: TestTargetState): string => {
    const r = target.report;
    if (!r) return t("waiting");
    const sum =
      r.natural !== null && target.modifier !== null
        ? `${r.natural} ${signed(target.modifier)} = ${r.total}`
        : t("total", { total: r.total ?? r.natural ?? "?" });
    const key = outcomeKey(r.outcome);
    return [sum, key && t(`outcome.${key}`)].filter(Boolean).join(" · ");
  };

  // REPORT FOR: the GM types the die a player read out, or fixes a report.
  const handleReport =
    (actorId: string) =>
    async (roll: { advantage: AdvantageMode; faces: number[] }): Promise<string | null> => {
      const r = await send({
        type: "test.report",
        callId: call.id,
        actorId,
        advantage: roll.advantage,
        roll: { kind: "faces", faces: roll.faces },
      });
      if (r.ok) setReporting(null);
      return r.ok ? null : r.error;
    };

  // REPORT POOL FOR: the GM counts the dice a player read out, or fixes a report.
  const handlePoolReport =
    (actorId: string) =>
    async (roll: { kind: "pool"; counts: Record<string, number>; special: number[] }): Promise<string | null> => {
      const r = await send({ type: "test.report", callId: call.id, actorId, advantage: "none", roll });
      if (r.ok) setReporting(null);
      return r.ok ? null : r.error;
    };

  // CLOSE: ends the call; with `reveal` the called characters see each other's results.
  const handleClose = async (reveal: boolean) => {
    const r = await send({ type: "test.close", callId: call.id, reveal });
    setError(r.ok ? null : r.error);
  };

  return (
    <article className="card call-card" aria-label={t("label", { id: call.testId })}>
      <div className="row between call-head">
        <strong>
          {call.testId} <span className="dim">{call.dice}</span>
        </strong>
        <span className="row">
          <span className="chip">{open ? t("statusOpen") : call.revealed ? t("statusShown") : t("statusClosed")}</span>
          <span className="chip">{t("rolledCount", { reported: call.reported, called: call.called })}</span>
        </span>
      </div>
      {inputs && (
        <p className="dim small">
          {inputs}
          {!call.showTarget && ` ${t("hiddenTarget")}`}
        </p>
      )}
      <ul className="list">
        {call.targets.map((target) => (
          <li key={target.actorId}>
            <span className="roll-line">
              <strong>{names.get(target.actorId) ?? "?"}</strong>{" "}
              <span className="dim">
                {call.pool
                  ? t("poolLine", {
                      pool: target.pool ?? "?",
                      modifier: target.modifier !== null ? signed(target.modifier) : "?",
                      target: target.target ?? "?",
                    })
                  : target.modifier !== null &&
                    t("plainLine", { modifier: signed(target.modifier), target: target.target ?? "?" })}
              </span>
              <br />
              <span className={`roll-result ${outcomeClass(target.report?.outcome ?? null)}`.trim()}>
                {call.pool && target.report ? <PoolOutcome report={target.report} /> : resultText(target)}
              </span>
            </span>
            {open && (
              <button
                className="btn sm"
                aria-label={
                  target.report
                    ? t("changeLabel", { name: names.get(target.actorId) ?? t("aCharacter") })
                    : t("reportLabel", { name: names.get(target.actorId) ?? t("aCharacter") })
                }
                onClick={() => setReporting(reporting === target.actorId ? null : target.actorId)}
              >
                {target.report ? t("change") : t("report")}
              </button>
            )}
            {open && reporting === target.actorId && (
              <div style={{ flexBasis: "100%" }}>
                {call.pool ? (
                  <PoolPad
                    spec={call.pool}
                    pool={target.pool}
                    who={names.get(target.actorId) ?? t("aCharacter")}
                    onReport={handlePoolReport(target.actorId)}
                  />
                ) : (
                  <RollPad
                    dice={call.dice}
                    allowAdvantage={call.advantage}
                    who={names.get(target.actorId) ?? t("aCharacter")}
                    onReport={handleReport(target.actorId)}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div className="row">
          <button className="btn" onClick={() => handleClose(false)}>
            {t("close")}
          </button>
          <button className="btn" onClick={() => handleClose(true)}>
            {t("closeShow")}
          </button>
        </div>
      )}
    </article>
  );
}
