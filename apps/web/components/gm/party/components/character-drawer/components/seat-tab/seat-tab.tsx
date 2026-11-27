"use client";
import { useTranslations } from "next-intl";

import type { ActionInput, ActionResult, Actor, Member } from "@inconsistable/core-schema";

type SeatTabProps = {
  actor: Actor;
  /** The member holding it, if any. */
  member: Member | null;
  guest: boolean;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** Shows a join link as a QR (PARTY's sheet). */
  onShow: (link: { title: string; path: string }) => void;
  onWhisper: (() => void) | null;
  may: { invite: boolean; remove: boolean };
};

// SEAT: who plays the character and how a phone takes it: a one-use INVITE for a signed-in player, a GUEST QR for a phone
// without an account, WHISPER, and the way out (revoke the guest, remove the player).
export function SeatTab({ actor, member, guest, act, onShow, onWhisper, may }: SeatTabProps) {
  const t = useTranslations("party");
  const name = actor.name;

  // INVITE: one link, used once, that a signed-in player takes this seat with (Auspex P21).
  const handleInvite = async () => {
    const r = await act({ type: "invite.create", mode: "character", actorId: actor.id, allowGuests: false });
    if (r.ok && r.token) onShow({ title: t("characterInviteTitle", { name }), path: `/invite/${r.token}` });
  };
  // GUEST QR: a phone without an account plays it.
  const handleGuest = async () => {
    const r = await act({ type: "token.issue", actorId: actor.id });
    if (r.ok && r.token) onShow({ title: t("guestQrTitle", { name }), path: `/join/${r.token}` });
  };

  return (
    <div className="stack">
      <p>{member ? t("playedBy", { name: member.name }) : guest ? t("playedByGuest") : t("openSeat")}</p>
      <div className="row">
        {may.invite && (
          <button className="btn" aria-label={t("inviteCharacterLabel", { name })} onClick={handleInvite}>
            {t("inviteCharacter")}
          </button>
        )}
        <button className="btn" aria-label={t("guestQrLabel", { name })} onClick={handleGuest}>
          {t("guestQr")}
        </button>
        {onWhisper && (
          <button className="btn" aria-label={t("whisperLabel", { name })} onClick={onWhisper}>
            {t("whisper")}
          </button>
        )}
      </div>
      {(guest || (member && may.remove)) && (
        <div className="row">
          {guest && (
            <button
              className="btn"
              aria-label={t("revokeGuestLabel", { name })}
              onClick={() => act({ type: "token.revoke", actorId: actor.id })}
            >
              {t("revokeGuest")}
            </button>
          )}
          {member && may.remove && (
            <button
              className="btn"
              aria-label={t("removeLabel", { name: member.name })}
              onClick={() => act({ type: "member.remove", userId: member.userId })}
            >
              {t("removePlayer", { name: member.name })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
