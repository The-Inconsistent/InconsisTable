"use client";
import { useTranslations } from "next-intl";

import type { Me, PoolState } from "@inconsistable/core-schema";

import { PoolsView } from "@/components/ui/pools-view/pools-view";
import type { Send } from "@/hooks/use-table/use-table";
import { poolSidesOf, poolSteps } from "@/lib/pools/pools";

type PoolsPanelProps = { pools: readonly PoolState[]; me: Me; send: Send };

// The room's shared pools on TRACK, beside the clocks: usable with no fight and no session. Nothing when there are none.
export function PoolsPanel({ pools, me, send }: PoolsPanelProps) {
  const t = useTranslations("pools");
  if (pools.length === 0) return null;
  const sides = poolSidesOf(me);
  return (
    <section className="stack" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      <PoolsView pools={pools} steps={(pool) => poolSteps({ pool, ...sides })} send={send} />
    </section>
  );
}
