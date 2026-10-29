"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import type { Game } from "@inconsistable/core-schema";

import { computeStandings, STANDINGS_WINDOW } from "@/lib/standings/standings";

type StandingsProps = { games: readonly Game[] };

// The campaign's tally over its recent games, then each game (house decisions #38-#40). Wins and places are words and
// numbers; the order of the lines is never the only signal.
export function Standings({ games }: StandingsProps) {
  const t = useTranslations("standings");
  const format = useFormatter();
  const { players, coop } = useMemo(() => computeStandings(games), [games]);
  const average = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
  return (
    <section className="stack" aria-label={t("label")}>
      <h2 className="title">{t("title")}</h2>
      {games.length >= STANDINGS_WINDOW && <p className="dim">{t("window", { count: STANDINGS_WINDOW })}</p>}
      {coop && (
        <p className="game-mine" role="status">
          <span className="game-place">{t("coopWon", { won: coop.won, played: coop.played })}</span>
        </p>
      )}
      {players.length > 0 && (
        <ol className="order">
          {players.map((p) => (
            <li key={p.key} className="combatant">
              <span className="who" style={{ cursor: "default" }}>
                <span className="name">{p.name}</span>
                <span className="dim">
                  {t("line", { played: p.played, avg: format.number(p.averagePlace, average), best: p.bestScore })}
                </span>
              </span>
              <span className="game-score">{t("wins", { count: p.wins })}</span>
            </li>
          ))}
        </ol>
      )}
      <h3 className="title">{t("games")}</h3>
      <ul className="list">
        {games.map((g) => {
          const outcome = g.rows[0]?.outcome;
          const summary =
            g.mode === "coop"
              ? outcome
                ? t(outcome)
                : ""
              : [...g.rows]
                  .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
                  .map((r) => `${r.place}. ${r.name}`)
                  .join(", ");
          return (
            <li key={g.encounterId}>
              <span>
                <strong>{format.dateTime(new Date(g.endedAt), { dateStyle: "medium" })}</strong>
                <br />
                <span className="dim">{summary}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
