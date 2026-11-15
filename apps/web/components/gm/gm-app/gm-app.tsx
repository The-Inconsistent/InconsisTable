"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { Codex } from "@/components/gm/codex/codex";
import { Party } from "@/components/gm/party/party";
import { Prep } from "@/components/gm/prep/prep";
import { RequestBar } from "@/components/gm/request-bar/request-bar";
import { RulesPanel } from "@/components/gm/rules/rules-panel";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { Track } from "@/components/gm/track/track";
import { TableModePicker } from "@/components/player/run-table/table-mode-picker";
import { Tests } from "@/components/gm/tests/tests";
import { Standings } from "@/components/ui/standings/standings";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import type { RulesTabData } from "@/lib/library/library";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import { resourceLabels } from "@/lib/spend-request/spend-request";

type GmAppProps = { me: Me; initialTab: GmTab; rules: RulesTabData | null; view: RulesView | null; quick?: boolean };

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, initialTab, rules, view, quick = false }: GmAppProps) {
  const t = useTranslations("gmApp");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, codex, online, send, books, requestPage } = useTable(me.campaignId);
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter(
    (k) => canInCampaign({ ctx: me, perm: GM_TABS[k].perm }) && (k !== "standings" || (state?.games.length ?? 0) > 0),
  );
  const [tab, setTab] = useState<GmTab>(tabs.includes(initialTab) ? initialTab : (tabs[0] ?? "rules"));

  const [callTestId, setCallTestId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  // PREP's CALL: opens TESTS with that Test selected (held in state, not the URL).
  const handleCall = (testId: string) => {
    setCallTestId(testId);
    setTab("tests");
  };

  // PREP's "Open in CODEX": opens CODEX with that entry open.
  const handleOpenCodex = (entryId: string) => {
    setOpenEntryId(entryId);
    setTab("codex");
  };

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
      <RequestBar state={state} labels={resourceLabels(view?.ruleset ?? null)} send={send} />
      <main className="page">
        {tab === "party" ? (
          <div className="stack" style={{ gap: 24 }}>
            <TableModePicker me={me} state={state} ruleset={view?.ruleset ?? null} send={send} />
            <Party
              me={me}
              state={state}
              send={send}
              recaps={codex?.recaps ?? []}
              autoQr={quick}
              sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }}
            />
          </div>
        ) : tab === "track" ? (
          <Track
            me={me}
            state={state}
            send={send}
            sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }}
            entries={codex?.entries ?? []}
          />
        ) : tab === "standings" ? (
          <Standings games={state.games} />
        ) : tab === "prep" ? (
          <Prep me={me} state={state} codex={codex} send={send} onCall={handleCall} onOpenCodex={handleOpenCodex} />
        ) : tab === "codex" ? (
          <Codex key={openEntryId ?? ""} me={me} state={state} codex={codex} send={send} initialOpenId={openEntryId} />
        ) : tab === "tests" ? (
          <Tests state={state} send={send} testId={callTestId ?? undefined} />
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
