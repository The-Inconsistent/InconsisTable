"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { canInCampaign, type Me } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { TAB_PARAM } from "@/components/gm/gm-app/constants";
import { PLAYER_TABS, type PlayerTab } from "@/components/player/player-app/constants";
import { Notebook } from "@/components/player/notebook/notebook";
import { RecapCard } from "@/components/ui/recap-card/recap-card";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { DoneButton } from "@/components/player/done-button/done-button";
import { FightTab } from "@/components/player/fight-tab/fight-tab";
import { HitSheet } from "@/components/player/hit-sheet/hit-sheet";
import { PhoneStrip } from "@/components/player/phone-strip/phone-strip";
import { TurnBanner } from "@/components/player/turn-banner/turn-banner";
import { WhisperSheet } from "@/components/player/whisper-sheet/whisper-sheet";
import { Peek } from "@/components/ui/peek/peek";
import { SpotlightCard } from "@/components/ui/spotlight-card/spotlight-card";
import { ShowingBar } from "@/components/gm/codex/components/showing-bar/showing-bar";
import { ArchivedBanner } from "@/components/ui/archived-banner/archived-banner";
import { CiteProvider } from "@/components/ui/cite/cite";
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
import { TestPrompt } from "@/components/player/test-prompt/test-prompt";
import { XCardButton } from "@/components/ui/xcard/xcard-button";
import { XCardOverlay } from "@/components/ui/xcard/xcard-overlay";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { RunTable } from "@/components/player/run-table/run-table";
import { useBookServer } from "@/hooks/use-book-server/use-book-server";
import { useTable } from "@/hooks/use-table/use-table";
import { useSeen } from "@/hooks/use-seen/use-seen";
import { useWorldRefresh } from "@/hooks/use-world-refresh/use-world-refresh";
import { needsBuild } from "@/lib/builder/builder";
import { playerEntryOf, usesLedger, xpToSpendOf } from "@/lib/ledger/table";
import { layoutRows } from "@/lib/panels/panels";
import { phoneStatusOf } from "@/lib/phone-status/phone-status";
import { parsePlayerTab, playerAddress, settledTab } from "@/lib/player-address/player-address";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import { entrySeenKey } from "@/lib/seen/seen";
import { rangeOf } from "@/lib/sheet/sheet";
import { dismissKey, spotlitEntry, xcardUp } from "@/lib/spotlight/spotlight";

type PlayerAppProps = { me: Me; view: RulesView | null; quick?: boolean };

