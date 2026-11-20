import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { lineOf } from "@/lib/sides/sides";

type SideLineProps = { encounter: Encounter; sides?: SidesInitiative };

// Where a sides fight is, in one line: whose side picks, who acts, or the round is complete.
export function SideLine({ encounter, sides }: SideLineProps) {
  const t = useTranslations("orderView");
  const line = lineOf({ encounter, sides });
  // While the fight is set up the heading above already says so.
  if (line.key === "setup") return null;
  return (
    <p className="side-line" role="status">
      {line.key === "pick" && t("linePick", { side: line.side })}
      {line.key === "complete" && t("lineComplete", { round: line.round })}
      {line.key === "acting" && t("lineActing", { name: line.name })}
      {line.key === "unseen" && t("lineUnseen")}
    </p>
  );
}
