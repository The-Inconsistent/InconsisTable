"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { isReady } from "@/lib/ledger/ledger";

import { useLedger } from "../../ledger-context";

type XpBarProps = { onOpen: () => void; footer?: ReactNode };

// Always on screen: the XP to spend, spent and left (or over), how much is still to settle, and the ledger behind a
// tap. In play the figures are the XP earned and what advancement spends of it.
export function XpBar({ onOpen, footer }: XpBarProps) {
  const t = useTranslations("ledgerBuilder.bar");
  const { resolved, play } = useLedger();
  const adv = play ? resolved?.advancement : null;
  const budget = adv ? adv.budget : (resolved?.budget ?? 0);
  const spent = adv ? adv.spent : (resolved?.spent ?? 0);
  const over = spent > budget;
  const left = resolved ? resolved.pending.length + resolved.problems.length : 0;
  return (
    <div className="build-bar lb-bar">
      <dl className="lb-figures">
        <div>
          <dt>{adv ? t("earned", { rank: adv.rank }) : t("budget")}</dt>
          <dd>{budget}</dd>
        </div>
        <div>
          <dt>{t("spent")}</dt>
          <dd>{spent}</dd>
        </div>
        <div data-state={over ? "over" : "left"}>
          <dt>{over ? t("over") : t("left")}</dt>
          <dd>{Math.abs(budget - spent)}</dd>
        </div>
      </dl>
      <p className="lb-status" role="status" data-state={isReady(resolved) ? "ready" : "open"}>
        {!resolved ? t("begin") : isReady(resolved) ? t("ready") : t("toSettle", { count: left })}
      </p>
      <button type="button" className="btn" onClick={onOpen} disabled={!resolved}>
        {t("ledger")}
      </button>
      {footer}
    </div>
  );
}
