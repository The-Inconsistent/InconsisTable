"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { UserButton } from "@inconsistable/auth/react";
import { CreateGame, type Lobby, type LobbyGame } from "@inconsistable/core-schema";

import { ROLE_LABEL } from "@/app/constants";
import { ApiMessage, CampaignRef, readJson } from "@/lib/api-reply/api-reply";

type LobbyViewProps = { lobby: Lobby };

function GameCard({ game }: { game: LobbyGame }) {
  return (
    <a className="card" href={`/c/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <strong>{game.name}</strong>
      <span className="row small dim">
        <span>{game.isOwner ? "Your room" : `Owner: ${game.owner}`}</span>
        {game.role && <span className="chip">{ROLE_LABEL[game.role]}</span>}
        <span>{game.players} characters</span>
        {game.session !== null && <span className="chip">Session {game.session} running</span>}
      </span>
    </a>
  );
}

function Section({ title, games, empty }: { title: string; games: LobbyGame[]; empty: string }) {
  return (
    <section className="stack">
      <h2 className="head">{title}</h2>
      {games.length ? (
        <div className="grid">
          {games.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
      ) : (
        <p className="dim">{empty}</p>
      )}
    </section>
  );
}

// The signed-in home: rooms you own, rooms where you play or co-GM, and the archived ones; plus NEW ROOM for creators.
export function LobbyView({ lobby }: LobbyViewProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // NEW ROOM: the api creates it with the caller as owner and GM, then we open it.
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreateGame.safeParse({ name });
    if (!parsed.success) return setError("Give the room a name");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await readJson(res);
      const room = CampaignRef.safeParse(body);
      if (res.ok && room.success) return router.push(`/c/${room.data.campaignId}?tab=party`);
      const refusal = ApiMessage.safeParse(body);
      setError(refusal.success ? refusal.data.message : "Couldn't create the room");
    } catch {
      setError("No signal. Check the connection and retry.");
    }
    setBusy(false);
  };

  return (
    <>
      <header className="band">
        <strong>InconsisTable</strong>
        <span className="row">
          {lobby.admin && <a href="/admin">Admin</a>}
          <UserButton />
        </span>
      </header>
      <main className="page">
        {lobby.canCreate && (
          <form className="card" onSubmit={handleCreate}>
            <h2 className="head">New room</h2>
            <div className="row">
              <label style={{ flex: 1 }}>
                Name
                <input id="new-room-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </label>
              <button className="btn primary" type="submit" disabled={busy} style={{ alignSelf: "end" }}>
                Create
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        )}
        <Section title="Your rooms" games={lobby.mine} empty="You don't own a room yet." />
        <Section title="Where you play" games={lobby.seated} empty="Nobody has invited you to a table yet." />
        {lobby.archived.length > 0 && <Section title="Archived" games={lobby.archived} empty="" />}
      </main>
    </>
  );
}
