"use client";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";
import type { ChecklistStep } from "@inconsistable/rules-engine";

import { GM_TABS, type GmTab } from "@/components/gm/gm-app/constants";
import { HeaderItems } from "@/components/gm/gm-app/components/header-items/header-items";
import { CallBand } from "@/components/gm/header/call-band/call-band";
import { CallButton } from "@/components/gm/header/call-button/call-button";
import { HeaderPools } from "@/components/gm/header/header-pools/header-pools";
import { HistoryButton } from "@/components/gm/header/history-button/history-button";
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
import { ArchivedBanner } from "@/components/ui/archived-banner/archived-banner";
import { Peek } from "@/components/ui/peek/peek";
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
import { headerItems } from "@/lib/header/header";
import { gmAddress, parseGmAddress, type GmAddress } from "@/lib/gm-address/gm-address";
import type { RulesTabData } from "@/lib/library/library";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import type { Spawnable } from "@/lib/scene-prep/scene-prep";
import { resourceLabels } from "@/lib/spend-request/spend-request";

type GmAppProps = {
  me: Me;
  rules: RulesTabData | null;
  view: RulesView | null;
  /** The attached packs' creatures, for PREP's roster lines; null when they could not be read. */
  spawnable: Spawnable | null;
  quick?: boolean;
};

