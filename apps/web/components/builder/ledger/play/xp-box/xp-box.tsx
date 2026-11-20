"use client";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { toSpend } from "@/lib/ledger/play";

export type XpBoxProps = { earned: number; spent: number; rank: number; built: boolean; href: string | null };

// A ledger-built character's XP on its sheet, as Auspex's XP box: the XP earned (which sets the Rank), the XP left to
// spend and the Rank, with one way into the builder. "Level up" leads while a built character has XP to spend.
export function XpBox({ earned, spent, rank, built, href }: XpBoxProps) {
  const t = useTranslations("ledgerBuilder.play.xp");
  const id = useId();
  const left = toSpend({ earned, spent });
  const levelUp = built && left > 0;
  return (
    <section className="card stack lb-play" aria-labelledby={id}>
      <h3 id={id} className="lb-sub">
        {t("title")}
      </h3>
      <dl className="lb-play-figures">
        <div>
          <dt>{t("earned")}</dt>
          <dd>{earned}</dd>
          <dd className="small dim">{t("earnedNote")}</dd>
        </div>
        <div>
          <dt>{t("toSpend")}</dt>
          <dd>{left}</dd>
        </div>
        <div>
          <dt>{t("rank")}</dt>
          <dd>{rank}</dd>
        </div>
      </dl>
      {href && built && (
        <a className={levelUp ? "btn primary" : "btn"} href={href}>
          {levelUp ? t("levelUp", { xp: left }) : t("spend")}
        </a>
      )}
    </section>
  );
}
