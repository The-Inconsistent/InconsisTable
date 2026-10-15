"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import type { LiveState, TestCall, TestTargetState } from "@inconsistable/core-schema";
import type { AdvantageMode } from "@inconsistable/rules-engine";

import { PoolOutcome } from "@/components/ui/pool-outcome/pool-outcome";
import { PoolPad } from "@/components/ui/pool-pad/pool-pad";
import { RollPad } from "@/components/ui/roll-pad/roll-pad";
import type { Send } from "@/hooks/use-table/use-table";
import { outcomeClass, outcomeKey, signed } from "@/lib/roll-slots/roll-slots";

type TestPromptProps = { state: LiveState; send: Send };

// The phone's Test prompt: sits at the top of the page when the GM calls a Test on one of this seat's characters. It
// asks for the number on the physical die and nothing else, and never moves the player off the table (no sound, no
// modal). The state is already this seat's own: a hidden target number is not in it.
export function TestPrompt({ state, send }: TestPromptProps) {
  const t = useTranslations("testPrompt");
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const open = state.tests.filter((c) => c.status === "open");
  // The newest closed call is kept for a moment so the result doesn't vanish the instant the GM closes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const newestClosed = state.tests.find((c) => c.status === "closed");
  const lastClosed = newestClosed?.id === dismissed ? undefined : newestClosed;

  // What a reported roll says to the player: what they read, and the rest only if the call lets the server say it.
  const resultText = ({ call, target }: { call: TestCall; target: TestTargetState }): string => {
    const report = target.report;
    if (!report) return t("waiting");
    if (call.pool) return call.status === "open" ? t("reportedWaiting") : t("closed");
    const parts = [t("rolled", { value: report.natural ?? report.total ?? "?" })];
    if (report.total !== null && report.total !== report.natural) parts.push(t("total", { total: report.total }));
    const key = outcomeKey(report.outcome);
    parts.push(key ? t(`outcome.${key}`) : call.status === "open" ? t("waiting") : t("closed"));
    return parts.join(" · ");
  };

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
    <section className="stack" aria-label={t("label")}>
      {open.flatMap((call) =>
        call.targets.map((target) => {
          const who = names.get(target.actorId) ?? t("yourCharacter");
          return (
            <div key={`${call.id}-${target.actorId}`} className="card roll-card">
              <h2 className="roll-title">
                {call.pool
                  ? t("rollPool", { pool: target.pool ?? t("your"), dice: call.dice, who })
                  : t("roll", { dice: call.dice, who })}
              </h2>
              {target.report ? (
                <p className={`roll-result ${outcomeClass(target.report.outcome)}`.trim()} role="status">
                  {call.pool ? <PoolOutcome report={target.report} /> : resultText({ call, target })}
                </p>
              ) : call.pool ? (
                <PoolPad
                  spec={call.pool}
                  pool={target.pool}
                  who={who}
                  onReport={reportPool({ callId: call.id, actorId: target.actorId })}
                />
              ) : (
                <>
                  <p className="dim small">
                    {target.modifier === null
                      ? t("readHidden")
                      : t("readModifier", { modifier: signed(target.modifier) })}
                  </p>
                  <RollPad
                    dice={call.dice}
                    allowAdvantage={call.advantage}
                    who={who}
                    onReport={report({ callId: call.id, actorId: target.actorId })}
                  />
                </>
              )}
            </div>
          );
        }),
      )}
      {lastClosed && open.length === 0 && (
        <div className="card">
          <p className="dim small">{t("lastClosed")}</p>
          {lastClosed.targets.map((target) => (
            <p key={target.actorId} className="roll-result">
              {names.get(target.actorId) ?? "?"}:{" "}
              {lastClosed.pool && target.report ? (
                <PoolOutcome report={target.report} />
              ) : (
                resultText({ call: lastClosed, target })
              )}
            </p>
          ))}
          <button className="btn" onClick={() => setDismissed(lastClosed.id)}>
            {t("gotIt")}
          </button>
        </div>
      )}
    </section>
  );
}
