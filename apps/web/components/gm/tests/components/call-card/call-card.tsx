"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import type { OfferState, TestCall, TestDef, TestTargetState } from "@inconsistable/core-schema";
import { ACQUIRE_OFFERS, type AdvantageMode } from "@inconsistable/rules-engine";

import { OutcomePad } from "@/components/ui/outcome-pad/outcome-pad";
import { PoolOutcome } from "@/components/ui/pool-outcome/pool-outcome";
import { PoolPad } from "@/components/ui/pool-pad/pool-pad";
import { RollPad } from "@/components/ui/roll-pad/roll-pad";
import type { Send } from "@/hooks/use-table/use-table";
import { outcomeLabel } from "@/lib/outcome-label/outcome-label";
import { outcomeClass, outcomeKey, signed } from "@/lib/roll-slots/roll-slots";
import { testWords } from "@/lib/test-inputs/test-inputs";

type CallCardProps = {
  call: TestCall;
  /** The called Test as the ruleset declares it, for its words; undefined when the room no longer has it. */
  def: TestDef | undefined;
  names: ReadonlyMap<string, string>;
  send: Send;
};

// One called Test on the GM's tablet: who was called, what they rolled, and the buttons to report for someone or close.
export function CallCard({ call, def, names, send }: CallCardProps) {
  const t = useTranslations("callCard");
  const format = useFormatter();
  const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = call.status === "open";
  const words = testWords(def ?? { id: call.testId });
  // A mark (house decision #80) reads as its word when it is on, and not at all when it is off.
  const marks = new Map((def?.marks ?? []).map((m) => [m.id, m.label]));
  const inputs = Object.entries(call.inputs)
    .flatMap(([k, v]) => {
      const mark = marks.get(k);
      if (mark === undefined) return [`${words.input(k)} ${words.value(k, v)}`];
      return v === true ? [mark] : [];
    })
    .join(", ");

  // What an offer changes, in the ruleset's words: "+1 Menace, +6 Spare".
  const changesText = (o: OfferState): string =>
    o.changes
      .map((c) => t("offerChange", { by: format.number(c.by, { signDisplay: "always" }), label: c.label }))
      .join(", ");

  // An offer's words: an acquisition's grant (house decision #102) names the item it grants, then what it costs.
  const offerText = (o: OfferState): string =>
    [Object.values<string>(ACQUIRE_OFFERS).includes(o.id) ? t("grant", { item: o.label }) : o.label, changesText(o)]
      .filter((x) => x !== "")
      .join(" · ");

  // An offer of a taker's result: applied once through the ordinary writes; the server refuses a second tap.
  const handleOffer = (actorId: string, offerId: string) => async () => {
    const r = await send({ type: "test.applyOffer", callId: call.id, actorId, offerId });
    setError(r.ok ? null : r.error);
  };

  // A reported roll in one line, GM side: the die, the modifier, the total and the outcome the server resolved.
  const resultText = (target: TestTargetState): string => {
    const r = target.report;
    if (!r) return t("waiting");
    if (call.outcomes)
      return t("reportedResult", { label: outcomeLabel({ outcomes: call.outcomes, id: r.outcome }) ?? "?" });
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

  // REPORT OUTCOME FOR: the GM picks the result the table worked out, or fixes a report.
  const handleOutcomeReport =
    (actorId: string) =>
    async (outcome: string): Promise<string | null> => {
      const r = await send({ type: "test.report", callId: call.id, actorId, outcome });
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
    <article className="card call-card" aria-label={t("label", { id: words.test })}>
      <div className="row between call-head">
        <strong>
          {words.test} <span className="dim">{call.outcomes ? t("reportedTag") : call.dice}</span>
        </strong>
        <span className="row">
          <span className="chip">{open ? t("statusOpen") : call.revealed ? t("statusShown") : t("statusClosed")}</span>
          <span className="chip">{t("rolledCount", { reported: call.reported, called: call.called })}</span>
        </span>
      </div>
      {call.acquire && <p className="small">{t("acquiring", { item: call.acquire.name })}</p>}
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
                {call.outcomes
                  ? null
                  : call.pool
                    ? t("poolLine", {
                        pool: target.pool ?? "?",
                        modifier: target.modifier !== null ? signed(target.modifier) : "?",
                        target: target.target ?? "?",
                      })
                    : target.modifier !== null &&
                      t("plainLine", { modifier: signed(target.modifier), target: target.target ?? "?" })}
              </span>
              <br />
              <span
                className={`roll-result ${call.outcomes ? "" : outcomeClass(target.report?.outcome ?? null)}`.trim()}
              >
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
            {target.offers && target.offers.length > 0 && (
              <div
                className="row"
                style={{ flexBasis: "100%" }}
                role="group"
                aria-label={t("offers", { name: names.get(target.actorId) ?? t("aCharacter") })}
              >
                {target.offers.map((o) => (
                  <button
                    key={o.id}
                    className="btn sm"
                    disabled={o.applied}
                    aria-label={
                      o.applied
                        ? t("offerDone", { offer: o.label })
                        : t("offerApply", {
                            offer: o.label,
                            name: names.get(target.actorId) ?? t("aCharacter"),
                            changes: changesText(o),
                          })
                    }
                    onClick={handleOffer(target.actorId, o.id)}
                  >
                    {offerText(o)}
                    {o.applied && <span className="chip">{t("applied")}</span>}
                  </button>
                ))}
              </div>
            )}
            {open && reporting === target.actorId && (
              <div style={{ flexBasis: "100%" }}>
                {call.outcomes ? (
                  <OutcomePad
                    outcomes={call.outcomes}
                    who={names.get(target.actorId) ?? t("aCharacter")}
                    onReport={handleOutcomeReport(target.actorId)}
                  />
                ) : call.pool ? (
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
