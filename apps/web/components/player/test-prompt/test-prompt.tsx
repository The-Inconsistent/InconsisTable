"use client";
import { useMemo, useState } from "react";

import type { LiveState, TestCall, TestTargetState } from "@inconsistable/core-schema";
import type { AdvantageMode } from "@inconsistable/rules-engine";

import { PoolOutcome } from "@/components/ui/pool-outcome/pool-outcome";
import { PoolPad } from "@/components/ui/pool-pad/pool-pad";
import { RollPad } from "@/components/ui/roll-pad/roll-pad";
import type { Send } from "@/hooks/use-table/use-table";
import { outcomeWord, signed } from "@/lib/roll-slots/roll-slots";

type TestPromptProps = { state: LiveState; send: Send };

// What a reported roll says to the player: what they read, and the rest only if the call lets the server say it.
function resultText({ call, target }: { call: TestCall; target: TestTargetState }): string {
  const report = target.report;
  if (!report) return "Waiting for the GM";
  if (call.pool) return call.status === "open" ? "Reported. Waiting for the GM" : "Closed";
  const parts = [`Rolled ${report.natural ?? report.total ?? "?"}`];
  if (report.total !== null && report.total !== report.natural) parts.push(`total ${report.total}`);
  const word = outcomeWord(report.outcome);
  parts.push(word ?? (call.status === "open" ? "Waiting for the GM" : "Closed"));
  return parts.join(" · ");
}

// The phone's Test prompt: sits at the top of the page when the GM calls a Test on one of this seat's characters. It
// asks for the number on the physical die and nothing else, and never moves the player off the table (no sound, no
// modal). The state is already this seat's own: a hidden target number is not in it.
export function TestPrompt({ state, send }: TestPromptProps) {
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const open = state.tests.filter((c) => c.status === "open");
  // The newest closed call is kept for a moment so the result doesn't vanish the instant the GM closes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const newestClosed = state.tests.find((c) => c.status === "closed");
  const lastClosed = newestClosed?.id === dismissed ? undefined : newestClosed;

  // REPORT POOL: the dice counted per band and the special dice's faces; the server counts and resolves the outcome.
  const reportPool =
    ({ callId, actorId }: { callId: string; actorId: string }) =>
    async (roll: { kind: "pool"; counts: Record<string, number>; special: number[] }): Promise<string | null> => {
      const r = await send({ type: "test.report", callId, actorId, advantage: "none", roll });
      return r.ok ? null : r.error;
    };

  // REPORT: the faces read off the die for one character; the server adds the modifier and resolves the outcome.
  const report =
    ({ callId, actorId }: { callId: string; actorId: string }) =>
    async (roll: { advantage: AdvantageMode; faces: number[] }): Promise<string | null> => {
      const r = await send({
        type: "test.report",
        callId,
        actorId,
        advantage: roll.advantage,
        roll: { kind: "faces", faces: roll.faces },
      });
      return r.ok ? null : r.error;
    };

  if (open.length === 0 && !lastClosed) return null;
  return (
    <section className="stack" aria-label="Tests called by the GM">
      {open.flatMap((call) =>
        call.targets.map((t) => {
          const who = names.get(t.actorId) ?? "your character";
          return (
            <div key={`${call.id}-${t.actorId}`} className="card roll-card">
              <h2 className="roll-title">
                Roll {call.pool ? `${t.pool ?? "your"} ${call.dice}` : call.dice} for {who}
              </h2>
              {t.report ? (
                <p className="roll-result" role="status">
                  {call.pool ? <PoolOutcome report={t.report} /> : resultText({ call, target: t })}
                </p>
              ) : call.pool ? (
                <PoolPad
                  spec={call.pool}
                  pool={t.pool}
                  who={who}
                  onReport={reportPool({ callId: call.id, actorId: t.actorId })}
                />
              ) : (
                <>
                  <p className="dim small">
                    Read the die. {t.modifier === null ? "Your modifier is" : `${signed(t.modifier)} is`} added for you.
                  </p>
                  <RollPad
                    dice={call.dice}
                    allowAdvantage={call.advantage}
                    who={who}
                    onReport={report({ callId: call.id, actorId: t.actorId })}
                  />
                </>
              )}
            </div>
          );
        }),
      )}
      {lastClosed && open.length === 0 && (
        <div className="card">
          <p className="dim small">Last Test closed</p>
          {lastClosed.targets.map((t) => (
            <p key={t.actorId} className="roll-result">
              {names.get(t.actorId) ?? "?"}:{" "}
              {lastClosed.pool && t.report ? (
                <PoolOutcome report={t.report} />
              ) : (
                resultText({ call: lastClosed, target: t })
              )}
            </p>
          ))}
          <button className="btn" onClick={() => setDismissed(lastClosed.id)}>
            Got it
          </button>
        </div>
      )}
    </section>
  );
}
