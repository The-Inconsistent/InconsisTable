"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type CSSProperties } from "react";

import type { Lobby, LobbyGame } from "@inconsistable/core-schema";

import { AccountBar } from "@/components/lobby/account-bar/account-bar";
import { ImportRoom } from "@/components/lobby/import-room/import-room";
import { QuickGame } from "@/components/lobby/quick-game/quick-game";
import { YourCharacters } from "@/components/lobby/your-characters/your-characters";
import { PageHead } from "@/components/ui/page-head/page-head";
import type { AuthMe } from "@/lib/api-reply/api-reply";
import type { ModuleList, RulesetList } from "@/lib/library/library";

type LobbyViewProps = { lobby: Lobby; rulesets: RulesetList; modules: ModuleList; me: AuthMe; signInFailed: boolean };

function GameCard({ game, i }: { game: LobbyGame; i: number }) {
  const t = useTranslations("lobby");
  const tRoles = useTranslations("roles");
  const tModes = useTranslations("tableModes");
  const format = useFormatter();
  return (
    <a className="card ws-tile" href={`/c/${game.id}`} style={{ "--i": i } as CSSProperties}>
      <strong className="card-name">{game.name}</strong>
      <span className="small dim">{game.isOwner ? t("yourCampaign") : t("owner", { name: game.owner })}</span>
      {game.plays && <span className="small">{t("plays", { game: game.plays, mode: tModes(game.tableMode) })}</span>}
      <span className="row small">
        {game.role && <span className="chip">{tRoles(game.role)}</span>}
        <span className="chip">{t("characters", { count: game.players })}</span>
        {game.session !== null && (
          <span className="chip" data-live="true">
            {t("sessionRunning", { number: game.session })}
          </span>
        )}
        {game.session === null && game.nextSessionAt && (
          <span className="chip">
            {t("nextSession", {
              when: format.dateTime(new Date(game.nextSessionAt), { dateStyle: "medium", timeStyle: "short" }),
            })}
          </span>
        )}
      </span>
    </a>
  );
}

function Cards({ games }: { games: LobbyGame[] }) {
  return (
    <div className="grid rise-list">
      {games.map((g, i) => (
        <GameCard key={g.id} game={g} i={i} />
      ))}
    </div>
  );
}

function Section({ title, games, empty }: { title: string; games: LobbyGame[]; empty: string }) {
  return (
    <section className="stack">
      <h2 className="head">
        {title} <span className="ws-tally">{games.length}</span>
      </h2>
      {games.length ? <Cards games={games} /> : <p className="dim">{empty}</p>}
    </section>
  );
}

// ROOMS: the ones you own, the ones where you play or co-GM, and the archived ones; plus, for creators, NEW CAMPAIGN (the
// wizard's page, house decision #142), QUICK GAME and IMPORT A ROOM, and the account bar on deployments that sign in.
export function LobbyView({ lobby, rulesets, modules, me, signInFailed }: LobbyViewProps) {
  const t = useTranslations("lobby");
  const tWs = useTranslations("workspace");
  const [quick, setQuick] = useState(false);
  const [importing, setImporting] = useState(false);

  // QUICK GAME in the head: the one-screen path.
  const handleQuick = () => {
    setQuick(!quick);
    setImporting(false);
  };
  // IMPORT A ROOM in the head: a room document as a new room, in the place of the quick game.
  const handleImport = () => {
    setImporting(!importing);
    setQuick(false);
  };

  return (
    <main className="page">
      <PageHead title={tWs("page.rooms")} lede={tWs("lede.rooms")}>
        {lobby.canCreate && (
          <Link className="btn primary" href="/new">
            {t("newCampaign")}
          </Link>
        )}
        {lobby.canCreate && (
          <button type="button" className="btn" aria-expanded={quick} aria-controls="quick-game" onClick={handleQuick}>
            {t("quickGame")}
          </button>
        )}
        {lobby.canCreate && (
          <button
            type="button"
            className="btn"
            aria-expanded={importing}
            aria-controls="import-room"
            onClick={handleImport}
          >
            {t("importRoom")}
          </button>
        )}
      </PageHead>
      {lobby.canCreate && quick && <QuickGame rulesets={rulesets} modules={modules} />}
      {lobby.canCreate && importing && <ImportRoom />}
      <AccountBar me={me} signInFailed={signInFailed} />
      <Section title={t("yourCampaigns")} games={lobby.mine} empty={t("emptyMine")} />
      <Section title={t("wherePlay")} games={lobby.seated} empty={t("emptySeated")} />
      <YourCharacters rulesets={rulesets} />
      {lobby.archived.length > 0 && (
        <details className="stack ws-fold">
          <summary className="head">
            {t("archived")} <span className="ws-tally">{lobby.archived.length}</span>
          </summary>
          <Cards games={lobby.archived} />
        </details>
      )}
    </main>
  );
}
