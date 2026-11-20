"use client";
import { useTranslations } from "next-intl";

import type { LedgerCreation } from "@inconsistable/rules-engine";

type XpCostProps = { cost: LedgerCreation["talents"][number]["xp"] };

// A catalogue price as printed: a number, per Tier, at creation and later, a base plus what the GM adds, or one of
// several. The ledger prices the build; this is what a list row reads before it is taken.
export function XpCost({ cost }: XpCostProps) {
  const t = useTranslations("ledgerBuilder.xp");
  if (typeof cost === "number") return <>{t("flat", { xp: cost })}</>;
  if ("perTier" in cost) return <>{t("perTier", { xp: cost.perTier })}</>;
  if ("atCreation" in cost) return <>{t("atCreation", { xp: cost.atCreation, later: cost.later })}</>;
  if ("base" in cost) return <>{t("plus", { xp: cost.base, plus: cost.plus })}</>;
  return <>{t("byChoice", { list: cost.byChoice.map((c) => c.xp).join(" / ") })}</>;
}
