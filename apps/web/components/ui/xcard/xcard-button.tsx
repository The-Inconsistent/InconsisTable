"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { canInCampaign, type LiveState, type Me } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type XCardButtonProps = { me: Me; state: LiveState; send: Send };

// A small corner button in the phone's header, never on the sheet: touch it and the table is told to skip or change
// what just happened, with no name attached. Gone when the table turned the X-Card off.
export function XCardButton({ me, state, send }: XCardButtonProps) {
  const t = useTranslations("safety.card");
  const [note, setNote] = useState<string | null>(null);
  if (!state.campaign.safety.xCard || !canInCampaign({ ctx: me, perm: "safety:signal" })) return null;
  const handleTouch = async () => {
    const r = await send({ type: "safety.xcard" });
    setNote(r.ok ? t("sent") : r.error);
    setTimeout(() => setNote(null), 4000);
  };
  return (
    <>
      <button className="btn sm xcard-touch" onClick={handleTouch} aria-label={t("touchLabel")}>
        {t("title")}
      </button>
      <span className="sr-only" role="status">
        {note}
      </span>
    </>
  );
}
