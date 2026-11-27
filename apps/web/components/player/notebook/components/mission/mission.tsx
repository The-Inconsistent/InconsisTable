"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { SessionRecap } from "@inconsistable/core-schema";

import { questGroups, treeRows } from "@/lib/codex/codex";

import { EntryCard, type CardScope } from "../entry-card/entry-card";
import { Recaps } from "../recaps/recaps";

type MissionProps = {
  scope: CardScope;
  recaps: readonly SessionRecap[];
  /** The table's lines and veils. */
  safety: ReactNode;
};

// MISSION: what the whole table is on. The premise (every lore entry the seat holds, open, with its reminders), the
// table's lines and veils, the quests by status (one revealed to this seat's own characters folded under YOUR ORDERS
// first, so a phone left on the table does not show it), the adventures, then the recaps with the latest open.
export function Mission({ scope, recaps, safety }: MissionProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const { entries, held } = scope;
  const lore = entries.filter((e) => e.kind === "lore");
  const adventures = entries.filter((e) => e.kind === "adventure");
  const cards = (list: typeof entries, open = false) =>
    treeRows(list).map((row) => <EntryCard key={row.entry.id} row={row} scope={scope} defaultOpen={open} />);
  return (
    <div className="stack">
      {lore.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("premise")}</h2>
          {cards(lore, true)}
        </section>
      )}
      {safety}
      {questGroups({ entries, held }).map(({ group, entries: quests }) =>
        group === "orders" ? (
          <details key={group} className="stack notebook-orders">
            <summary className="head">{t("quests.orders", { count: quests.length })}</summary>
            {cards(quests)}
          </details>
        ) : (
          <section key={group} className="stack">
            <h2 className="head">{t(`quests.${group}`)}</h2>
            {cards(quests)}
          </section>
        ),
      )}
      {adventures.length > 0 && (
        <section className="stack">
          <h2 className="head">{tKind("adventure")}</h2>
          {cards(adventures)}
        </section>
      )}
      <Recaps recaps={recaps} entries={entries} onPeek={scope.onPeek} />
    </div>
  );
}
