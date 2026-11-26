"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Cite } from "@/components/ui/cite/cite";
import { languageRows, recordCite, setLanguage, setWealth, tapLanguage } from "@/lib/ledger/ledger";

import { useLedger } from "../../ledger-context";
import { GmRulings } from "../gm-rulings/gm-rulings";
import { StepIssues } from "../step-issues/step-issues";

// DETAIL: languages (free from the keywords, or bought, or written in for the GM to tick) and Wealth bought with XP.
// A GM-side seat also finds its rulings on this character here.
export function DetailStep() {
  const t = useTranslations("ledgerBuilder.detail");
  const { params, catalogue, build, resolved, gm, edit } = useLedger();
  const [written, setWritten] = useState("");
  if (!resolved) return <p className="dim">{t("archetypeFirst")}</p>;
  const { rows, writtenIn } = languageRows({ params, catalogue, build, resolved });
  const wealth = build.wealth ?? 0;

  // A language the table doesn't list, bought under the name the player writes.
  const handleWriteIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = written.trim();
    if (!name) return;
    edit(setLanguage({ build, name, way: "bought" }));
    setWritten("");
  };

  return (
    <div className="stack">
      <StepIssues step="detail" />
      <section className="stack" aria-labelledby="lb-languages">
        <h3 id="lb-languages" className="lb-sub">
          {t("languages")}
          <span className="small dim">
            {" "}
            · <Cite cite={params.languages.cite} />
          </span>
        </h3>
        <ul className="list lb-plain">
          {rows.map(({ language: l, way, canFree }) => (
            <li key={l.id} className="lb-taken" data-state={way ?? "open"}>
              <span className="lb-row-text">
                <span className="pick-name">{l.name}</span>
                <span className="small dim">{[recordCite(params, l), ...l.keywords].join(" · ")}</span>
                {way && <span className="lb-row-state">{t(`held.${way}`)}</span>}
              </span>
              <span className="row" role="group" aria-label={l.name}>
                <button
                  type="button"
                  className="btn sm"
                  aria-pressed={way === "picks"}
                  disabled={!canFree}
                  onClick={() => edit(tapLanguage({ build, name: l.id, way: "picks" }))}
                >
                  {t("free")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  aria-pressed={way === "bought"}
                  disabled={way === "learned"}
                  onClick={() => edit(tapLanguage({ build, name: l.id, way: "bought" }))}
                >
                  {t("buy", { xp: params.languages.xp })}
                </button>
              </span>
            </li>
          ))}
          {writtenIn.map((name) => (
            <li key={name} className="lb-taken">
              <span className="lb-row-text">
                <span className="pick-name">{name}</span>
                <span className="small dim">{t("writtenIn")}</span>
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => edit(setLanguage({ build, name, way: null }))}
                aria-label={t("removeLabel", { name })}
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={handleWriteIn}>
          <label className="stack lb-field">
            <span>{t("writeIn")}</span>
            <input value={written} onChange={(e) => setWritten(e.target.value)} maxLength={60} autoComplete="off" />
          </label>
          <button type="submit" className="btn" disabled={!written.trim()}>
            {t("add")}
          </button>
        </form>
      </section>

      <section className="stack" aria-labelledby="lb-wealth">
        <h3 id="lb-wealth" className="lb-sub">
          {t("wealth")}
          <span className="small dim">
            {" "}
            · <Cite cite={params.wealth.cite} />
          </span>
        </h3>
        <div className="score-row">
          <span className="small dim">
            {t("wealthNote", { xp: params.wealth.xp, max: params.wealth.maxBought, now: resolved.sheet.wealth })}
          </span>
          <span className="stepper">
            <button
              type="button"
              className="btn"
              disabled={wealth <= 0}
              onClick={() => edit(setWealth({ build, params, to: wealth - 1 }))}
              aria-label={t("wealthLess")}
            >
              −
            </button>
            <output aria-live="polite" aria-label={t("wealthBought", { count: wealth })}>
              {wealth}
            </output>
            <button
              type="button"
              className="btn"
              disabled={wealth >= params.wealth.maxBought}
              onClick={() => edit(setWealth({ build, params, to: wealth + 1 }))}
              aria-label={t("wealthMore")}
            >
              +
            </button>
          </span>
        </div>
      </section>

      {gm && <GmRulings />}
    </div>
  );
}
