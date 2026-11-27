"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { BookSource, Combatant, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { OrderView } from "@/components/ui/order-view/order-view";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { fightTabOf } from "@/lib/fight-tab/fight-tab";
import { heldChips } from "@/lib/held/held";
import { turnPartsOf } from "@/lib/sheet/sheet";

type FightProps = {
  state: LiveState;
  ruleset: Ruleset | null;
  /** The seat's characters. */
  held: readonly string[];
  requests: readonly SpendRequest[];
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// FIGHT, the phone's tab (house decision #114): who acts now, the order with the seat's own marked YOU and how many act
// after it, a card for any other combatant drawn from exactly what the seat is sent, and on the seat's turn the
// ruleset's `phoneTurn` rows. Nothing here decides a rule: the server sends, the manifest lays out.
export function Fight({ state, ruleset, held, requests, send, books, requestPage }: FightProps) {
  const t = useTranslations("fight");
  const tFoe = useTranslations("foeCard");
  const [cardOf, setCardOf] = useState<string | null>(null);
  const encounter = state.encounter;
  if (!encounter) return <p className="dim">{t("noFight")}</p>;

  const sides = ruleset?.initiative?.strategy === "sides" ? ruleset.initiative : undefined;
  const { acting, mine, after } = fightTabOf({ encounter, held, sides });
  const actorOf = (id: string) => state.actors.find((a) => a.id === id);
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  const current = encounter.combatants.find((c) => c.id === encounter.currentId);
  // The seat's character acting now, while the fight runs: its turn rows are drawn.
  const turnActor = current && mine.has(current.id) && !encounter.paused ? actorOf(current.actorId) : undefined;
  // A ruleset without `phoneTurn` rows draws nothing more on the turn.
  const turnRows = turnActor && ruleset ? turnPartsOf({ ruleset, actor: turnActor }).length : 0;
  const card = encounter.combatants.find((c) => c.id === cardOf);
  const cardActor = card && actorOf(card.actorId);

  return (
    <div className="stack fight-tab">
      {acting && (
        <section className="acting-plate" aria-label={t("actingLabel")} role="status">
          <span className="small">{t("actingNow")}</span>
          <strong className="acting-name">
            {acting.kind === "unseen" ? t("unseen") : acting.mine ? t("actingYou", { name: acting.name }) : acting.name}
          </strong>
        </section>
      )}
      {after && after.of > 0 && <p className="small after-you">{t("afterYou", after)}</p>}
      <OrderView
        encounter={encounter}
        sides={sides}
        conditions={ruleset?.conditions}
        heldOf={(id) => heldChips({ ruleset: ruleset ?? undefined, actor: actorOf(id) })}
        mine={mine}
        onPick={(c: Combatant) => setCardOf(c.id)}
      />
      {turnActor && ruleset && turnRows > 0 && (
        <section className="stack" aria-label={t("turnLabel", { name: turnActor.name })}>
          <h2 className="title">{t("yourTurn", { name: turnActor.name })}</h2>
          <SheetView
            key={turnActor.id}
            part="turn"
            actor={turnActor}
            gm={false}
            table={state}
            campaign={state.campaign.fields}
            {...{ ruleset, characters, requests, send, books, requestPage }}
          />
        </section>
      )}
      {card && (
        <BottomSheet title={card.name} onClose={() => setCardOf(null)}>
          {cardActor && ruleset ? (
            <SheetView
              key={cardActor.id}
              part="card"
              actor={cardActor}
              gm={false}
              campaign={state.campaign.fields}
              {...{ ruleset, characters, send, books, requestPage }}
            />
          ) : (
            <p className="strike-tell" role="status">
              {tFoe("noDetails")}
            </p>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
