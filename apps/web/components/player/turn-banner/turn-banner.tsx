"use client";
import { useEffect } from "react";

import type { Encounter } from "@inconsistable/core-schema";

type TurnBannerProps = { encounter: Encounter | null; held: readonly string[] };

// "Your turn" when the acting combatant is a character this seat holds. The banner pulses once in the accent as the turn
// starts (CSS; iOS has no vibrate), and Android phones also buzz once (no sound).
export function TurnBanner({ encounter, held }: TurnBannerProps) {
  const acting = encounter?.combatants.find((c) => c.id === encounter.currentId);
  // A paused fight (no session running) announces nobody and buzzes nobody.
  const mine = encounter?.paused === false && acting !== undefined && held.includes(acting.actorId);
  const turnKey = mine ? `${encounter?.id}:${encounter?.round}:${acting.id}` : null;

  // Syncs with the device: vibrate once per turn start. Guarded: not every browser has it, and Chrome ignores it
  // before the first tap on the page.
  useEffect(() => {
    if (
      turnKey !== null &&
      typeof navigator !== "undefined" &&
      "vibrate" in navigator &&
      navigator.userActivation?.hasBeenActive
    )
      navigator.vibrate(200);
  }, [turnKey]);

  if (!mine) return null;
  return (
    <p key={turnKey} className="turn-banner" role="status">
      <span className="turn-icon" aria-hidden="true" />
      Your turn, {acting.name}
    </p>
  );
}
