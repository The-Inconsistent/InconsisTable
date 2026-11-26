"use client";
import { useFormatter, useTranslations } from "next-intl";

import type { Invite } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type OpenInvitesProps = {
  invites: readonly Invite[];
  /** Character names by id, for an invite to one character. */
  names: ReadonlyMap<string, string>;
  send: Send;
  onError: (error: string | null) => void;
};

// OPEN INVITES (#220, Auspex P24): each invite still open, the room's or one character's, with how many used it, until
// when, and whether it needs an account; REVOKE stops it at once. Needs member:invite, which the caller checks.
export function OpenInvites({ invites, names, send, onError }: OpenInvitesProps) {
  const t = useTranslations("openInvites");
  const tRoles = useTranslations("roles");
  const format = useFormatter();

  // REVOKE: the invite's link stops working.
  const handleRevoke = async (id: string) => {
    const r = await send({ type: "invite.revoke", id });
    onError(r.ok ? null : r.error);
  };

  if (invites.length === 0) return null;
  return (
    <div className="stack">
      <h3 className="head">{t("heading")}</h3>
      <ul className="list">
        {invites.map((i) => {
          const what =
            i.mode === "character"
              ? t("character", { name: names.get(i.actorId ?? "") ?? t("gone") })
              : t("room", { role: tRoles(i.role) });
          return (
            <li key={i.id}>
              <span>
                <strong>{what}</strong>
                <span className="dim small">
                  {" · "}
                  {i.maxUses === null ? t("used", { count: i.uses }) : t("usedOf", { count: i.uses, max: i.maxUses })}
                  {" · "}
                  {t("until", {
                    when: format.dateTime(new Date(i.expiresAt), { dateStyle: "medium", timeStyle: "short" }),
                  })}
                </span>{" "}
                {!i.allowGuests && <span className="chip">{t("accountsOnly")}</span>}
              </span>
              <button className="btn sm" aria-label={t("revokeLabel", { what })} onClick={() => handleRevoke(i.id)}>
                {t("revoke")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
