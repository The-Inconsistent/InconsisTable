"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { Encounter } from "@inconsistable/core-schema";

import { buzz, TURN_BUZZ } from "@/components/ui/alerts-switch/alerts-switch";
import { phoneLineOf } from "@/lib/sides/sides";
import { playTurnTone, unlockTone } from "@/lib/turn-tone/turn-tone";

type TurnBannerProps = { encounter: Encounter | null; held: readonly string[] };

// "Your turn" when the acting combatant is a character this seat holds. The banner flashes in the accent as the turn
// starts until the next tap (CSS; iOS has no vibrate), Android phones buzz twice, and a device that chose the tone
// plays it once (house decision #112).
export function TurnBanner({ encounter, held }: TurnBannerProps) {
  const t = useTranslations("turnBanner");
  const acting = encounter?.combatants.find((c) => c.id === encounter.currentId);
  // A paused fight (no session running) announces nobody and buzzes nobody.
  const mine = encounter?.paused === false && acting !== undefined && held.includes(acting.actorId);
  const turnKey = mine ? `${encounter?.id}:${encounter?.round}:${acting.id}` : null;

  // The turn whose flash a tap has ended.
  const [tapped, setTapped] = useState<string | null>(null);

  // Syncs with the device: the first tap after load unlocks the audio.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockTone, { once: true });
    return () => window.removeEventListener("pointerdown", unlockTone);
  }, []);

  // Syncs with the device: buzz and sound once per turn start; the next tap ends the flash.
  useEffect(() => {
    if (turnKey === null) return;
    buzz(TURN_BUZZ);
    playTurnTone();
    const end = () => setTapped(turnKey);
    window.addEventListener("pointerdown", end, { once: true });
    return () => window.removeEventListener("pointerdown", end);
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
    <p key={turnKey} className="turn-banner" role="status" data-flash={tapped !== turnKey}>
      <span className="turn-icon" aria-hidden="true" />
      {t("yourTurn", { name: acting.name })}
    </p>
  );
}
