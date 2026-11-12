"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Me } from "@inconsistable/core-schema";

import { PLAYER_TABS, type PlayerTab } from "@/components/player/player-app/constants";
import { Notebook } from "@/components/player/notebook/notebook";
import { RecapCard } from "@/components/ui/recap-card/recap-card";
import { RulesReader } from "@/components/rules/rules-reader/rules-reader";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { DoneButton } from "@/components/player/done-button/done-button";
import { TurnBanner } from "@/components/player/turn-banner/turn-banner";
import { ClocksView } from "@/components/ui/clocks-view/clocks-view";
import { GameResult } from "@/components/ui/game-result/game-result";
import { Standings } from "@/components/ui/standings/standings";
import { OrderView } from "@/components/ui/order-view/order-view";
import { TestPrompt } from "@/components/player/test-prompt/test-prompt";
import { SettingsMenu } from "@/components/ui/settings-menu/settings-menu";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { TransferOffer } from "@/components/ui/transfer-offer/transfer-offer";
import { useTable } from "@/hooks/use-table/use-table";
import { needsBuild } from "@/lib/builder/builder";
import type { RulesView } from "@/lib/rules-reader/rules-reader";

type PlayerAppProps = { me: Me; view: RulesView | null };

// The phone: one seat, possibly several characters (a companion, a funnel, a friend's character). The strip at the
// top switches between them (docs/design.md §3.7). Sheets, the fight and the map arrive with the first ruleset (P1).
export function PlayerApp({ me, view }: PlayerAppProps) {
  const t = useTranslations("playerApp");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, codex, online, send, books, requestPage } = useTable(me.campaignId);
  const held = me.seat.kind === "admin" ? [] : me.seat.characterIds;
  const [current, setCurrent] = useState(held[0] ?? "");
  const [tab, setTab] = useState<PlayerTab>("sheet");
  const [error, setError] = useState<string | null>(null);

  const [dismissedNow, setDismissedNow] = useState<string | null>(null);

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
        <span className="row">
          {state.session && <span className="chip">{tTable("session", { number: state.session.number })}</span>}
          <SettingsMenu />
        </span>
      </header>
      <TransferOffer me={me} state={state} send={send} />
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
        {character && needsBuild(character) && (
          <a
            className="btn primary"
            href={`/c/${me.campaignId}/build/${character.id}`}
            style={{ justifySelf: "start" }}
          >
            {state.myDraft?.actorId === character.id ? t("continueBuilding") : t("build")}
          </a>
        )}
        <ClocksView clocks={state.clocks} />
        {state.encounter && <OrderView encounter={state.encounter} />}
        {!state.encounter && state.games[0] && <GameResult game={state.games[0]} held={held} />}
        {tab === "notebook" ? (
          <Notebook codex={codex} />
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
        {PLAYER_TABS.filter((name) => name !== "standings" || state.games.length > 0).map((name) => (
          <button key={name} className="tab" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {t(`tabs.${name}`)}
          </button>
        ))}
      </nav>
    </div>
  );
}
