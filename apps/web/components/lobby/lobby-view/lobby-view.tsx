"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { UserButton } from "@inconsistable/auth/react";
import { CreateGame, type Lobby, type LobbyGame } from "@inconsistable/core-schema";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ApiMessage, CampaignRef, readJson } from "@/lib/api-reply/api-reply";
import type { RulesetList } from "@/lib/library/library";

type LobbyViewProps = { lobby: Lobby; rulesets: RulesetList };

const NO_RULESET = "";

function GameCard({ game }: { game: LobbyGame }) {
  const t = useTranslations("lobby");
  const tRoles = useTranslations("roles");
  return (
    <a className="card" href={`/c/${game.id}`} style={{ textDecoration: "none" }}>
      <strong>{game.name}</strong>
      <span className="row small dim">
        <span>{game.isOwner ? t("yourCampaign") : t("owner", { name: game.owner })}</span>
        {game.role && <span className="chip">{tRoles(game.role)}</span>}
        <span>{t("characters", { count: game.players })}</span>
        {game.session !== null && <span className="chip">{t("sessionRunning", { number: game.session })}</span>}
      </span>
    </a>
  );
}

function Section({ title, games, empty }: { title: string; games: LobbyGame[]; empty: string }) {
  return (
    <section className="stack">
      <h2 className="head">{title}</h2>
      {games.length ? (
        <div className="grid">
          {games.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
      ) : (
        <p className="dim">{empty}</p>
      )}
    </section>
  );
}

// The signed-in home: rooms you own, rooms where you play or co-GM, and the archived ones; plus NEW ROOM for creators.
export function LobbyView({ lobby, rulesets }: LobbyViewProps) {
  const t = useTranslations("lobby");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [rulesetVersionId, setRulesetVersionId] = useState(NO_RULESET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setError(refusal.success ? refusal.data.message : t("createFailed"));
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(false);
  };

  return (
    <>
      <header className="band">
        <strong>{tCommon("brand")}</strong>
        <span className="row">
          <a href="/library">{t("libraryLink")}</a>
          {lobby.admin && <a href="/admin">{t("admin")}</a>}
          <LocaleSwitch />
          <UserButton />
        </span>
      </header>
      <main className="page">
        {lobby.canCreate && (
          <form className="card" onSubmit={handleCreate}>
            <h2 className="head">{t("newCampaign")}</h2>
            <div className="row">
              <label style={{ flex: 1 }}>
                {t("name")}
                <input id="new-room-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
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
              <button className="btn primary" type="submit" disabled={busy} style={{ alignSelf: "end" }}>
                {t("create")}
              </button>
            </div>
            {rulesets.length === 0 && (
              <p className="small dim">{t.rich("importHint", { link: (chunks) => <a href="/library">{chunks}</a> })}</p>
            )}
            {error && <p className="error">{error}</p>}
          </form>
        )}
        <Section title={t("yourCampaigns")} games={lobby.mine} empty={t("emptyMine")} />
        <Section title={t("wherePlay")} games={lobby.seated} empty={t("emptySeated")} />
        {lobby.archived.length > 0 && <Section title={t("archived")} games={lobby.archived} empty="" />}
      </main>
    </>
  );
}
