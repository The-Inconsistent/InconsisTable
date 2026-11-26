"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";

import { qrImage } from "@/lib/qr/qr";
import { shareOrigin } from "@/lib/share-origin/share-origin";

/** A room invite as the phones scan it: its link and the QR drawn of it. */
export type Invite = { url: string; qr: string };

type JoinQrProps = {
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The invite this walk already made, kept by the walk so a later step shows it again instead of making another. */
  invite: Invite | null;
  onInvite: (invite: Invite) => void;
};

// ROOM QR on the first-run walk: a player invite the phones scan, the same invite PARTY's ROOM QR makes, made once.
export function JoinQr({ act, invite: shown, onInvite }: JoinQrProps) {
  const t = useTranslations("party");
  const [failed, setFailed] = useState(false);

  // ROOM QR: a room invite for players, guests allowed, drawn as a QR.
  const handleInvite = async () => {
    const r = await act({ type: "invite.create", mode: "room", role: "player", allowGuests: true });
    if (!r.ok || !r.token) return;
    const url = `${shareOrigin(location)}/invite/${r.token}`;
    try {
      onInvite({ url, qr: await qrImage(url) });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="stack" style={{ justifyItems: "start" }}>
      {!shown && (
        <button type="button" className="btn primary" onClick={handleInvite}>
          {t("campaignQr")}
        </button>
      )}
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
