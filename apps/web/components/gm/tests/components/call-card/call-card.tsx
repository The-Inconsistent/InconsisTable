"use client";
import { useState } from "react";

import type { TestCall, TestTargetState } from "@inconsistable/core-schema";
import type { AdvantageMode } from "@inconsistable/rules-engine";

import { PoolOutcome } from "@/components/ui/pool-outcome/pool-outcome";
import { PoolPad } from "@/components/ui/pool-pad/pool-pad";
import { RollPad } from "@/components/ui/roll-pad/roll-pad";
import type { Send } from "@/hooks/use-table/use-table";
import { outcomeWord, signed } from "@/lib/roll-slots/roll-slots";

type CallCardProps = { call: TestCall; names: ReadonlyMap<string, string>; send: Send };

// A reported roll in one line, GM side: the die, the modifier, the total and the outcome the server resolved.
function resultText(t: TestTargetState): string {
  const r = t.report;
  if (!r) return "Waiting";
  const sum =
    r.natural !== null && t.modifier !== null
      ? `${r.natural} ${signed(t.modifier)} = ${r.total}`
      : `total ${r.total ?? r.natural ?? "?"}`;
  return [sum, outcomeWord(r.outcome)].filter(Boolean).join(" · ");
}

// One called Test on the GM's tablet: who was called, what they rolled, and the buttons to report for someone or close.
export function CallCard({ call, names, send }: CallCardProps) {
  const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = call.status === "open";
  const inputs = Object.entries(call.inputs)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(", ");

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
    <article className="card" aria-label={`Test ${call.testId}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>
          {call.testId} <span className="dim">{call.dice}</span>
        </strong>
        <span className="row">
          <span className="chip">{open ? "Open" : call.revealed ? "Closed, shown" : "Closed"}</span>
          <span className="chip">
            {call.reported} of {call.called} rolled
          </span>
        </span>
      </div>
      {inputs && (
        <p className="dim small">
          {inputs}
          {!call.showTarget && " (the table isn't told the number)"}
        </p>
      )}
      <ul className="list">
        {call.targets.map((t) => (
          <li key={t.actorId}>
            <span className="roll-line">
              <strong>{names.get(t.actorId) ?? "?"}</strong>{" "}
              <span className="dim">
                {call.pool
                  ? `${t.pool ?? "?"} dice (${t.modifier !== null ? signed(t.modifier) : "?"}) vs DN ${t.target ?? "?"}`
                  : t.modifier !== null && `${signed(t.modifier)} vs ${t.target ?? "?"}`}
              </span>
              <br />
              <span className="roll-result">
                {call.pool && t.report ? <PoolOutcome report={t.report} /> : resultText(t)}
              </span>
            </span>
            {open && (
              <button
                className="btn sm"
                aria-label={`${t.report ? "Change the roll of" : "Report a roll for"} ${names.get(t.actorId) ?? "a character"}`}
                onClick={() => setReporting(reporting === t.actorId ? null : t.actorId)}
              >
                {t.report ? "Change" : "Report"}
              </button>
            )}
            {open && reporting === t.actorId && (
              <div style={{ flexBasis: "100%" }}>
                {call.pool ? (
                  <PoolPad
                    spec={call.pool}
                    pool={t.pool}
                    who={names.get(t.actorId) ?? "a character"}
                    onReport={handlePoolReport(t.actorId)}
                  />
                ) : (
                  <RollPad
                    dice={call.dice}
                    allowAdvantage={call.advantage}
                    who={names.get(t.actorId) ?? "a character"}
                    onReport={handleReport(t.actorId)}
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
            Close
          </button>
          <button className="btn" onClick={() => handleClose(true)}>
            Close and show results
          </button>
        </div>
      )}
    </article>
  );
}
