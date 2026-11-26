"use client";
import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { actingMine, afterYou, nextUp } from "@/lib/fight/fight";
import { lineOf } from "@/lib/sides/sides";

type FightPlateProps = { encounter: Encounter; sides?: SidesInitiative; held: readonly string[] };

// NOW ACTING (house decision #117): who holds the turn, large enough to read from across the table, then who is up next,
// and on the seat's own turn how many still act after it this round.
export function FightPlate({ encounter: e, sides, held }: FightPlateProps) {
  const t = useTranslations("fightTab");
  const mine = actingMine({ encounter: e, held });
  const line = lineOf({ encounter: e, sides });
  const acting = e.combatants.find((c) => c.id === e.currentId);
  const name =
    e.begun !== undefined
      ? line.key === "setup"
        ? t("settingUp")
        : line.key === "acting"
          ? line.name
          : line.key === "unseen"
            ? t("unseen")
            : line.key === "pick"
              ? t("pick", { side: line.side })
              : t("complete", { round: line.round })
      : (acting?.name ?? (e.unseen ? t("unseen") : t("nobody")));
  const next = nextUp(e);
  const after = afterYou({ encounter: e, held, sides });
  return (
    <section className="fight-plate" data-mine={mine !== null} aria-label={t("nowActing")} role="status">
      <span className="fight-plate-kicker">{mine ? t("yourTurn") : t("nowActing")}</span>
      <strong className="fight-plate-name">
        {name}
        {mine && <span className="chip">{t("you")}</span>}
      </strong>
      {next && <span>{t("upNext", { name: next })}</span>}
      {after && <span>{t("after", after)}</span>}
      {e.paused && <span className="chip">{t("paused")}</span>}
    </section>
  );
}
