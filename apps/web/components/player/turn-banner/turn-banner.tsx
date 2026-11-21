"use client";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import type { Encounter } from "@inconsistable/core-schema";

import { buzz } from "@/components/ui/alerts-switch/alerts-switch";
import { phoneLineOf } from "@/lib/sides/sides";

type TurnBannerProps = { encounter: Encounter | null; held: readonly string[] };

// "Your turn" when the acting combatant is a character this seat holds. The banner pulses once in the accent as the turn
// starts (CSS; iOS has no vibrate), and Android phones also buzz once (no sound).
export function TurnBanner({ encounter, held }: TurnBannerProps) {
  const t = useTranslations("turnBanner");
  const acting = encounter?.combatants.find((c) => c.id === encounter.currentId);
  // A paused fight (no session running) announces nobody and buzzes nobody.
  const mine = encounter?.paused === false && acting !== undefined && held.includes(acting.actorId);
  const turnKey = mine ? `${encounter?.id}:${encounter?.round}:${acting.id}` : null;

  // Syncs with the device: vibrate once per turn start.
  useEffect(() => {
    if (turnKey !== null) buzz();
  }, [turnKey]);

  // A sides fight (its snapshot carries `begun`): one quiet line for the seat's own character when it is not acting.
  const sideLine =
    encounter?.paused === false && encounter.begun !== undefined && !mine
      ? encounter.combatants
          .filter((c) => held.includes(c.actorId))
          .map((c) => phoneLineOf({ encounter, combatant: c }))
          .find((l) => l !== null)
      : undefined;

  if (sideLine)
    return (
      <p className="dim" role="status">
        {t(`side.${sideLine}`)}
      </p>
    );
  if (!mine) return null;
  return (
    <p key={turnKey} className="turn-banner" role="status">
      <span className="turn-icon" aria-hidden="true" />
      {t("yourTurn", { name: acting.name })}
    </p>
  );
}
