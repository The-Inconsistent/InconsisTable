"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Encounter } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { phaseOf } from "@/lib/track/track";

type DoneButtonProps = { encounter: Encounter | null; held: readonly string[]; send: Send };

// In a phase everyone plays at once, each held character that is not done yet gets one large button: a single tap, easy
// to hit at arm's length (principle 8). Nothing shows in a phase played in turn, or when the game is paused.
export function DoneButton({ encounter, held, send }: DoneButtonProps) {
  const t = useTranslations("doneButton");
  const [error, setError] = useState<string | null>(null);
  if (!encounter || encounter.paused || phaseOf(encounter)?.mode !== "simultaneous") return null;
  const waiting = encounter.combatants.filter((c) => held.includes(c.actorId) && !encounter.done.includes(c.id));

  // DONE: marks one character done; the api moves the phase on when it was the last.
  const handleDone = async (actorId: string) => {
    const r = await send({ type: "phase.done", actorId });
    setError(r.ok ? null : r.error);
  };

  return (
    <>
      {waiting.map((c) => (
        <button key={c.id} className="btn primary done-button" onClick={() => handleDone(c.actorId)}>
          {t("label", { name: c.name })}
        </button>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
