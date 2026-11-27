"use client";
import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";

import type { Run } from "@/components/gm/track/constants";
import { primaryOf } from "@/lib/sides/sides";

type SidesControlsProps = { encounter: Encounter; run: Run };

// The fight bar's turn buttons for a sides fight: one primary button that follows the state, and, once begun, the way to
// end the round early. The server decides whether the move is allowed and the refusal shows above the order.
export function SidesControls({ encounter, run }: SidesControlsProps) {
  const t = useTranslations("fightBar");
  const primary = primaryOf(encounter);
  const op = (op: "begin" | "next" | "newRound") => () =>
    run({ type: "rule.op", primitive: "initiative.sides", op, input: {} });
  return (
    <>
      {primary?.key === "begin" && (
        <button className="btn primary turn-primary" disabled={encounter.paused} onClick={op("begin")}>
          {t("begin")}
        </button>
      )}
      {primary?.key === "endTurn" && (
        <button className="btn primary turn-primary" disabled={encounter.paused} onClick={op("next")}>
          {t("endTurn", { name: primary.name })}
        </button>
      )}
      {primary?.key === "newRound" && (
        <button className="btn primary turn-primary" disabled={encounter.paused} onClick={op("newRound")}>
          {t("newRound", { round: primary.round })}
        </button>
      )}
      {encounter.begun === true && primary?.key !== "newRound" && (
        <button className="btn" disabled={encounter.paused} onClick={op("newRound")}>
          {t("newRound", { round: encounter.round + 1 })}
        </button>
      )}
    </>
  );
}
