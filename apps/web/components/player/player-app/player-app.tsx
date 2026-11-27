"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";

import { TAB_PARAM } from "@/components/gm/gm-app/constants";
import { PLAYER_TABS, type PlayerTab } from "@/components/player/player-app/constants";
import { Notebook } from "@/components/player/notebook/notebook";
import { RecapCard } from "@/components/ui/recap-card/recap-card";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { DoneButton } from "@/components/player/done-button/done-button";
import { Fight } from "@/components/player/fight/fight";
import { TurnBanner } from "@/components/player/turn-banner/turn-banner";
import { WhisperSheet } from "@/components/player/whisper-sheet/whisper-sheet";
import { ArchivedBanner } from "@/components/ui/archived-banner/archived-banner";
import { ClocksView } from "@/components/ui/clocks-view/clocks-view";
import { PoolsView } from "@/components/ui/pools-view/pools-view";
import { poolSidesOf, poolSteps } from "@/lib/pools/pools";
import { YourCards } from "@/components/ui/your-cards/your-cards";
import { ActionNotices } from "@/components/ui/action-notices/action-notices";
import { RequestNotices } from "@/components/ui/request-notices/request-notices";
import { SpendAsks } from "@/components/ui/spend-asks/spend-asks";
import { resourceLabels, spendLabels } from "@/lib/spend-request/spend-request";
import { GameResult } from "@/components/ui/game-result/game-result";
import { Standings } from "@/components/ui/standings/standings";
import { OrderView } from "@/components/ui/order-view/order-view";
import { TestPrompt } from "@/components/player/test-prompt/test-prompt";
import { XCardButton } from "@/components/ui/xcard/xcard-button";
import { XCardOverlay } from "@/components/ui/xcard/xcard-overlay";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { RunTable } from "@/components/player/run-table/run-table";
import { useTable } from "@/hooks/use-table/use-table";
import { useSeen } from "@/hooks/use-seen/use-seen";
import { useWorldRefresh } from "@/hooks/use-world-refresh/use-world-refresh";
import { needsBuild } from "@/lib/builder/builder";
import { playerEntryOf, usesLedger, xpToSpendOf } from "@/lib/ledger/table";
import { heldChips } from "@/lib/held/held";
import { phoneStatusOf } from "@/lib/phone-status/phone-status";
import { parsePlayerTab, playerAddress, settledTab } from "@/lib/player-address/player-address";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import { seenKey } from "@/lib/seen/seen";

type PlayerAppProps = { me: Me; view: RulesView | null; quick?: boolean };

