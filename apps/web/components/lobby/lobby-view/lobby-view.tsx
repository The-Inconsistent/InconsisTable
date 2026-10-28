"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { CreateGame, type Lobby, type LobbyGame } from "@inconsistable/core-schema";

import { AccountBar } from "@/components/lobby/account-bar/account-bar";
import { PageHead } from "@/components/ui/page-head/page-head";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, CampaignRef, readJson, type AuthMe } from "@/lib/api-reply/api-reply";
import type { RulesetList } from "@/lib/library/library";

type LobbyViewProps = { lobby: Lobby; rulesets: RulesetList; me: AuthMe; signInFailed: boolean };

const NO_RULESET = "";

function GameCard({ game }: { game: LobbyGame }) {
  const t = useTranslations("lobby");
  const tRoles = useTranslations("roles");
  const format = useFormatter();
  return (
    <a className="card ws-tile" href={`/c/${game.id}`}>
      <strong className="card-name">{game.name}</strong>
      <span className="small dim">{game.isOwner ? t("yourCampaign") : t("owner", { name: game.owner })}</span>
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
    <div className="grid">
      {games.map((g) => (
        <GameCard key={g.id} game={g} />
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
export function LobbyView({ lobby, rulesets, me, signInFailed }: LobbyViewProps) {
  const t = useTranslations("lobby");
  const tWs = useTranslations("workspace");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const router = useRouter();
  const [creating, setCreating] = useState(!lobby.mine.length && !lobby.seated.length);
  const [toggled, setToggled] = useState(false);
  const [name, setName] = useState("");
  const [rulesetVersionId, setRulesetVersionId] = useState(NO_RULESET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // NEW ROOM in the head: shows or folds the form, and moves the cursor into it when it opens.
  const handleToggle = () => {
    setCreating(!creating);
    setToggled(true);
  };

  // NEW ROOM: the api creates it with the caller as owner and GM, then we open it.
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreateGame.safeParse({
      name,
      rulesetVersionId: rulesetVersionId === NO_RULESET ? undefined : rulesetVersionId,
    });
    if (!parsed.success) return setError(t("nameRequired"));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await readJson(res);
      const room = CampaignRef.safeParse(body);
      if (res.ok && room.success) return router.push(`/c/${room.data.campaignId}?tab=party`);
      const refusal = ApiMessage.safeParse(body);
      setError(refusal.success ? tr(refusal.data) : t("createFailed"));
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
      </PageHead>
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
            <label>
              {t("ruleset")}
              <select value={rulesetVersionId} onChange={(e) => setRulesetVersionId(e.target.value)}>
                <option value={NO_RULESET}>{t("noneYet")}</option>
                {rulesets.map((r) => (
                  <optgroup key={r.id} label={r.slug}>
                    {r.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {r.slug} {v.version}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={busy} aria-busy={busy} style={{ alignSelf: "end" }}>
              {busy ? t("creating") : t("create")}
            </button>
          </div>
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
