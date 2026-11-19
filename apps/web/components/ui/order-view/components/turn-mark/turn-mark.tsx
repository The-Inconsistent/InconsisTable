import { useTranslations } from "next-intl";

import type { TurnMark as Mark } from "@/lib/sides/sides";

// A combatant's turn in a sides fight, as a word (never colour alone).
export function TurnMark({ mark }: { mark: Mark }) {
  const t = useTranslations("orderView");
  return (
    <span className="chip" data-turn={mark}>
      {t(`mark.${mark}`)}
    </span>
  );
}
