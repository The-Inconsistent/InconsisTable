"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { Party } from "@/components/gm/party/party";
import { RulesPanel } from "@/components/gm/rules/rules-panel";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { Track } from "@/components/gm/track/track";
import { Tests } from "@/components/gm/tests/tests";
import { Standings } from "@/components/ui/standings/standings";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import type { RulesTabData } from "@/lib/library/library";
import type { RulesView } from "@/lib/rules-reader/rules-reader";

type GmAppProps = { me: Me; initialTab: GmTab; rules: RulesTabData | null; view: RulesView | null };

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, initialTab, rules, view }: GmAppProps) {
  const t = useTranslations("gmApp");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, online, send, books, requestPage } = useTable(me.campaignId);
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter(
    (k) => canInCampaign({ ctx: me, perm: GM_TABS[k].perm }) && (k !== "standings" || (state?.games.length ?? 0) > 0),
  );
  const [tab, setTab] = useState<GmTab>(tabs.includes(initialTab) ? initialTab : (tabs[0] ?? "rules"));

  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  return (
    <div className="surface-table">
      <header className="band">
        {!online && (
          <span className="badge-offline" role="status">
            {tTable("offline")}
          </span>
        )}
        <a href="/">{t("campaigns")}</a>
        <strong>{state.campaign.name}</strong>
        <span className="row">
          {state.session && <span className="chip">{tTable("session", { number: state.session.number })}</span>}
          <SettingsMenu />
        </span>
      </header>
      <TransferOffer me={me} state={state} send={send} />
      <nav className="tabs" role="tablist" aria-label={t("tabsLabel")}>
        {tabs.map((name) => (
          <button key={name} className="tab" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {t(`tabs.${name}`)}
          </button>
        ))}
      </nav>
      <main className="page">
        {tab === "party" ? (
          <Party me={me} state={state} send={send} sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }} />
        ) : tab === "track" ? (
          <Track me={me} state={state} send={send} sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }} />
        ) : tab === "standings" ? (
          <Standings games={state.games} />
        ) : tab === "tests" ? (
          <Tests state={state} send={send} />
        ) : tab === "rules" ? (
          <div className="stack" style={{ gap: 32 }}>
            <RulesPanel me={me} send={send} data={rules} />
            {view && (
              <section className="stack">
                <h2 className="title">{t("readRules")}</h2>
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
          <p className="dim">{t(`coming.${tab}`)}</p>
        )}
      </main>
    </div>
  );
}
