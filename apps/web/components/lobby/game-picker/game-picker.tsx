"use client";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";

import { TableMode } from "@inconsistable/core-schema";

import { NO_FILTER, filterGames, genresOf, type GameFilter, type GameOption } from "@/lib/games/games";

import { MAX_PLAYERS } from "./constants";

type GamePickerProps = {
  games: readonly GameOption[];
  /** The slug of the chosen game, or null. */
  selected: string | null;
  /** A card tapped (the same card again clears the choice) with the way of sitting the filter asks for. */
  onSelect: (game: GameOption | null, wanted: "any" | TableMode) => void;
};

// CHOOSE GAME: the user's games as cards, narrowed by how many sit down, how the table sits and the genre. Selecting a
// card is the ruleset choice; the room form below then offers only the modes that game is played in.
export function GamePicker({ games, selected, onSelect }: GamePickerProps) {
  const t = useTranslations("chooseGame");
  const tModes = useTranslations("tableModes");
  const [filter, setFilter] = useState<GameFilter>(NO_FILTER);
  const genres = genresOf(games);
  const shown = filterGames(games, filter);

  // Players stepper: 0 is any; each step is one player, up to the most any table seats.
  const handleStep = (by: number) =>
    setFilter((f) => ({ ...f, players: Math.min(MAX_PLAYERS, Math.max(0, f.players + by)) }));
  // Mode filter: pressing the lit one again lifts it.
  const handleMode = (mode: GameFilter["mode"]) => setFilter((f) => ({ ...f, mode: f.mode === mode ? "any" : mode }));
  // Genre chip: any of the chosen genres matches.
  const handleGenre = (genre: string) =>
    setFilter((f) => ({
      ...f,
      genres: f.genres.includes(genre) ? f.genres.filter((g) => g !== genre) : [...f.genres, genre],
    }));
  const handlePick = (game: GameOption) => onSelect(selected === game.slug ? null : game, filter.mode);

  return (
    <fieldset className="stack game-picker">
      <legend className="head">{t("title")}</legend>
      <div className="row game-filters">
        <div className="stepper" role="group" aria-label={t("playersLabel")}>
          <button type="button" className="btn sm" aria-label={t("fewer")} onClick={() => handleStep(-1)}>
            −
          </button>
          <output aria-live="polite">
            {filter.players === 0 ? t("anyPlayers") : t("players", { count: filter.players })}
          </output>
          <button type="button" className="btn sm" aria-label={t("more")} onClick={() => handleStep(1)}>
            +
          </button>
        </div>
        <div className="row" role="group" aria-label={t("sits")}>
          {TableMode.options.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              aria-pressed={filter.mode === m}
              onClick={() => handleMode(m)}
            >
              {tModes(m)}
            </button>
          ))}
        </div>
      </div>
      {genres.length > 0 && (
        <div className="row" role="group" aria-label={t("genres")}>
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              className="chip"
              aria-pressed={filter.genres.includes(g)}
              onClick={() => handleGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="dim">{t("none")}</p>
      ) : (
        <div className="grid rise-list">
          {shown.map((g, i) => (
            <button
              key={g.slug}
              type="button"
              className="card ws-tile game-card"
              aria-pressed={selected === g.slug}
              style={{ "--i": i } as CSSProperties}
              onClick={() => handlePick(g)}
            >
              <strong className="card-name">{g.title}</strong>
              <span className="small">
                {g.players
                  ? g.players.min === g.players.max
                    ? t("playersExact", { count: g.players.min })
                    : t("playersRange", { min: g.players.min, max: g.players.max })
                  : t("playersUnknown")}
              </span>
              <span className="row small">
                {g.modes.map((m) => (
                  <span key={m} className="chip">
                    {tModes(m)}
                  </span>
                ))}
                {g.genres.map((genre) => (
                  <span key={genre} className="chip">
                    {genre}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
