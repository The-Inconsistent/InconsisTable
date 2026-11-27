"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, ActionResult, LiveState } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { SessionAward } from "@/components/builder/ledger/play/session-award/session-award";
import { NextSessionForm } from "@/components/gm/party/components/next-session-form/next-session-form";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { DraftRecap as DraftRecapButton } from "@/components/ui/draft-recap/draft-recap";
import type { DraftRecap, Send } from "@/hooks/use-table/use-table";
import { anchorId } from "@/lib/checklist/checklist";
import { RECAP_MAX } from "@/lib/codex/codex";
import { startingAward } from "@/lib/ledger/play";
import { NEXT_SESSION_FORMAT } from "@/lib/next-session/next-session";

type SessionBandProps = {
  state: LiveState;
  send: Send;
  /** Sends an action and shows its refusal on PARTY's error line. */
  act: (a: ActionInput) => Promise<ActionResult>;
  onError: (error: string | null) => void;
  draftRecap: DraftRecap;
  ruleset: Ruleset | null;
  /** The seat may run the session (start, end) and set the next one's date. */
  run: boolean;
  plan: boolean;
};

// PARTY's band (as Auspex's): the session's state, START or END…, and NEXT SESSION, in one line on top. END… and the
// date open in a sheet, so the band stays one line at arm's length.
export function SessionBand({ state, send, act, onError, draftRecap, ruleset, run, plan }: SessionBandProps) {
  const t = useTranslations("party");
  const tNext = useTranslations("nextSession");
  const format = useFormatter();
  const [title, setTitle] = useState(""); // START SESSION's optional title
  const [recap, setRecap] = useState<string | null>(null); // the end-of-session form, open while not null
  const [award, setAward] = useState(0); // the session's XP award, set when the end-of-session form opens
  const [dating, setDating] = useState(false);
  const awardRule = ruleset?.build?.xp ? ruleset.build.award : undefined;
  const session = state.session;
  const next = state.campaign.nextSessionAt;

  // START SESSION, with the title typed, if any (the box holds at most 100 characters); it clears once started.
  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    if ((await act({ type: "session.start", title: title.trim() })).ok) setTitle("");
  };
  // END SESSION…: opens the form, the award on the middle suggested amount.
  const handleOpenEnd = () => {
    setRecap("");
    setAward(startingAward(awardRule?.suggested ?? []));
  };
  // END SESSION (confirm): the recap typed (it may be empty) and, where the ruleset gives XP, the award picked.
  const handleEndSession = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act({ type: "session.end", recap: recap ?? "", ...(awardRule ? { award } : {}) });
    if (r.ok) setRecap(null);
  };
  // END WITHOUT AN AWARD: the recap typed so far, no award step (house decision #85).
  const handleAbandon = async () => {
    const r = await act({ type: "session.abandon", recap: recap ?? "" });
    if (r.ok) setRecap(null);
  };

  if (!run && !plan) return null;
  return (
    <section className="party-band" id={anchorId("session")} tabIndex={-1}>
      {run &&
        (session ? (
          <>
            <strong className="party-band-state" role="status">
              {session.title
                ? t("liveTitled", { number: session.number, title: session.title })
                : t("live", { number: session.number })}
            </strong>
            <button className="btn primary" onClick={handleOpenEnd}>
              {t("endSessionOpen")}
            </button>
          </>
        ) : (
          <form className="row party-band-start" onSubmit={handleStart}>
            <input
              id="session-title"
              aria-label={t("sessionTitle")}
              placeholder={t("sessionTitle")}
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="btn primary">{t("startSession")}</button>
          </form>
        ))}
      {plan && (
        <button className="btn" onClick={() => setDating(true)}>
          {next ? t("nextOn", { when: format.dateTime(new Date(next), NEXT_SESSION_FORMAT) }) : t("nextSetDate")}
        </button>
      )}
      {dating && (
        <BottomSheet title={tNext("heading")} onClose={() => setDating(false)}>
          <NextSessionForm
            key={`${state.campaign.nextSessionAt}|${state.campaign.nextSessionPlace}`}
            campaign={state.campaign}
            send={send}
            onError={onError}
          />
        </BottomSheet>
      )}
      {session && recap !== null && (
        <BottomSheet title={t("endSession", { number: session.number })} onClose={() => setRecap(null)}>
          <form className="stack" onSubmit={handleEndSession}>
            <DraftRecapButton draft={draftRecap} text={recap} onFill={setRecap} onError={onError} />
            <label className="stack">
              {t("recap")}
              <textarea
                id="session-recap"
                rows={5}
                value={recap}
                onChange={(e) => setRecap(e.target.value)}
                maxLength={RECAP_MAX}
                placeholder={t("recapHint")}
                autoFocus
              />
            </label>
            {awardRule && (
              <SessionAward max={awardRule.max} suggested={awardRule.suggested} value={award} onChange={setAward} />
            )}
            <div className="row">
              <button className="btn primary">{t("endSessionConfirm", { number: session.number })}</button>
              <button type="button" className="btn" onClick={handleAbandon}>
                {t("abandonSession")}
              </button>
            </div>
          </form>
        </BottomSheet>
      )}
    </section>
  );
}
