import assert from "node:assert/strict";
import { test } from "node:test";

import type { Game } from "@inconsistable/core-schema";

import { computeStandings } from "./standings.ts";

type R = [actorId: string | null, name: string, score: number, place: number];
const compete = (id: string, rows: R[]): Game => ({
  encounterId: id,
  endedAt: "2026-01-01T00:00:00Z",
  endedEarly: false,
  mode: "compete",
  rows: rows.map(([actorId, name, score, place], i) => ({
    resultId: `${id}-${i}`,
    actorId,
    name,
    score,
    tiebreaks: [],
    place,
    outcome: null,
  })),
});
const coop = (id: string, outcome: "win" | "lose"): Game => ({
  encounterId: id,
  endedAt: "2026-01-01T00:00:00Z",
  endedEarly: false,
  mode: "coop",
  rows: [{ resultId: id, actorId: "a", name: "A", score: 0, tiebreaks: [], place: null, outcome }],
});

test("standings tally wins, shared firsts, deleted actors, coop and sort order", () => {
  // Newest first. Game 1 has a shared first place; Cy's actor is gone in both, so Cy merges by name.
  const games = [
    compete("g1", [
      ["a", "Ann", 10, 1],
      ["b", "Bo", 10, 1],
      [null, "Cy", 4, 3],
    ]),
    coop("c1", "win"),
    compete("g2", [
      ["b", "Bo", 9, 1],
      ["a", "Ann", 7, 2],
      [null, "Cy", 2, 3],
    ]),
    coop("c2", "lose"),
  ];
  const s = computeStandings(games);
  assert.deepEqual(s.coop, { played: 2, won: 1 });
  assert.deepEqual(
    s.players.map((p) => [p.name, p.played, p.wins, p.averagePlace, p.bestScore]),
    [
      ["Bo", 2, 2, 1, 10],
      ["Ann", 2, 1, 1.5, 10],
      ["Cy", 2, 0, 3, 4],
    ],
  );
  assert.equal(computeStandings([]).coop, null);
});
