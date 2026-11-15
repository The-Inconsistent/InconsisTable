import type { TableMode } from "@inconsistable/core-schema";

import { FREEFORM, FREEFORM_SLUG } from "../freeform/freeform";
import type { RulesetList } from "../library/library";

/** One game the user can sit down to: a ruleset's newest version, or Freeform before it is imported. */
export interface GameOption {
  /** The ruleset version, or null for Freeform not yet in the user's library (imported when it is used). */
  versionId: string | null;
  slug: string;
  title: string;
  version: string;
  /** Null: the ruleset says nothing about its players, so no count rules it out. */
  players: { min: number; max: number } | null;
  modes: readonly TableMode[];
  genres: readonly string[];
}

export interface GameFilter {
  /** Players at the table; 0 is any. */
  players: number;
  mode: "any" | TableMode;
  genres: readonly string[];
}

export const NO_FILTER: GameFilter = { players: 0, mode: "any", genres: [] };

const FREEFORM_OPTION: GameOption = {
  versionId: null,
  slug: FREEFORM_SLUG,
  title: FREEFORM.game?.title ?? "Freeform",
  version: FREEFORM.version,
  players: FREEFORM.game?.players ?? null,
  modes: FREEFORM.game?.modes ?? ["gm"],
  genres: [],
};

// ponytail: only a ruleset's newest version is offered; older ones stay reachable by pinning in a room's Rules tab,
// list versions per card when a table needs to start on an old one.
/** The user's games, newest version of each ruleset, Freeform first (offered unimported when they have none). */
export function gameOptions(rulesets: RulesetList): GameOption[] {
  const own = rulesets.flatMap((r): GameOption[] => {
    const v = r.versions[0];
    if (!v) return [];
    return [
      {
        versionId: v.id,
        slug: r.slug,
        title: v.game?.title ?? r.title,
        version: v.version,
        players: v.game?.players ?? null,
        modes: v.modes,
        genres: v.game?.genres ?? [],
      },
    ];
  });
  const free = own.find((g) => g.slug === FREEFORM_SLUG) ?? FREEFORM_OPTION;
  return [free, ...own.filter((g) => g !== free)];
}

/** The games that suit the table: seating a player count, a way of sitting, and any of the genres chosen. */
export function filterGames(games: readonly GameOption[], f: GameFilter): GameOption[] {
  return games.filter(
    (g) =>
      (f.players === 0 || !g.players || (f.players >= g.players.min && f.players <= g.players.max)) &&
      (f.mode === "any" || g.modes.includes(f.mode)) &&
      (f.genres.length === 0 || f.genres.some((genre) => g.genres.includes(genre))),
  );
}

/** Every genre any game lists, sorted, for the filter chips. */
export const genresOf = (games: readonly GameOption[]): string[] =>
  [...new Set(games.flatMap((g) => g.genres))].sort((a, b) => a.localeCompare(b));

/** The mode a room starts in: the one asked for if the game allows it, else the game's first. */
export const startMode = (game: GameOption | undefined, wanted: TableMode): TableMode =>
  game ? (game.modes.includes(wanted) ? wanted : (game.modes[0] ?? "gm")) : "gm";
