"use client";
import { useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { Party } from "@/components/gm/party/party";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { useTable } from "@/hooks/use-table/use-table";

type GmAppProps = { me: Me; initialTab: GmTab };

// What each tab will hold, until it does (docs/p0-plan.md, docs/design.md §3.4).
const COMING: Record<Exclude<GmTab, "party">, string> = {
  track: "The combat tracker arrives with the first ruleset (P1).",
  prep: "Adventures and scenes arrive in P1.",
  codex: "NPCs, places, factions and handouts arrive in P1.",
  map: "Maps that help the table remember arrive in P2.",
  rules: "The rules reference reads the imported ruleset (P1).",
};

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, initialTab }: GmAppProps) {
  const { state, online, send } = useTable(me.campaignId);
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter((t) => canInCampaign({ ctx: me, perm: GM_TABS[t].perm }));
  const [tab, setTab] = useState<GmTab>(tabs.includes(initialTab) ? initialTab : (tabs[0] ?? "rules"));

  if (!state) return <StatusScreen text="Syncing…" />;
  return (
    <>
      <header className="band">
        <a href="/">← Rooms</a>
        <strong>{state.campaign.name}</strong>
        <span className="row">
          {state.session && <span className="chip">Session {state.session.number}</span>}
          {!online && <span className="offline">No signal</span>}
        </span>
      </header>
      <nav className="tabs" role="tablist" aria-label="GM tabs">
        {tabs.map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {GM_TABS[t].label}
          </button>
        ))}
      </nav>
      <main className="page">
        {tab === "party" ? <Party me={me} state={state} send={send} /> : <p className="dim">{COMING[tab]}</p>}
      </main>
    </>
  );
}
