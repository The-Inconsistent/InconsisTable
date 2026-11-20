"use client";
import { useTranslations } from "next-intl";

import type { Actor, SpendRequest } from "@inconsistable/core-schema";

type SpendAsksProps = {
  requests: readonly SpendRequest[];
  actors: readonly Actor[];
  /** The characters this seat holds: their own asks show on their sheet instead. */
  held: readonly string[];
  /** The ruleset's spend labels by id. */
  spends: ReadonlyMap<string, string>;
};

// Others' asks on a pool this seat sees (house decision #84): "<name> asks: <label>", beside the pools they would spend.
export function SpendAsks({ requests, actors, held, spends }: SpendAsksProps) {
  const t = useTranslations("spendRequest");
  const others = requests.filter((q) => q.spendId !== null && !held.includes(q.actorId ?? ""));
  if (others.length === 0) return null;
  return (
    <ul className="list spend-asks" aria-label={t("barTitle")}>
      {others.map((q) => (
        <li key={q.id} role="status">
          {t("othersAsk", {
            name: actors.find((a) => a.id === q.actorId)?.name ?? "",
            label: spends.get(q.spendId ?? "") ?? q.spendId ?? "",
          })}
        </li>
      ))}
    </ul>
  );
}
