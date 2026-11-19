"use client";
import { useTranslations } from "next-intl";

import type { Combatant, Encounter, PoolState } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import type { Run } from "@/components/gm/track/constants";
import { actionsOf, costText, inputOf, SIDE_ACTIONS, type SideAction } from "@/lib/sides/sides";

type SideActionsProps = {
  encounter: Encounter;
  combatant: Combatant;
  sides: SidesInitiative;
  pools: readonly PoolState[];
  run: Run;
};

// The turn actions of one combatant in a sides fight, offered from the snapshot and the ruleset. The server still decides
// and its refusal shows above the order. "Just go" is the quiet one: a slip at the table.
export function SideActions({ encounter, combatant: c, sides, pools, run }: SideActionsProps) {
  const t = useTranslations("combatantPanel");
  const actions = actionsOf({ encounter, combatant: c, sides });
  if (actions.length === 0) return null;

  // TURN ACTION: sends the op of the pressed action for this combatant's actor.
  const handleAction = (a: SideAction) => () =>
    run({
      type: "rule.op",
      primitive: "initiative.sides",
      op: SIDE_ACTIONS[a.key].op,
      input: inputOf({ key: a.key, actorId: c.actorId }),
    });

  return (
    <div className="row" role="group" aria-label={t("turnActions")}>
      {actions.map((a) => (
        <button
          key={a.key}
          className={a.key === "start" || a.key === "endTurn" ? "btn primary" : a.key === "justGo" ? "btn sm" : "btn"}
          onClick={handleAction(a)}
        >
          {t(`side.${a.key}`, { cost: a.cost ? costText({ cost: a.cost, pools }) : "" })}
        </button>
      ))}
    </div>
  );
}
