"use client";
import { useTranslations } from "next-intl";

import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { PrepWorld } from "@/lib/scene-prep/scene-prep";

type FightButtonProps = {
  sender: LineSender;
  world: PrepWorld;
};

// START THE FIGHT (or JOIN THE FIGHT while one is live): the scene's roster lines sent as the steps that build the fight.
export function FightButton({ sender, world }: FightButtonProps) {
  const t = useTranslations("prep");
  return (
    <button
      className="btn primary"
      aria-busy={sender.busy === "fight"}
      disabled={sender.busy !== null}
      onClick={sender.handleFight}
    >
      {world.state.encounter ? t("joinFight") : t("startFight")}
    </button>
  );
}
