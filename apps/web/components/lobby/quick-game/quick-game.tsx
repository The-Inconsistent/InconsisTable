"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { TableMode } from "@inconsistable/core-schema";

import { GamePicker } from "@/components/lobby/game-picker/game-picker";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { createRoom } from "@/lib/games/create-room";
import { gameOptions, startMode, type GameOption } from "@/lib/games/games";
import type { ModuleList, RulesetList } from "@/lib/library/library";

type QuickGameProps = { rulesets: RulesetList; modules: ModuleList };

// QUICK GAME: pick a game, check the name, create. The room opens on PARTY with the join QR already showing, so the
// table is playing in a couple of minutes. Nothing else is asked (docs/p2-plan.md group E).
export function QuickGame({ rulesets, modules }: QuickGameProps) {
  const t = useTranslations("quickGame");
  const tModes = useTranslations("tableModes");
  const tr = useRefusal();
  const format = useFormatter();
  const router = useRouter();
  const games = gameOptions(rulesets, modules);
  const [slug, setSlug] = useState(games[0]?.key ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  const [picked, setPicked] = useState<TableMode>("gm");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const game = games.find((g) => g.key === slug);
  const mode = startMode(game, picked);
  const weekday = format.dateTime(new Date(), { weekday: "long" });
  const name = typed ?? (game ? `${game.title} · ${weekday}` : "");

  // A card tapped: the game changes (the same card again keeps it, since a quick game needs one), and so does the way of
  // sitting when the filter asked for one.
  const handleSelect = (g: GameOption | null, wanted: "any" | TableMode) => {
    if (!g) return;
    setSlug(g.key);
    if (wanted !== "any") setPicked(wanted);
  };
  // The mode menu offers only the game's own modes, but a value is still parsed.
  const handleMode = (e: ChangeEvent<HTMLSelectElement>) => {
    const m = TableMode.safeParse(e.target.value);
    if (m.success) setPicked(m.data);
  };
  // QUICK GAME create: makes the room, then opens PARTY with the invite QR up.
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!game) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createRoom({ name: name.trim(), game, mode });
      if (r.ok) return router.push(`/c/${r.campaignId}?tab=party&quick=1`);
      if (r.reason === "invalid") setError(t("nameRequired"));
      else if (r.reason === "refused" && r.refusal) setError(tr(r.refusal));
      else setError(t("failed"));
    } catch {
      setError(t("failed"));
    }
    setBusy(false);
  };

  return (
    <form id="quick-game" className="card" onSubmit={handleCreate}>
      <h2 className="head">{t("title")}</h2>
      <GamePicker games={games} selected={slug} onSelect={handleSelect} />
      <div className="row">
        <label style={{ flex: 1 }}>
          {t("name")}
          <input value={name} onChange={(e) => setTyped(e.target.value)} maxLength={100} />
        </label>
        {(game?.modes.length ?? 0) > 1 && (
          <label>
            {t("sits")}
            <select value={mode} onChange={handleMode}>
              {game?.modes.map((m) => (
                <option key={m} value={m}>
                  {tModes(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn primary" type="submit" disabled={busy} aria-busy={busy} style={{ alignSelf: "end" }}>
          {busy ? t("creating") : t("create")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
