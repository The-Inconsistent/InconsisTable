import type { Game } from "@inconsistable/core-schema";

export type StandingsLine = {
  key: string;
  name: string;
  played: number;
  wins: number;
  /** Mean place over the games played, unrounded. */
  averagePlace: number;
  bestScore: number;
};
export type Standings = { players: StandingsLine[]; coop: { played: number; won: number } | null };

// ponytail: only the snapshot's 20 most recent games count, the api pages them when a campaign passes 20.
export const STANDINGS_WINDOW = 20;

// The campaign's tally over its recent games (newest first). A player is keyed by actor, or by name once the actor is
// gone; a shared first place is a win; a cooperative game is counted for the whole table, apart.
export function computeStandings(games: readonly Game[]): Standings {
  const acc = new Map<string, { name: string; played: number; wins: number; placeSum: number; best: number }>();
  let coop: Standings["coop"] = null;
  for (const game of games) {
    if (game.mode === "coop") {
      coop ??= { played: 0, won: 0 };
      coop.played += 1;
      if (game.rows[0]?.outcome === "win") coop.won += 1;
      continue;
    }
    for (const row of game.rows) {
      if (row.place === null) continue;
      const key = row.actorId ?? `name:${row.name}`;
      // The first game seen is the newest, so it sets the name shown.
      const line = acc.get(key) ?? { name: row.name, played: 0, wins: 0, placeSum: 0, best: row.score };
      line.played += 1;
      if (row.place === 1) line.wins += 1;
      line.placeSum += row.place;
      line.best = Math.max(line.best, row.score);
      acc.set(key, line);
    }
  }
  const players = [...acc.entries()]
    .map(([key, l]) => ({
      key,
      name: l.name,
      played: l.played,
      wins: l.wins,
      averagePlace: l.placeSum / l.played,
      bestScore: l.best,
    }))
    .sort((a, b) => b.wins - a.wins || a.averagePlace - b.averagePlace || a.name.localeCompare(b.name));
  return { players, coop };
}
