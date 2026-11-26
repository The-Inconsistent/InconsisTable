"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";

import { qrImage } from "@/lib/qr/qr";
import { shareOrigin } from "@/lib/share-origin/share-origin";

type JoinQrProps = { act: (a: ActionInput) => Promise<ActionResult> };

// ROOM QR on the first-run walk: a player invite the phones scan, the same invite PARTY's ROOM QR makes.
export function JoinQr({ act }: JoinQrProps) {
  const t = useTranslations("party");
  const [shown, setShown] = useState<{ url: string; qr: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // ROOM QR: a room invite for players, guests allowed, drawn as a QR.
  const handleInvite = async () => {
    const r = await act({ type: "invite.create", mode: "room", role: "player", allowGuests: true });
    if (!r.ok || !r.token) return;
    const url = `${shareOrigin(location)}/invite/${r.token}`;
    try {
      setShown({ url, qr: await qrImage(url) });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="stack" style={{ justifyItems: "start" }}>
      <button type="button" className="btn primary" onClick={handleInvite}>
        {t("campaignQr")}
      </button>
      {failed && (
        <p className="error" role="alert">
          {t("qrFailed")}
        </p>
      )}
      {shown && (
        <div className="card" style={{ justifyItems: "center", textAlign: "center", width: "100%" }}>
          {/* A data: URL made in this browser; next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={shown.qr} alt={t("qrAlt", { title: t("campaignQr") })} />
          <code className="small" style={{ wordBreak: "break-all" }}>
            {shown.url}
          </code>
        </div>
      )}
    </div>
  );
}
