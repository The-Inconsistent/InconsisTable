"use client";
import { useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { Party } from "@/components/gm/party/party";
import { RulesPanel } from "@/components/gm/rules/rules-panel";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { Track } from "@/components/gm/track/track";
import { Tests } from "@/components/gm/tests/tests";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import type { RulesTabData } from "@/lib/library/library";
import type { RulesView } from "@/lib/rules-reader/rules-reader";

type GmAppProps = { me: Me; initialTab: GmTab; rules: RulesTabData | null; view: RulesView | null };

// What each tab will hold, until it does (docs/p0-plan.md, docs/design.md §3.4).
const COMING: Record<Exclude<GmTab, "party" | "tests" | "rules" | "track">, string> = {
  prep: "Adventures and scenes arrive in P1.",
  codex: "NPCs, places, factions and handouts arrive in P1.",
  map: "Maps that help the table remember arrive in P2.",
};

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, initialTab, rules, view }: GmAppProps) {
  const { state, online, send, books, requestPage } = useTable(me.campaignId);
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter((t) => canInCampaign({ ctx: me, perm: GM_TABS[t].perm }));
  const [tab, setTab] = useState<GmTab>(tabs.includes(initialTab) ? initialTab : (tabs[0] ?? "rules"));

  if (!state) return <StatusScreen text="Syncing…" />;
  return (
    <div className="surface-table">
      <header className="band">
        {!online && (
          <span className="badge-offline" role="status">
            NO SIGNAL
          </span>
        )}
        <a href="/">← Rooms</a>
        <strong>{state.campaign.name}</strong>
        <span className="row">{state.session && <span className="chip">Session {state.session.number}</span>}</span>
      </header>
      <TransferOffer me={me} state={state} send={send} />
      <nav className="tabs" role="tablist" aria-label="GM tabs">
        {tabs.map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {GM_TABS[t].label}
          </button>
        ))}
      </nav>
      <main className="page">
        {tab === "party" ? (
          <Party me={me} state={state} send={send} sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }} />
        ) : tab === "track" ? (
          <Track state={state} send={send} sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }} />
        ) : tab === "tests" ? (
          <Tests state={state} send={send} />
        ) : tab === "rules" ? (
          <div className="stack" style={{ gap: 32 }}>
            <RulesPanel me={me} send={send} data={rules} />
            {view && (
              <section className="stack">
                <h2 className="title">Read the rules</h2>
                <RulesReader
                  campaignId={me.campaignId}
                  ruleset={view.ruleset}
                  first={view.first}
                  books={books}
                  requestPage={requestPage}
                />
              </section>
            )}
          </div>
        ) : (
          <p className="dim">{COMING[tab]}</p>
        )}
      </main>
    </div>
  );
}
