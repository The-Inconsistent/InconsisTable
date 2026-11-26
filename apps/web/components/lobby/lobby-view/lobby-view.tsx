"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";

import type { Lobby, LobbyGame, TableMode } from "@inconsistable/core-schema";

import { AccountBar } from "@/components/lobby/account-bar/account-bar";
import { GamePicker } from "@/components/lobby/game-picker/game-picker";
import { ImportRoom } from "@/components/lobby/import-room/import-room";
import { QuickGame } from "@/components/lobby/quick-game/quick-game";
import { YourCharacters } from "@/components/lobby/your-characters/your-characters";
import { PageHead } from "@/components/ui/page-head/page-head";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import type { AuthMe } from "@/lib/api-reply/api-reply";
import { createRoom } from "@/lib/games/create-room";
import { gameOptions, startMode, type GameOption } from "@/lib/games/games";
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

// ROOMS: the ones you own, the ones where you play or co-GM, and the archived ones; plus NEW ROOM for creators, open
// at once when there is nothing else to show, and the account bar on deployments that sign in.
export function LobbyView({ lobby, rulesets, modules, me, signInFailed }: LobbyViewProps) {
  const t = useTranslations("lobby");
  const tWs = useTranslations("workspace");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const router = useRouter();
  const [creating, setCreating] = useState(!lobby.mine.length && !lobby.seated.length);
  const [toggled, setToggled] = useState(false);
  const [name, setName] = useState("");
  const [quick, setQuick] = useState(false);
  const [importing, setImporting] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [picked, setPicked] = useState<TableMode>("gm");
  const [error, setError] = useState<string | null>(null);
  // How the table can sit is the chosen game's say; a ruleset without a `game` block is played with a GM.
  const games = gameOptions(rulesets, modules);
  const game = games.find((g) => g.key === slug) ?? null;
  const modes = game?.modes ?? ["gm"];
  const tableMode = startMode(game ?? undefined, picked);
  const tModes = useTranslations("tableModes");
  const [busy, setBusy] = useState(false);

  // NEW ROOM in the head: shows or folds the form, and moves the cursor into it when it opens.
  const handleToggle = () => {
    setCreating(!creating);
    setQuick(false);
    setImporting(false);
    setToggled(true);
  };
  // QUICK GAME in the head: the one-screen path, in the place of the form.
  const handleQuick = () => {
    setQuick(!quick);
    setCreating(false);
    setImporting(false);
  };
  // IMPORT A ROOM in the head: a room document as a new room, in the place of the forms.
  const handleImport = () => {
    setImporting(!importing);
    setCreating(false);
    setQuick(false);
  };
  // A card tapped: it is the ruleset, and the way of sitting the filter asked for is kept when the game allows it.
  const handleSelect = (g: GameOption | null, wanted: "any" | TableMode) => {
    setSlug(g?.key ?? null);
    if (wanted !== "any") setPicked(wanted);
  };

  // NEW ROOM: the api creates it with the caller as owner and GM, then we open it.
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createRoom({ name, game, mode: tableMode });
      if (r.ok) return router.push(`/c/${r.campaignId}?tab=party`);
      if (r.reason === "invalid") setError(t("nameRequired"));
      else if (r.reason === "refused" && r.refusal) setError(tr(r.refusal));
      else setError(t("createFailed"));
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <PageHead title={tWs("page.rooms")} lede={tWs("lede.rooms")}>
        {lobby.canCreate && (
          <button
            type="button"
            className="btn primary"
            aria-expanded={creating}
            aria-controls="new-room"
            onClick={handleToggle}
          >
            {t("newCampaign")}
          </button>
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
      {lobby.canCreate && creating && (
        <form id="new-room" className="card" onSubmit={handleCreate}>
          <h2 className="head">{t("newCampaign")}</h2>
          <div className="row">
            <label style={{ flex: 1 }}>
              {t("name")}
              <input
                id="new-room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus={toggled}
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy} aria-busy={busy} style={{ alignSelf: "end" }}>
              {busy ? t("creating") : t("create")}
            </button>
          </div>
          <GamePicker games={games} selected={slug} onSelect={handleSelect} />
          {modes.length > 1 && (
            <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="head">{t("sits")}</legend>
              <div className="row">
                {modes.map((m) => (
                  <label key={m} className="row">
                    <input type="radio" name="table-mode" checked={tableMode === m} onChange={() => setPicked(m)} />
                    {tModes(m)}
                  </label>
                ))}
              </div>
              {tableMode !== "gm" && <p className="small dim">{t("sitsHint")}</p>}
            </fieldset>
          )}
          {rulesets.length === 0 && (
            <p className="small dim">
              {t.rich("importHint", { link: (chunks) => <Link href="/library">{chunks}</Link> })}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </form>
      )}
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
