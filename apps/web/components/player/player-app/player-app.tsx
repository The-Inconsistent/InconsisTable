"use client";
import { useState } from "react";

import type { Me } from "@inconsistable/core-schema";

import { PLAYER_TABS, type PlayerTab } from "@/components/player/player-app/constants";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { TestPrompt } from "@/components/player/test-prompt/test-prompt";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import { needsBuild } from "@/lib/builder/builder";
import type { RulesView } from "@/lib/rules-reader/rules-reader";

type PlayerAppProps = { me: Me; view: RulesView | null };

// The phone: one seat, possibly several characters (a companion, a funnel, a friend's character). The strip at the
// top switches between them (docs/design.md §3.7). Sheets, the fight and the map arrive with the first ruleset (P1).
export function PlayerApp({ me, view }: PlayerAppProps) {
  const { state, codex, online, send, books, requestPage } = useTable(me.campaignId);
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
        {!online && (
          <span className="badge-offline" role="status">
            NO SIGNAL
          </span>
        )}
        <strong>{state.campaign.name}</strong>
        <span className="row">{state.session && <span className="chip">Session {state.session.number}</span>}</span>
      </header>
      <TransferOffer me={me} state={state} send={send} />
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
        <TestPrompt state={state} send={send} />
        <h1 className="title">{character?.name ?? "No character"}</h1>
        {character && needsBuild(character) && (
          <a
            className="btn primary"
            href={`/c/${me.campaignId}/build/${character.id}`}
            style={{ justifySelf: "start" }}
          >
            {state.myDraft?.actorId === character.id ? "Continue building" : "Build character"}
          </a>
        )}
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
        ) : tab === "rules" ? (
          view ? (
            <RulesReader
              campaignId={me.campaignId}
              ruleset={view.ruleset}
              first={view.first}
              books={books}
              requestPage={requestPage}
            />
          ) : (
            <p className="error">Couldn&apos;t read the rules. Check the connection and reload.</p>
          )
        ) : tab === "sheet" ? (
          character && view?.ruleset && !needsBuild(character) ? (
            <SheetView
              key={character.id}
              actor={character}
              ruleset={view.ruleset}
              characters={state.actors.filter((a) => a.kind === "pc").length}
              gm={false}
              {...{ send, books, requestPage }}
            />
          ) : !character || !needsBuild(character) ? (
            <p className="dim">This tab fills in when the table picks a ruleset.</p>
          ) : null
        ) : (
          <p className="dim">This tab fills in when the table plays on.</p>
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
