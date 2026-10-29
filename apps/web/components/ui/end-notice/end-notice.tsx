import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";

type EndNoticeProps = { encounter: Encounter };

// "A game-end condition is met" (house decision #38). Only a notice: no sound, no vibration, nothing blocks. The seat
// that runs the table ends the game when the table says so.
export function EndNotice({ encounter }: EndNoticeProps) {
  const t = useTranslations("endNotice");
  if (encounter.endMet.length === 0) return null;
  return (
    <p className="end-notice" role="status">
      {t("reached")}
    </p>
  );
}
