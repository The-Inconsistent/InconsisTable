"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { LedgerBuilder } from "@/components/builder/ledger/ledger-builder";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import type { LedgerBuild } from "@/lib/ledger/ledger";
import { SAMPLE_PARAMS, sampleCatalogue } from "@/lib/ledger/sample";

const catalogue = sampleCatalogue();
// A build begun: an Archetype taken, the rest still to settle.
const START: LedgerBuild = { tier: 1, archetypeId: "lamplighter" };
const XP_EARNED = 60; // in play: enough to buy a few points

// The development page's shell: the builder with switches for the seat (player or GM side) and the time (at creation,
// or in play a Tier higher). The build lives in this state only.
export function LedgerDev() {
  const t = useTranslations("ledgerBuilder.dev");
  const [build, setBuild] = useState<LedgerBuild>(START);
  const [gm, setGm] = useState(false);
  const [inPlay, setInPlay] = useState(false);
  const [run, setRun] = useState(0); // a new run remounts the builder on its first step
  const playTier = Math.min(build.tier + 1, SAMPLE_PARAMS.tiers.max);
  const play = useMemo(() => (inPlay ? { tier: playTier, xpEarned: XP_EARNED } : undefined), [inPlay, playTier]);

  // Start over: an empty build at the lowest Tier, from the first step.
  const handleStartOver = () => {
    setBuild({ tier: SAMPLE_PARAMS.tiers.min });
    setRun(run + 1);
  };

  return (
    <>
      <header className="band">
        <strong>{t("title")}</strong>
        <LocaleSwitch />
        <ThemeSwitch />
      </header>
      <main className="page lb-page">
        <p className="dim">{t("lede")}</p>
        <div className="row">
          <span className="seg" role="group" aria-label={t("seat")}>
            <button type="button" className="btn sm" aria-pressed={!gm} onClick={() => setGm(false)}>
              {t("player")}
            </button>
            <button type="button" className="btn sm" aria-pressed={gm} onClick={() => setGm(true)}>
              {t("gm")}
            </button>
          </span>
          <span className="seg" role="group" aria-label={t("time")}>
            <button type="button" className="btn sm" aria-pressed={!inPlay} onClick={() => setInPlay(false)}>
              {t("creation")}
            </button>
            <button type="button" className="btn sm" aria-pressed={inPlay} onClick={() => setInPlay(true)}>
              {t("inPlay", { tier: playTier })}
            </button>
          </span>
          <button type="button" className="btn sm" onClick={handleStartOver}>
            {t("startOver")}
          </button>
        </div>
        <LedgerBuilder
          key={run}
          params={SAMPLE_PARAMS}
          catalogue={catalogue}
          build={build}
          onChange={setBuild}
          gm={gm}
          play={play}
          footer={({ ready }) => <span className="small dim">{ready ? t("readyToSave") : t("notReady")}</span>}
        />
      </main>
    </>
  );
}
