"use client";
// PROTOTYPE: the three screens, built from the real components over fake data. Shells copy gm-app and player-app.
import { useMemo } from "react";

import { GM_TABS } from "@/components/gm/gm-app/constants";
import { CallCard } from "@/components/gm/tests/components/call-card/call-card";
import { Track } from "@/components/gm/track/track";
import { PLAYER_TABS } from "@/components/player/player-app/constants";
import { TestPrompt } from "@/components/player/test-prompt/test-prompt";
import { TurnBanner } from "@/components/player/turn-banner/turn-banner";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { OrderView } from "@/components/ui/order-view/order-view";

import { BOOKS, GM_STATE, LYRA, NAMES, PHONE_PENDING, PHONE_REPORTED, requestPage, RULESET, send } from "../_data/fake";

type PhoneProps = { reported: boolean };

// The phone: Lyra's seat. Header band, turn cue, the Test prompt, the sheet, bottom tabs.
export function PhoneScreen({ reported }: PhoneProps) {
  const state = reported ? PHONE_REPORTED : PHONE_PENDING;
  const actor = state.actors.find((a) => a.id === LYRA.id) ?? LYRA;
  return (
    <>
      <header className="band">
        <strong>{state.campaign.name}</strong>
        <span className="row">
          <span className="chip">Session {state.session?.number}</span>
        </span>
      </header>
      <main className="page">
        <TurnBanner encounter={state.encounter} held={[LYRA.id]} />
        <TestPrompt state={state} send={send} />
        <h1 className="title">{actor.name}</h1>
        {state.encounter && <OrderView encounter={state.encounter} />}
        <SheetView
          actor={actor}
          ruleset={RULESET}
          characters={3}
          gm={false}
          send={send}
          books={BOOKS}
          requestPage={requestPage}
        />
      </main>
      <nav className="tabs" role="tablist" aria-label="Player tabs" style={{ position: "sticky", bottom: 0 }}>
        {Object.entries(PLAYER_TABS).map(([k, label]) => (
          <button key={k} className="tab" role="tab" aria-selected={k === "sheet"}>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

type GmShellProps = { tab: keyof typeof GM_TABS; children: React.ReactNode };

function GmShell({ tab, children }: GmShellProps) {
  return (
    <>
      <header className="band">
        <a href="/proto">← Rooms</a>
        <strong>{GM_STATE.campaign.name}</strong>
        <span className="row">
          <span className="chip">Session {GM_STATE.session?.number}</span>
        </span>
      </header>
      <nav className="tabs" role="tablist" aria-label="GM tabs">
        {Object.entries(GM_TABS).map(([k, t]) => (
          <button key={k} className="tab" role="tab" aria-selected={k === tab}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">{children}</main>
    </>
  );
}

// The GM's tablet, TRACK tab: turn order, combatant panel, keypad.
export function TrackScreen() {
  return (
    <GmShell tab="track">
      <Track state={GM_STATE} send={send} sheet={{ ruleset: RULESET, books: BOOKS, requestPage }} />
    </GmShell>
  );
}

// The GM's tablet, TESTS tab: an open call with reported results, and a closed one.
export function CallScreen() {
  const open = useMemo(() => GM_STATE.tests.filter((c) => c.status === "open"), []);
  const closed = useMemo(() => GM_STATE.tests.filter((c) => c.status === "closed"), []);
  return (
    <GmShell tab="tests">
      <div className="stack" style={{ gap: 24 }}>
        <section className="stack">
          <h2 className="head">Open</h2>
          <div className="grid">
            {open.map((c) => (
              <CallCard key={c.id} call={c} names={NAMES} send={send} />
            ))}
          </div>
        </section>
        <section className="stack">
          <h2 className="head">Closed this session</h2>
          <div className="grid">
            {closed.map((c) => (
              <CallCard key={c.id} call={c} names={NAMES} send={send} />
            ))}
          </div>
        </section>
      </div>
    </GmShell>
  );
}
