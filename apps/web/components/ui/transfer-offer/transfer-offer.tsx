"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { LiveState, Me } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type TransferOfferProps = { me: Me; state: LiveState; send: Send };

// The owner offered this room to the viewer: shown under the header band on every tab and app, so the recipient sees it
// whatever their seat or scopes.
export function TransferOffer({ me, state, send }: TransferOfferProps) {
  const t = useTranslations("transferOffer");
  const [error, setError] = useState<string | null>(null);
  if (!me.userId || state.access.transfer?.toUserId !== me.userId) return null;

  // ACCEPT: the api makes the viewer the owner; the new seat arrives with the next snapshot.
  const handleAccept = async () => {
    const r = await send({ type: "campaign.transferAccept" });
    setError(r.ok ? null : r.error);
  };

  return (
    <section className="offer" aria-label={t("label")}>
      <strong>{t("offered")}</strong>
      <button className="btn primary" onClick={handleAccept}>
        {t("accept")}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