// The GM side of a table: the room's owner, its GMs, co-GMs (tabs filtered by scope), or an admin who opened it.
export function GmApp({ me, rules, view, spawnable, quick = false }: GmAppProps) {
  const t = useTranslations("gmApp");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const {
    state,
    codex,
    online,
    send,
    draftRecap,
    books,
    requestPage,
    xcard,
    notices,
    dismissNotices,
    history,
    watchHistory,
  } = useTable(me.campaignId);
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  const tabs = (Object.keys(GM_TABS) as GmTab[]).filter(
    (k) => canInCampaign({ ctx: me, perm: GM_TABS[k].perm }) && (k !== "standings" || (state?.games.length ?? 0) > 0),
  );

  // The address (house decision #111) is the state: the tab and what is open in it are read from the query. A tab the
  // seat may not open, or an id the seat does not hold, falls back (the first allowed tab, the list).
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = parseGmAddress(params);
  const ids = new Set(codex?.entries.map((e) => e.id));
  const holds = (id?: string) => id === undefined || codex === null || ids.has(id);
  const address: GmAddress = !tabs.includes(requested.tab)
    ? { tab: tabs.includes("party") ? "party" : (tabs[0] ?? "rules") }
    : {
        ...requested,
        ...(holds(requested.entry) ? {} : { entry: undefined }),
        ...(holds(requested.scene) ? {} : { scene: undefined }),
        ...(holds(requested.preview) ? {} : { preview: undefined }),
      };
  const tab = address.tab;
  const query = (a: GmAddress) => gmAddress(a, params.entries());
  const settled = gmAddress(address) === gmAddress(requested);

  // Keeps the history in step with the fallback once the room is read (STANDINGS depends on it): replaced, not pushed,
  // so Back does not loop. The history is the external system this syncs with.
  useEffect(() => {
    if (state && !settled) window.history.replaceState(null, "", `${pathname}?${gmAddress(address, params.entries())}`);
  });

  // Moves the address: one step of the browser's history. Not router.push: that would re-run the server page.
  const navigate = (next: GmAddress) => {
    const to = query(next);
    if (to !== query(address)) window.history.pushState(null, "", `${pathname}?${to}`);
  };
  const openTab = (next: GmTab, inner: Omit<GmAddress, "tab"> = {}) => navigate({ tab: next, ...inner });
  // A change inside the open tab; a key left out stays as it is.
  const go = (patch: Omit<GmAddress, "tab">) => navigate({ ...address, ...patch });
  const checklist = view?.ruleset?.checklist ?? [];

  // PREP's CALL: opens TESTS with that Test selected.
  const handleCall = (testId: string) => openTab("tests", { test: testId });

  // An entry a scene, a mention or a search names: its peek over the current tab (#218); GO TO leaves for CODEX.
  const [peekId, setPeekId] = useState<string | null>(null);
  const handleOpenCodex = (entryId: string) => setPeekId(entryId);
  // GO TO under a peek: CODEX with that entry open, where it is edited.
  const handleGoTo = (entryId: string) => {
    setPeekId(null);
    openTab("codex", { entry: entryId });
  };

  // A checklist step's GO TO (house decision #90): its tab, the codex listing its kind.
  const handleGo = (goto: NonNullable<ChecklistStep["goto"]>) => {
    // A checklist step may still name the old TRACK tab: it is SCENE's FIGHT layer now.
    if (goto.tab === "track") openTab("scene", { layer: "fight" });
    else openTab(goto.tab, goto.kind ? { kind: goto.kind } : {});
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
        <strong className="header-name">{state.campaign.name}</strong>
        <HeaderItems
          items={headerItems({
            ruleset: view?.ruleset ?? null,
            campaign: state.campaign.fields,
            encounter: state.encounter,
          })}
        />
        <span className="row">
          <HeaderPools
            me={me}
            state={state}
            codex={codex}
            ruleset={view?.ruleset ?? null}
            spawnable={spawnable}
            send={send}
          />
          {canInCampaign({ ctx: me, perm: "test:call" }) && <CallButton state={state} send={send} />}
          {/* HISTORY is Undo's (house decision #133): the seats that may undo, event.undo's permission. */}
          {canInCampaign({ ctx: me, perm: "encounter:run" }) && (
            <HistoryButton
              state={state}
              ruleset={view?.ruleset ?? null}
              send={send}
              history={history}
              watch={watchHistory}
            />
          )}
          {me.seat.kind === "admin" && <span className="chip">{t("header.admin")}</span>}
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
      {tab !== "tests" && canInCampaign({ ctx: me, perm: "test:call" }) && (
        <CallBand state={state} send={send} onMore={() => openTab("tests")} />
      )}
      <ActionNotices notices={notices} onDismiss={dismissNotices} />
      {state.campaign.archived && (
        <ArchivedBanner
          onReopen={canInCampaign({ ctx: me, perm: "campaign:archive" }) ? () => openTab("party") : undefined}
        />
      )}
      {peekId && (
        <Peek
          entryId={peekId}
          entries={codex?.entries ?? []}
          ruleset={view?.ruleset ?? null}
          campaignId={me.campaignId}
          campaign={state.campaign.fields}
          known={view?.first.entries ?? []}
          held={[]}
          onOpen={setPeekId}
          onClose={() => setPeekId(null)}
          onGoTo={canInCampaign({ ctx: me, perm: "codex:write" }) ? handleGoTo : undefined}
        />
      )}
      <main className="page">
        {tab === "party" ? (
          <div className="stack" style={{ gap: 24 }}>
            {checklist.length > 0 && (
              <SetupChecklist
                steps={checklist}
                room={checklistRoom({ state, entries: codex?.entries ?? [], packs: view?.first.packs ?? [] })}
                onGo={handleGo}
                terms={view?.ruleset ? { ruleset: view.ruleset, books, requestPage } : undefined}
              />
            )}
            <TableModePicker me={me} state={state} ruleset={view?.ruleset ?? null} send={send} />
            <Party
              me={me}
              state={state}
              send={send}
              draftRecap={draftRecap}
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
            address={address}
            onNav={go}
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
            known={view?.first.entries ?? []}
            onPlay={() => openTab("scene")}
            openId={address.scene ?? null}
            mode={address.mode ?? "prepare"}
            onNav={go}
          />
        ) : tab === "codex" ? (
          <Codex
            kind={address.kind ?? null}
            openId={address.entry ?? null}
            onNav={go}
            onPeek={setPeekId}
            me={me}
            state={state}
            codex={codex}
            send={send}
            ruleset={view?.ruleset ?? null}
            known={view?.first.entries}
            books={books}
            requestPage={requestPage}
            spawnable={spawnable}
          />
        ) : tab === "tests" ? (
          <Tests state={state} send={send} testId={address.test} />
        ) : tab === "rules" ? (
          <div className="stack" style={{ gap: 32 }}>
            <RulesPanel
              me={me}
              send={send}
              data={rules}
              state={state}
              ruleset={view?.ruleset ?? null}
              books={books}
              requestPage={requestPage}
            />
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
