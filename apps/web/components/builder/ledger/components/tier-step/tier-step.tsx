"use client";
import { useTranslations } from "next-intl";

import { setTier } from "@/lib/ledger/ledger";

import { useLedger } from "../../ledger-context";

// TIER: the Tier the character is made at and what it gives to spend, and which sources the campaign lets in. The
// Tier is the table's: a GM-side seat sets it, a player reads it.
export function TierStep() {
  const t = useTranslations("ledgerBuilder.tier");
  const { params, catalogue, build, resolved, gm, edit } = useLedger();
  const tiers = Array.from({ length: params.tiers.max - params.tiers.min + 1 }, (_, i) => params.tiers.min + i);
  return (
    <div className="stack">
      {gm ? (
        <div className="seg lb-tiers" role="group" aria-label={t("pick")}>
          {tiers.map((n) => (
            <button
              key={n}
              type="button"
              className="btn"
              aria-pressed={build.tier === n}
              onClick={() => edit(setTier({ build, tier: n }))}
            >
              {t("tierN", { tier: n })}
            </button>
          ))}
        </div>
      ) : (
        <p className="lb-big">{t("tierN", { tier: build.tier })}</p>
      )}
      <p>
        {resolved ? t("budget", { xp: resolved.budget }) : t("perTier", { xp: params.startingXp.perTier })}
        <span className="small dim"> · {params.startingXp.cite}</span>
      </p>
      <section className="stack" aria-labelledby="lb-sources">
        <h3 id="lb-sources" className="lb-sub">
          {t("sources")}
        </h3>
        <p className="small dim">{catalogue.homebrew ? t("homebrewOn") : t("homebrewOff")}</p>
        <ul className="list lb-plain">
          {params.sources.list.map((s) => (
            <li key={s.id}>
              <span className="pick-name">{s.cite}</span>
              <span className="small">
                {s.official ? t("official") : catalogue.homebrew ? t("homebrewIn") : t("homebrewOut")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
