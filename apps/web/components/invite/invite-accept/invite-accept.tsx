"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { AcceptInvite, InvitePreview } from "@inconsistable/core-schema";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, CampaignRef, readJson } from "@/lib/api-reply/api-reply";

type InviteAcceptProps = { code: string; preview: InvitePreview };

// Claim a seat from an invite: the invited character, an open one, or a new one (room invites). Signed-in users become
// members; guests (if the GM allowed them) get a guest cookie for this device. A GM or co-GM invite seats them with no
// character.
export function InviteAccept({ code, preview: p }: InviteAcceptProps) {
  const t = useTranslations("invite");
  const tRoles = useTranslations("roles");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canClaim = p.signedIn || p.allowGuests;

  // Any claim button: POSTs the choice, then opens the table.
  const accept = async (choice: AcceptInvite) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...choice, asGuest: !p.signedIn }),
      });
      const body = await readJson(res);
      const seat = CampaignRef.safeParse(body);
      if (res.ok && seat.success) return router.push(`/c/${seat.data.campaignId}`);
      const refusal = ApiMessage.safeParse(body);
      setError(refusal.success ? tr(refusal.data) : t("takeFailed"));
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(false);
  };

  // NEW CHARACTER form (room invites).
  const handleNew = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (newName.trim()) void accept({ newCharacterName: newName.trim() });
  };

  return (
    <main className="center">
      <div className="card" style={{ maxWidth: 480, width: "100%" }}>
        <h1 className="title">{t("title", { name: p.campaignName })}</h1>
        <p className="dim">{t("invited", { role: tRoles(p.role) })}</p>
        {p.member && (
          <a className="btn primary" href={`/c/${p.campaignId}`}>
            {t("seatedOpen")}
          </a>
        )}

        {!p.member && !p.signedIn && !p.allowGuests && <p className="dim small">{t("reloadToJoin")}</p>}

        {!p.member && p.signedIn && p.role !== "player" && (
          <button className="btn primary" disabled={busy} onClick={() => accept({})}>
            {t("takeSeat")}
          </button>
        )}

        {!p.member && canClaim && p.role === "player" && p.mode === "character" && p.actor && (
          <button className="btn primary" disabled={busy} onClick={() => accept({})}>
            {p.signedIn ? t("playAs", { name: p.actor.name }) : t("playAsGuest", { name: p.actor.name })}
          </button>
        )}

        {!p.member && canClaim && p.role === "player" && p.mode === "room" && (
          <div className="stack">
            <h2 className="head">{t("pickCharacter")}</h2>
            {p.openActors.length === 0 && <p className="dim">{t("allTaken")}</p>}
            <ul className="list">
              {p.openActors.map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong>
                  <button
                    className="btn sm primary"
                    aria-label={t("playLabel", { name: a.name })}
                    disabled={busy}
                    onClick={() => accept({ actorId: a.id })}
                  >
                    {t("play")}
                  </button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={handleNew}>
              <input
                id="new-character-name"
                aria-label={t("newName")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newName")}
                maxLength={100}
                style={{ flex: 1 }}
              />
              <button className="btn" disabled={busy}>
                {t("newButton")}
              </button>
            </form>
          </div>
        )}

        <LocaleSwitch />
        <ThemeSwitch />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
