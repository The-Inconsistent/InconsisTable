"use client";
import { useState } from "react";

import type { Me } from "@inconsistable/core-schema";

import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { useTable } from "@/hooks/use-table/use-table";

type PlayerAppProps = { me: Me };

const PLAYER_TABS = { sheet: "Sheet", fight: "Fight", map: "Map", intel: "Intel" } as const;
type PlayerTab = keyof typeof PLAYER_TABS;

// The phone: one seat, possibly several characters (a companion, a funnel, a friend's character). The strip at the
// top switches between them (docs/design.md §3.7). Sheets, the fight and the map arrive with the first ruleset (P1).
export function PlayerApp({ me }: PlayerAppProps) {
  const { state, codex, online, send } = useTable(me.campaignId);
  const held = me.seat.kind === "admin" ? [] : me.seat.characterIds;
  const [current, setCurrent] = useState(held[0] ?? "");
  const [tab, setTab] = useState<PlayerTab>("sheet");
  const [error, setError] = useState<string | null>(null);

  if (!state) return <StatusScreen text="Syncing…" />;
  const mine = state.actors.filter((a) => held.includes(a.id));
  const character = mine.find((a) => a.id === current) ?? mine[0];

  // LEAVE: give up this seat; the character stays at the table for the GM.
  const handleLeave = async () => {
    const r = await send({ type: "seat.leave" });
    // /leave is a route handler that expires the httpOnly cookie, so it needs a full navigation, not a router push.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.ok) window.location.href = "/leave";
    else setError(r.error);
  };

  return (
    <>
      <header className="band">
        <strong>{state.campaign.name}</strong>
        <span className="row">
          {state.session && <span className="chip">Session {state.session.number}</span>}
          {!online && <span className="offline">No signal</span>}
        </span>
      </header>
      {mine.length > 1 && (
        <nav className="tabs" role="tablist" aria-label="Your characters">
          {mine.map((a) => (
            <button
              key={a.id}
              className="tab"
              role="tab"
              aria-selected={a.id === character?.id}
              onClick={() => setCurrent(a.id)}
            >
              {a.name}
            </button>
          ))}
        </nav>
      )}
      <main className="page">
        <h1 className="title">{character?.name ?? "No character"}</h1>
        {tab === "intel" ? (
          <ul className="list">
            {(codex?.entries ?? []).map((e) => (
              <li key={e.id}>
                <span>
                  <strong>{e.title}</strong>
                  <br />
                  <span className="dim">{e.body}</span>
                </span>
              </li>
            ))}
            {!codex?.entries.length && <li className="dim">Nothing revealed yet.</li>}
          </ul>
        ) : (
          <p className="dim">This tab fills in when the table picks a ruleset.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" onClick={handleLeave} style={{ justifySelf: "start" }}>
          Leave this table
        </button>
      </main>
      <nav className="tabs" role="tablist" aria-label="Player tabs" style={{ position: "sticky", bottom: 0 }}>
        {(Object.keys(PLAYER_TABS) as PlayerTab[]).map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {PLAYER_TABS[t]}
          </button>
        ))}
      </nav>
    </>
  );
}
