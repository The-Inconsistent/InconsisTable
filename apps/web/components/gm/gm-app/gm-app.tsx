"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { canInCampaign, type CodexKind, type Me } from "@inconsistable/core-schema";
import type { ChecklistStep } from "@inconsistable/rules-engine";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { Codex } from "@/components/gm/codex/codex";
import { Party } from "@/components/gm/party/party";
import { Prep } from "@/components/gm/prep/prep";
import { RequestBar } from "@/components/gm/request-bar/request-bar";
import { RulesPanel } from "@/components/gm/rules/rules-panel";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { SetupChecklist } from "@/components/gm/setup-checklist/setup-checklist";
import { Scene } from "@/components/gm/scene/scene";
import { WhisperButton } from "@/components/gm/whisper-button/whisper-button";
import { ActionNotices } from "@/components/ui/action-notices/action-notices";
import { TableModePicker } from "@/components/player/run-table/table-mode-picker";
import { Tests } from "@/components/gm/tests/tests";
import { Standings } from "@/components/ui/standings/standings";
import { XCardOverlay } from "@/components/ui/xcard/xcard-overlay";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import { useWorldRefresh } from "@/hooks/use-world-refresh/use-world-refresh";
import { checklistRoom } from "@/lib/checklist/checklist";
import type { RulesTabData } from "@/lib/library/library";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import type { Spawnable } from "@/lib/scene-prep/scene-prep";
import { resourceLabels } from "@/lib/spend-request/spend-request";

type GmAppProps = {
  me: Me;
  initialTab: GmTab;
  /** `?tab=track`: the SCENE tab opens on its FIGHT layer. */
  initialFight: boolean;
  rules: RulesTabData | null;
  view: RulesView | null;
  /** The attached packs' creatures, for PREP's roster lines; null when they could not be read. */
  spawnable: Spawnable | null;
  quick?: boolean;
};

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, initialTab, initialFight, rules, view, spawnable, quick = false }: GmAppProps) {
  const t = useTranslations("gmApp");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, codex, online, send, draftRecap, books, requestPage, xcard, notices, dismissNotices } = useTable(
    me.campaignId,
  );
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter(
    (k) => canInCampaign({ ctx: me, perm: GM_TABS[k].perm }) && (k !== "standings" || (state?.games.length ?? 0) > 0),
  );
  const [tab, setTab] = useState<GmTab>(
    tabs.includes(initialTab) ? initialTab : tabs.includes("party") ? "party" : (tabs[0] ?? "rules"),
  );
  // The SCENE tab opens on FIGHT only when it was asked to (?tab=track, or a checklist step that goes to TRACK).
  const [fightFirst, setFightFirst] = useState(initialFight);
  const openTab = (next: GmTab, fight = false) => {
    setFightFirst(fight);
    setTab(next);
  };

  const [callTestId, setCallTestId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [codexKind, setCodexKind] = useState<CodexKind | null>(null);
  const checklist = view?.ruleset?.checklist ?? [];

  // PREP's CALL: opens TESTS with that Test selected (held in state, not the URL).
  const handleCall = (testId: string) => {
    setCallTestId(testId);
    openTab("tests");
  };

  // PREP's "Open in CODEX": opens CODEX with that entry open.
  const handleOpenCodex = (entryId: string) => {
    setOpenEntryId(entryId);
    setCodexKind(null);
    openTab("codex");
  };

  // A checklist step's GO TO (house decision #90): its tab, the codex listing its kind.
  const handleGo = (goto: NonNullable<ChecklistStep["goto"]>) => {
    setOpenEntryId(null);
    setCodexKind(goto.kind ?? null);
    // A checklist step may still name the old TRACK tab: it is SCENE's FIGHT layer now.
    if (goto.tab === "track") openTab("scene", true);
    else openTab(goto.tab);
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
          {/* Whispers need a GM (house decision #93); the side that runs the session sends them. */}
          {state.campaign.tableMode === "gm" &&
            canInCampaign({ ctx: { ...me, tableMode: "gm" }, perm: "session:run" }) && (
              <WhisperButton campaignId={me.campaignId} state={state} send={send} />
            )}
          <SettingsMenu />
        </span>
      </header>
      <XCardOverlay signal={xcard} />
      <TransferOffer me={me} state={state} send={send} />
      <nav className="tabs" role="tablist" aria-label={t("tabsLabel")}>
        {tabs.map((name) => (
          <button key={name} className="tab" role="tab" aria-selected={tab === name} onClick={() => openTab(name)}>
            {t(`tabs.${name}`)}
          </button>
        ))}
      </nav>
      <RequestBar
        state={state}
        labels={resourceLabels(view?.ruleset ?? null)}
        ruleset={view?.ruleset ?? null}
        send={send}
      />
      <ActionNotices notices={notices} onDismiss={dismissNotices} />
      <main className="page">
        {tab === "party" ? (
          <div className="stack" style={{ gap: 24 }}>
            {checklist.length > 0 && (
              <SetupChecklist
                steps={checklist}
                room={checklistRoom({ state, entries: codex?.entries ?? [], packs: view?.first.packs ?? [] })}
                onGo={handleGo}
              />
            )}
            <TableModePicker me={me} state={state} ruleset={view?.ruleset ?? null} send={send} />
            <Party
              me={me}
              state={state}
              send={send}
              draftRecap={draftRecap}
              recaps={codex?.recaps ?? []}
              autoQr={quick}
              sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }}
            />
          </div>
        ) : tab === "scene" ? (
          <Scene
            me={me}
            state={state}
            codex={codex}
            send={send}
            ruleset={view?.ruleset ?? null}
            spawnable={spawnable}
            known={view?.first.entries ?? []}
            sheet={{ ruleset: view?.ruleset ?? null, books, requestPage }}
            initialFight={fightFirst}
            onOpenCodex={handleOpenCodex}
          />
        ) : tab === "standings" ? (
          <Standings games={state.games} />
        ) : tab === "prep" ? (
          <Prep
            me={me}
            state={state}
            codex={codex}
            send={send}
            ruleset={view?.ruleset ?? null}
            spawnable={spawnable}
            onCall={handleCall}
            onOpenCodex={handleOpenCodex}
          />
        ) : tab === "codex" ? (
          <Codex
            key={`${openEntryId ?? ""}/${codexKind ?? ""}`}
            initialKind={codexKind}
            me={me}
            state={state}
            codex={codex}
            send={send}
            initialOpenId={openEntryId}
            ruleset={view?.ruleset ?? null}
            known={view?.first.entries}
            books={books}
            requestPage={requestPage}
          />
        ) : tab === "tests" ? (
          <Tests state={state} send={send} testId={callTestId ?? undefined} />
        ) : tab === "rules" ? (
          <div className="stack" style={{ gap: 32 }}>
            <RulesPanel me={me} send={send} data={rules} state={state} ruleset={view?.ruleset ?? null} />
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
