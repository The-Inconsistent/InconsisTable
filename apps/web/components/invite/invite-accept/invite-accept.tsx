"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { AcceptInvite, InvitePreview } from "@inconsistable/core-schema";

import { ROLE_LABEL } from "@/app/constants";
import { ApiMessage, CampaignRef, readJson } from "@/lib/api-reply/api-reply";

type InviteAcceptProps = { code: string; preview: InvitePreview };

// Claim a seat from an invite: the invited character, an open one, or a new one (room invites). Signed-in users become
// members; guests (if the GM allowed them) get a guest cookie for this device. A GM or co-GM invite seats them with no
// character.
export function InviteAccept({ code, preview: p }: InviteAcceptProps) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${encodeURIComponent(code)}`;
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
      setError(refusal.success ? refusal.data.message : "Couldn't take the seat. Try again");
    } catch {
      setError("No signal");
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
        <h1 className="title">Join {p.campaignName}</h1>
        <p className="dim">You&apos;re invited to a {ROLE_LABEL[p.role]} seat.</p>
        {p.member && (
          <a className="btn primary" href={`/c/${p.campaignId}`}>
            You&apos;re seated · open the table
          </a>
        )}

        {!p.member && !p.signedIn && (
          <div className="stack">
            <a className="btn primary" href={`/sign-in?redirect_url=${encodeURIComponent(here)}`}>
              Sign in to join
            </a>
            <p className="dim small">
              {p.allowGuests
                ? "Or join as a guest below: no account, this device only."
                : "This table needs an account."}
            </p>
          </div>
        )}

        {!p.member && p.signedIn && p.role !== "player" && (
          <button className="btn primary" disabled={busy} onClick={() => accept({})}>
            Take the seat
          </button>
        )}

        {!p.member && canClaim && p.role === "player" && p.mode === "character" && p.actor && (
          <button className="btn primary" disabled={busy} onClick={() => accept({})}>
            Play {p.actor.name}
            {p.signedIn ? "" : " as a guest"}
          </button>
        )}

        {!p.member && canClaim && p.role === "player" && p.mode === "room" && (
          <div className="stack">
            <h2 className="head">Pick your character</h2>
            {p.openActors.length === 0 && <p className="dim">Every character is taken. Start a new one:</p>}
            <ul className="list">
              {p.openActors.map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong>
                  <button
                    className="btn sm primary"
                    aria-label={`Play ${a.name}`}
                    disabled={busy}
                    onClick={() => accept({ actorId: a.id })}
                  >
                    Play
                  </button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={handleNew}>
              <input
                id="new-character-name"
                aria-label="New character name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New character name"
                maxLength={100}
                style={{ flex: 1 }}
              />
              <button className="btn" disabled={busy}>
                New
              </button>
            </form>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
