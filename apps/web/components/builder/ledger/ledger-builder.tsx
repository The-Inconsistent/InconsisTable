"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";

import type { BuildCatalogue, BuildParams, BuildStep, ResolvedBuild } from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import {
  ctxFor,
  isReady,
  issuesByStep,
  lookupsOf,
  resolveDraft,
  started,
  stepsFor,
  type LedgerBuild,
  type LedgerPlay,
} from "@/lib/ledger/ledger";

import { ArchetypeStep } from "./components/archetype-step/archetype-step";
import { AscensionStep } from "./components/ascension-step/ascension-step";
import { CustomiseStep } from "./components/customise-step/customise-step";
import { DetailStep } from "./components/detail-step/detail-step";
import { FactionStep } from "./components/faction-step/faction-step";
import { LedgerPanel } from "./components/ledger-panel/ledger-panel";
import { TierStep } from "./components/tier-step/tier-step";
import { XpBar } from "./components/xp-bar/xp-bar";
import { LedgerProvider, type LedgerState } from "./ledger-context";

export type LedgerBuilderProps = {
  params: BuildParams;
  catalogue: BuildCatalogue;
  // the builder's input document; `onChange` receives the next one after every tap
  build: LedgerBuild;
  onChange: (next: LedgerBuild) => void;
  // a GM-side seat: sets the Tier, ticks what only the GM can judge, makes rulings
  gm: boolean;
  // the Tier when it is given from outside (the room's): shown, and nobody sets it in the Tier step
  tier?: number | undefined;
  // a character in play: the Tier now and the XP earned (passed to `resolveBuild`)
  play?: LedgerPlay | undefined;
  // where the caller puts its own controls (a save button), told whether the build is ready to save
  footer?: (state: { ready: boolean; resolved: ResolvedBuild | null }) => ReactNode;
};

const STEP_SCREENS: Record<BuildStep, () => ReactNode> = {
  tier: () => <TierStep />,
  archetype: () => <ArchetypeStep />,
  customise: () => <CustomiseStep layer="creation" />,
  faction: () => <FactionStep />,
  ascension: () => <AscensionStep />,
  detail: () => <DetailStep />,
  advance: () => <CustomiseStep layer="advancement" />,
};

// The ledger builder (docs/adr/0011, stage 4): a character bought with XP from a catalogue, step by step, resolved on
// the device by `resolveBuild` after every tap. Controlled: the build lives with the caller, which also decides what
// saving means. Nothing here knows a game: every label that is the game's comes from the params, the catalogue or the
// resolved build. Ported from Auspex's builder: its flow and behaviour, this app's look.
export function LedgerBuilder({ params, catalogue, build, onChange, gm, tier, play, footer }: LedgerBuilderProps) {
  const t = useTranslations("ledgerBuilder");
  const lookups = useMemo(() => lookupsOf(catalogue.creation), [catalogue]);
  const { resolved, error } = useMemo(
    () => resolveDraft({ params, catalogue, build, play }),
    [params, catalogue, build, play],
  );
  const issues = useMemo(() => issuesByStep(resolved), [resolved]);
  const ctx = useMemo(
    () => ctxFor({ params, catalogue, lookups, build, resolved }),
    [params, catalogue, lookups, build, resolved],
  );
  const steps = stepsFor({ build, lookups, play, gm });
  // A build already begun opens on its purchases; a new one on the Tier, as in Auspex.
  const [chosen, setChosen] = useState<BuildStep>(() => (started(build) ? "customise" : "tier"));
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const step = steps.includes(chosen) ? chosen : steps[0]!; // stepsFor always gives at least one step
  const next = steps[steps.indexOf(step) + 1];

  const value = useMemo<LedgerState>(() => {
    // Another step, from the top of the page.
    const go = (s: BuildStep) => {
      setChosen(s);
      setLedgerOpen(false);
      window.scrollTo({ top: 0 });
    };
    return { params, catalogue, lookups, build, resolved, issues, ctx, gm, tier, play, edit: onChange, go };
  }, [params, catalogue, lookups, build, resolved, issues, ctx, gm, tier, play, onChange, setChosen, setLedgerOpen]);

  return (
    <LedgerProvider value={value}>
      <div className="stack lb">
        {error && (
          <p className="error" role="alert">
            {t("refused")} <span className="small">{error.slice(0, 300)}</span>
          </p>
        )}
        <div className="lb-body">
          <nav className="mf-tabs lb-steps" role="tablist" aria-label={t("nav.label")}>
            {steps.map((s, i) => {
              const left = issues[s].left;
              return (
                <button
                  key={s}
                  id={`lb-tab-${s}`}
                  type="button"
                  role="tab"
                  className="mf-tab"
                  aria-selected={s === step}
                  aria-controls="lb-panel"
                  onClick={() => value.go(s)}
                >
                  <span>{t("nav.step", { n: i + 1, step: t(`steps.${s}`) })}</span>
                  {left > 0 && (
                    <>
                      <span className="mf-count" aria-hidden>
                        {left}
                      </span>
                      <span className="sr-only">{t("nav.left", { count: left })}</span>
                    </>
                  )}
                </button>
              );
            })}
          </nav>
          <section id="lb-panel" role="tabpanel" aria-labelledby={`lb-tab-${step}`} className="card stack lb-panel">
            <h2 className="step-title">{t(`steps.${step}`)}</h2>
            {STEP_SCREENS[step]()}
            {next && (
              <button type="button" className="btn primary lb-next" onClick={() => value.go(next)}>
                {t("nav.next", { step: t(`steps.${next}`) })}
              </button>
            )}
          </section>
        </div>
        <XpBar onOpen={() => setLedgerOpen(true)} footer={footer?.({ ready: isReady(resolved), resolved })} />
        {ledgerOpen && (
          <BottomSheet title={t("ledger.title")} onClose={() => setLedgerOpen(false)}>
            <LedgerPanel onGo={value.go} />
          </BottomSheet>
        )}
      </div>
    </LedgerProvider>
  );
}