// The phone: one seat, possibly several characters (a companion, a funnel, a friend's character). The strip at the
// top switches between them (docs/design.md §3.7). Sheets, the fight and the map arrive with the first ruleset (P1).
export function PlayerApp({ me, view, quick = false }: PlayerAppProps) {
  const t = useTranslations("playerApp");
  const tTable = useTranslations("table");
  const tPhoneStatus = useTranslations("playerApp.status");
  const tSpot = useTranslations("spotlight");
  const tStatus = useTranslations("status");
  const tXp = useTranslations("ledgerBuilder.play.xp");
  const { state, codex, online, send, draftRecap, books, requestPage, serveBooks, xcard, notices, dismissNotices } =
    useTable(me.campaignId);
  // Without a GM the owner's device serves the books (house decision #147); it lives here so it outlasts RUN's tabs.
  const bookServer = useBookServer({ serveBooks, sources: view?.ruleset?.sources ?? NO_SOURCES });
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  const held = me.seat.kind === "admin" ? [] : me.seat.characterIds;
  const [current, setCurrent] = useState(held[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  // The seat's manifest compiled once (house decision #101), for the strip's limits, the panels and the strike guide.
  const seatRuleset = view?.ruleset ?? null;
  const compiled = useMemo(() => {
    if (seatRuleset === null) return null;
    const c = compileRuleset(seatRuleset);
    return c.ok ? c.compiled : null;
  }, [seatRuleset]);

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
  const seen = useSeen({
    storageKey: `it:seen:notebook:${me.campaignId}`,
    keys: codex ? codex.entries.map(entrySeenKey) : null,
    viewing: tab === "notebook",
  });
  // The entry over the screen (#218): a mention, a link, a search hit or an inbox card opens it.
  const [peekId, setPeekId] = useState<string | null>(null);
  // What this phone holds up to the table (SHOW THE TABLE, #2): local to the phone, nothing is sent.
  const [heldUp, setHeldUp] = useState<string | null>(null);
  // The `at` of the GM's SHOW dismissed on this page, before storage has it.
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  // The X-card's touch count when it last came down: until then a card held or shown yields to it.
  const [xcardClosed, setXcardClosed] = useState(0);

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
  // The GM's SHOW (#2): up until this phone dismisses it; the dismissal is kept per `at`, so a new SHOW opens again.
  const spotKey = dismissKey(me.campaignId);
  const spotAt = state.spotlight?.at ?? null;
  const spotEntry = spotlitEntry({ spotlight: state.spotlight, entries: codex?.entries ?? [], held });
  const spotDismissed = () => {
    if (spotAt === null || dismissedAt === spotAt) return true;
    try {
      return localStorage.getItem(spotKey) === spotAt;
    } catch {
      return false;
    }
  };
  // DISMISS on the GM's SHOW: this phone only.
  const handleDismissSpot = () => {
    setDismissedAt(spotAt);
    try {
      if (spotAt) localStorage.setItem(spotKey, spotAt);
    } catch {
      // No storage: the card stays dismissed until the page reloads.
    }
  };
  // SHOW THE TABLE under a peek: the entry full-screen, the browser's fullscreen asked from the tap itself.
  const handleHoldUp = async (entryId: string) => {
    setPeekId(null);
    setHeldUp(entryId);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Not offered (an iPhone): the card covers the page all the same.
    }
  };
  // Lowering it: the card goes and the browser leaves fullscreen.
  const handleLetDown = async () => {
    setHeldUp(null);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Already out of fullscreen.
    }
  };
  const heldEntry = (codex?.entries ?? []).find((e) => e.id === heldUp) ?? null;
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
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  // A resource's limit for the shown character, worked out on this device from the seat's manifest.
  const maxOf = (resource: string) =>
    compiled && character
      ? (rangeOf({ compiled, resource, actor: character, characters, campaign: state.campaign.fields })?.max ?? null)
      : null;
  const strip =
    ruleset && character && !needsBuild(character)
      ? layoutRows({ ruleset, entity: character.entity, target: "phoneStrip" })
      : null;

  // LEAVE: give up this seat; the character stays at the table for the GM.
  const handleLeave = async () => {
    const r = await send({ type: "seat.leave" });
    // /leave is a route handler that expires the httpOnly cookie, so it needs a full navigation, not a router push.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (r.ok) window.location.href = "/leave";
    else setError(r.error);
  };

  return (
    <CiteProvider ruleset={ruleset} books={books} requestPage={requestPage}>
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
        {ruleset && character && strip && (
          <PhoneStrip ruleset={ruleset} actor={character} rows={strip} maxOf={maxOf} pools={state.pools} />
        )}
        {ruleset && character && (
          <HitSheet
            key={character.id}
            actor={character}
            table={state}
            requests={state.requests}
            {...{ ruleset, compiled, characters, send, books, requestPage }}
          />
        )}
        <XCardOverlay signal={xcard} onClose={() => setXcardClosed(xcard)} />
        {peekId && (
          <Peek
            entryId={peekId}
            entries={codex?.entries ?? []}
            ruleset={ruleset}
            campaignId={me.campaignId}
            campaign={state.campaign.fields}
            known={view?.first.entries ?? []}
            held={held}
            onOpen={setPeekId}
            onClose={() => setPeekId(null)}
            onHold={handleHoldUp}
          />
        )}
        {xcardUp({ signal: xcard, closedAt: xcardClosed }) ? null : heldEntry ? (
          <SpotlightCard
            key={heldEntry.id}
            entry={heldEntry}
            campaignId={me.campaignId}
            entries={codex?.entries ?? []}
            ruleset={ruleset}
            known={view?.first.entries ?? []}
            campaign={state.campaign.fields}
            kicker={tSpot("holding")}
            onClose={handleLetDown}
            xcard={<XCardButton me={me} state={state} send={send} />}
          />
        ) : (
          spotEntry &&
          !spotDismissed() && (
            <SpotlightCard
              key={spotAt}
              entry={spotEntry}
              campaignId={me.campaignId}
              entries={codex?.entries ?? []}
              ruleset={ruleset}
              known={view?.first.entries ?? []}
              campaign={state.campaign.fields}
              kicker={tSpot("fromGm")}
              onClose={handleDismissSpot}
              xcard={<XCardButton me={me} state={state} send={send} />}
            />
          )
        )}
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
          {lastTime && !lastTimeDismissed() && (
            <RecapCard
              recap={lastTime}
              entries={codex?.entries ?? []}
              onPeek={setPeekId}
              onDismiss={handleDismissLastTime}
            />
          )}
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
          {canInCampaign({ ctx: me, perm: "codex:reveal" }) && (
            <ShowingBar spotlight={state.spotlight} entries={codex?.entries ?? []} actors={state.actors} send={send} />
          )}
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
          {!state.encounter && state.games[0] && <GameResult game={state.games[0]} held={held} />}
          {tab === "notebook" ? (
            <Notebook
              codex={codex}
              whispers={state.whispers}
              actors={state.actors}
              next={{ at: state.campaign.nextSessionAt, place: state.campaign.nextSessionPlace }}
              me={me}
              safety={state.campaign.safety}
              send={send}
              ruleset={ruleset}
              known={view?.first.entries ?? []}
              campaign={state.campaign.fields}
              held={held}
              fresh={seen.fresh}
              onMarkAll={seen.markAll}
              onPeek={setPeekId}
            />
          ) : tab === "fight" ? (
            <FightTab {...{ state, ruleset, compiled, character, held, characters, send, books, requestPage, maxOf }} />
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
              onPeek={setPeekId}
              bookServer={bookServer}
            />
          ) : tab === "sheet" ? (
            character && view?.ruleset && !needsBuild(character) ? (
              <SheetView
                key={character.id}
                actor={character}
                ruleset={view.ruleset}
                characters={characters}
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
            const fresh = name === "notebook" ? seen.count : 0;
            const label = t(`tabs.${name}`);
            return (
              <button
                key={name}
                className="tab"
                role="tab"
                aria-selected={tab === name}
                aria-label={
                  live
                    ? t("tabLive", { tab: label })
                    : fresh > 0
                      ? t("tabNew", { tab: label, count: fresh })
                      : undefined
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
    </CiteProvider>
  );
}

const NO_SOURCES: Ruleset["sources"] = [];
