"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { AscendKind } from "@inconsistable/core-schema";

import { AscensionPanel } from "@/components/builder/ledger/play/ascension-panel/ascension-panel";
import { SessionAward } from "@/components/builder/ledger/play/session-award/session-award";
import { XpBox } from "@/components/builder/ledger/play/xp-box/xp-box";
import { rankOf } from "@/lib/ledger/play";

import { ASCENSION_CASES, SAMPLE_MEMBERS, SAMPLE_PLAY, XP_CASES, type AscensionCase, type XpCase } from "./constants";

const P = SAMPLE_PLAY;
const rank = (earned: number) => rankOf({ earned, xpPerRank: P.xpPerRank, top: P.topRank });

// The development page's Play part: the screens a table needs once ledger-built characters are in play, on invented
// figures, with switches for the cases worth looking at. Nothing is sent: a press is only written below the panel.
export function PlayDev() {
  const t = useTranslations("ledgerBuilder.dev.play");
  const [ascension, setAscension] = useState<AscensionCase>("short");
  const [xp, setXp] = useState<XpCase>("toSpend");
  const [award, setAward] = useState<number>(P.award.value);
  const [sent, setSent] = useState<{ kind: AscendKind; waivePackage: boolean } | null>(null);
  const members = SAMPLE_MEMBERS.map((m) => ({
    id: m.id,
    name: m.name,
    rank: rank(m.earned),
    earnedThisTier: ascension === "short" && m.id === P.short.id ? P.short.earnedThisTier : m.earnedThisTier,
    gone: m.gone,
  }));

  return (
    <section className="stack lb-play-dev" aria-labelledby="lb-play-dev">
      <h2 id="lb-play-dev" className="step-title">
        {t("title")}
      </h2>
      <p className="dim">{t("lede")}</p>
      <div className="row">
        <span className="seg" role="group" aria-label={t("ascension")}>
          {ASCENSION_CASES.map((c) => (
            <button
              key={c}
              type="button"
              className="btn sm"
              aria-pressed={ascension === c}
              onClick={() => setAscension(c)}
            >
              {t(`cases.${c}`)}
            </button>
          ))}
        </span>
        <span className="seg" role="group" aria-label={t("xp")}>
          {XP_CASES.map((c) => (
            <button key={c} type="button" className="btn sm" aria-pressed={xp === c} onClick={() => setXp(c)}>
              {t(`xpCases.${c}`)}
            </button>
          ))}
        </span>
      </div>
      <div className="lb-play-grid">
        <XpBox
          earned={P.earned}
          spent={xp === "spentAll" ? P.earned : P.spent}
          rank={rank(P.earned)}
          built={xp !== "notBuilt"}
          href="#lb-play-dev"
        />
        <SessionAward max={P.award.max} suggested={[...P.award.suggested]} value={award} onChange={setAward} />
      </div>
      <AscensionPanel
        tier={ascension === "top" ? P.topTier : P.tier}
        topTier={P.topTier}
        needed={P.needed}
        members={members}
        busy={false}
        refusal={ascension === "refusal" ? t("refusal") : null}
        onAscend={setSent}
      />
      <p className="small dim" role="status">
        {sent ? t("sent", { kind: sent.kind, waived: String(sent.waivePackage) }) : ""}
      </p>
    </section>
  );
}