// The phone: one seat, possibly several characters (a companion, a funnel, a friend's character). The strip at the
// top switches between them (docs/design.md §3.7). Sheets, the fight and the map arrive with the first ruleset (P1).
export function PlayerApp({ me, view, quick = false }: PlayerAppProps) {
  const t = useTranslations("playerApp");
  const tTable = useTranslations("table");
  const tPhoneStatus = useTranslations("playerApp.status");
  const tStatus = useTranslations("status");
  const tXp = useTranslations("ledgerBuilder.play.xp");
  const { state, codex, online, send, draftRecap, books, requestPage, xcard, notices, dismissNotices } = useTable(
    me.campaignId,
  );
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  const held = me.seat.kind === "admin" ? [] : me.seat.characterIds;
  const [current, setCurrent] = useState(held[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const [dismissedNow, setDismissedNow] = useState<string | null>(null);

  // The open tab is the address (house decision #112): read from the query, written with replaceState on a tap. A tab the
  // seat may not open (run without the table to run, standings before a game) falls back to the default, replaced.
  const pathname = usePathname();
  const params = useSearchParams();
  const allowed = PLAYER_TABS.filter(
    (name) =>
      (name !== "standings" || (state?.games.length ?? 0) > 0) &&
      // Without a GM the phone also runs the table, from one tab of its own.
      (name !== "run" || canInCampaign({ ctx: me, perm: "session:run" })),
  );
  const tab = settledTab({ requested: parsePlayerTab(params), allowed, fallback: quick ? "run" : "sheet" });
  const newCount = useSeen({
    storageKey: `it:seen:notebook:${me.campaignId}`,
    keys: codex ? codex.entries.map((e) => seenKey({ id: e.id, stamp: e.revealedAt })) : null,
    viewing: tab === "notebook",
  });

  // Syncs with the browser history: a tab the seat may not open is replaced in the address once the room is read.
  useEffect(() => {
    if (state && params.has(TAB_PARAM) && params.get(TAB_PARAM) !== tab)
      window.history.replaceState(null, "", `${pathname}?${playerAddress({ tab, keep: params.entries() })}`);
  });

  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  const lastTime = state.session && codex?.recaps[0];
  const lastTimeKey = state.session ? `it:last-time:${state.session.id}` : "";
  const handleDismissLastTime = () => {
    setDismissedNow(lastTimeKey);
    try {
      localStorage.setItem(lastTimeKey, "1");
    } catch {
      // No storage: the card stays dismissed until the page reloads.
    }
  };
  const lastTimeDismissed = () => {
    if (dismissedNow === lastTimeKey) return true;
    try {
      return localStorage.getItem(lastTimeKey) === "1";
    } catch {
      return false;
    }
  };
  const mine = state.actors.filter((a) => held.includes(a.id));
  const character = mine.find((a) => a.id === current) ?? mine[0];
  // A character the ledger builder builds has an entry while it has no saved build, and once built while it has XP
  // to spend (Level up, on the purchases); the sheet's XP box keeps the way in otherwise.
  const ruleset = view?.ruleset ?? null;
  const ledgerEntry = character ? playerEntryOf({ ruleset, actor: character }) : null;
  const builderHref = character ? `/c/${me.campaignId}/build/${character.id}` : "";
  const buildEntry =
    character && (ledgerEntry !== null || (!usesLedger({ ruleset, actor: character }) && needsBuild(character)));

  // A tab tap: the address follows, replaced not pushed (Back leaves the table page, not the last tab).
  const handleTab = (next: PlayerTab) =>
    window.history.replaceState(null, "", `${pathname}?${playerAddress({ tab: next, keep: params.entries() })}`);
  const status = phoneStatusOf({ encounter: state.encounter, held, showRound: view?.ruleset?.header?.round === true });

  // LEAVE: give up this seat; the character stays at the table for the GM.
  const handleLeave = async () => {
    const r = await send({ type: "seat.leave" });
    // /leave is a route handler that expires the httpOnly cookie, so it needs a full navigation, not a router push.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.ok) window.location.href = "/leave";
    else setError(r.error);
  };

  return (
    <div className="surface-table">
      <header className="band">
        {!online && (
          <span className="badge-offline" role="status">
            {tTable("offline")}
          </span>
        )}
        <strong>{state.campaign.name}</strong>
        {status && (
          <span className="chip phone-status" role="status" aria-label={tPhoneStatus("label")}>
            {tPhoneStatus(status.line, { round: status.line === "round" ? status.round : 0 })}
          </span>
        )}
        <span className="row">
          {state.session && <span className="chip">{tTable("session", { number: state.session.number })}</span>}
          <XCardButton me={me} state={state} send={send} />
          <SettingsMenu />
        </span>
      </header>
      {state.campaign.archived && <ArchivedBanner />}
      <XCardOverlay signal={xcard} />
      <TransferOffer me={me} state={state} send={send} />
      <WhisperSheet
        whispers={state.whispers}
        actors={state.actors}
        several={held.length > 1}
        waiting={state.tests.some(
          (c) => c.status === "open" && c.targets.some((tg) => held.includes(tg.actorId) && tg.report === null),
        )}
        send={send}
      />
      {mine.length > 1 && (
        <nav className="tabs" role="tablist" aria-label={t("charactersLabel")}>
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
        {lastTime && !lastTimeDismissed() && <RecapCard recap={lastTime} onDismiss={handleDismissLastTime} />}
        <TurnBanner encounter={state.encounter} held={held} />
        <DoneButton encounter={state.encounter} held={held} send={send} />
        <TestPrompt state={state} send={send} />
        <h1 className="title sheet-name">{character?.name ?? t("noCharacter")}</h1>
        {character && buildEntry && (
          <a
            className="btn primary"
            href={ledgerEntry === "levelUp" ? `${builderHref}?step=advance` : builderHref}
            style={{ justifySelf: "start" }}
          >
            {ledgerEntry === "levelUp"
              ? tXp("levelUp", { xp: xpToSpendOf({ ruleset, actor: character }) })
              : ledgerEntry === "continue" || state.myDraft?.actorId === character.id
                ? t("continueBuilding")
                : t("build")}
          </a>
        )}
        {ledgerEntry === "continue" && <p className="small dim">{t("buildDraft")}</p>}
        <ActionNotices notices={notices} onDismiss={dismissNotices} />
        <RequestNotices
          answers={state.requestAnswers}
          actors={state.actors}
          labels={resourceLabels(view?.ruleset ?? null)}
          spends={spendLabels(view?.ruleset ?? null)}
        />
        <SpendAsks
          requests={state.requests}
          actors={state.actors}
          held={held}
          spends={spendLabels(view?.ruleset ?? null)}
        />
        <PoolsView pools={state.pools} steps={(pool) => poolSteps({ pool, ...poolSidesOf(me) })} send={send} />
        <ClocksView clocks={state.clocks} />
        <YourCards
          dealt={state.dealt}
          held={held}
          actors={state.actors}
          titles={Object.fromEntries(Object.entries(view?.ruleset?.tables ?? {}).map(([id, tb]) => [id, tb.title]))}
        />
        {/* The Fight tab draws the order itself, with the seat's own marked. */}
        {state.encounter && tab !== "fight" && (
          <OrderView
            encounter={state.encounter}
            sides={view?.ruleset?.initiative?.strategy === "sides" ? view.ruleset.initiative : undefined}
            conditions={view?.ruleset?.conditions}
            heldOf={(id) => heldChips({ ruleset: view?.ruleset, actor: state.actors.find((a) => a.id === id) })}
          />
        )}
        {!state.encounter && state.games[0] && <GameResult game={state.games[0]} held={held} />}
        {tab === "notebook" ? (
          <Notebook
            codex={codex}
            whispers={state.whispers}
            actors={state.actors}
            me={me}
            safety={state.campaign.safety}
            send={send}
            ruleset={ruleset}
            known={view?.first.entries ?? []}
          />
        ) : tab === "standings" ? (
          <Standings games={state.games} />
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
            <p className="error">{t("rulesFailed")}</p>
          )
        ) : tab === "run" ? (
          <RunTable
            me={me}
            state={state}
            codex={codex}
            send={send}
            draftRecap={draftRecap}
            ruleset={view?.ruleset ?? null}
            books={books}
            requestPage={requestPage}
            quick={quick}
          />
        ) : tab === "sheet" ? (
          character && view?.ruleset && !needsBuild(character) ? (
            <SheetView
              key={character.id}
              actor={character}
              ruleset={view.ruleset}
              characters={state.actors.filter((a) => a.kind === "pc").length}
              campaign={state.campaign.fields}
              gm={false}
              requests={state.requests}
              table={state}
              builderHref={`${builderHref}?step=advance`}
              {...{ send, books, requestPage }}
            />
          ) : !character || !needsBuild(character) ? (
            <p className="dim">{t("sheetPending")}</p>
          ) : null
        ) : tab === "fight" ? (
          <Fight
            state={state}
            ruleset={ruleset}
            held={held}
            requests={state.requests}
            {...{ send, books, requestPage }}
          />
        ) : (
          <p className="dim">{t("tabPending")}</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" onClick={handleLeave} style={{ justifySelf: "start" }}>
          {t("leave")}
        </button>
      </main>
      <nav className="tabs tabs-bottom safe-bottom" role="tablist" aria-label={t("tabsLabel")}>
        {allowed.map((name) => {
          const live = name === "fight" && state.encounter !== null;
          const fresh = name === "notebook" ? newCount : 0;
          const label = t(`tabs.${name}`);
          return (
            <button
              key={name}
              className="tab"
              role="tab"
              aria-selected={tab === name}
              aria-label={
                live ? t("tabLive", { tab: label }) : fresh > 0 ? t("tabNew", { tab: label, count: fresh }) : undefined
              }
              onClick={() => handleTab(name)}
            >
              {label}
              {live && <span className="tab-live" aria-hidden="true" />}
              {fresh > 0 && (
                <span className="tab-count" aria-hidden="true">
                  {fresh}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
