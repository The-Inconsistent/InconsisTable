"use client";
import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";

import type { Run } from "@/components/gm/track/constants";
import { phaseOf } from "@/lib/track/track";

type PhaseBarProps = { encounter: Encounter; run: Run };

// The GM's view of a phase: where the round is, and in a phase played at once, who has not marked done with the way to
// move on without them (house decision #37). Nothing for a ruleset without phases.
export function PhaseBar({ encounter, run }: PhaseBarProps) {
  const t = useTranslations("orderView");
  const tBar = useTranslations("phaseBar");
  const phase = phaseOf(encounter);
  if (!phase) return null;
  const waiting = encounter.combatants.filter((c) => !encounter.done.includes(c.id));
  return (
    <div className="phase-bar row" role="status">
      <strong>{t("roundPhase", { round: encounter.round, phase: phase.label })}</strong>
      {phase.mode === "simultaneous" && !encounter.paused && (
        <>
          <span className="dim">{tBar("waiting", { names: waiting.map((c) => c.name).join(", ") })}</span>
          <button className="btn primary" onClick={() => run({ type: "turn.next" })}>
            {tBar("moveOn")}
          </button>
        </>
      )}
    </div>
  );
}
