import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_FILTER, filterGames, gameOptions, genresOf, startMode, type GameOption } from "./games.ts";

const game = (over: Partial<GameOption>): GameOption => ({
  versionId: "v",
  slug: "g",
  title: "G",
  version: "1.0.0",
  players: { min: 2, max: 4 },
  modes: ["gm"],
  genres: [],
  ...over,
});

const titles = (gs: GameOption[]) => gs.map((g) => g.title);

test("a player count hides the games that cannot seat it, and keeps those that say nothing", () => {
  const gs = [
    game({ title: "Duo", players: { min: 2, max: 2 } }),
    game({ title: "Crowd", players: { min: 3, max: 8 } }),
    game({ title: "?", players: null }),
  ];
  assert.deepEqual(titles(filterGames(gs, { ...NO_FILTER, players: 2 })), ["Duo", "?"]);
  assert.deepEqual(titles(filterGames(gs, { ...NO_FILTER, players: 5 })), ["Crowd", "?"]);
  assert.equal(filterGames(gs, NO_FILTER).length, 3);
});

test("the way the table sits and genre chips narrow the list", () => {
  const gs = [
    game({ title: "A", modes: ["gm", "solo"], genres: ["horror"] }),
    game({ title: "B", modes: ["gm"], genres: ["fantasy", "coop"] }),
  ];
  assert.deepEqual(titles(filterGames(gs, { ...NO_FILTER, mode: "solo" })), ["A"]);
  assert.deepEqual(titles(filterGames(gs, { ...NO_FILTER, genres: ["coop", "horror"] })), ["A", "B"]);
  assert.deepEqual(titles(filterGames(gs, { ...NO_FILTER, mode: "gm", genres: ["fantasy"] })), ["B"]);
  assert.deepEqual(genresOf(gs), ["coop", "fantasy", "horror"]);
});

test("Freeform comes first, offered unimported when the library lacks it, and an old version is not offered", () => {
  const v = (id: string) => ({ id, version: id, createdAt: "", modes: ["gm" as const], game: null });
  const zed = { id: "r1", slug: "zed", title: "Zed", versions: [v("v2"), v("v1")] };
  assert.deepEqual(
    gameOptions([zed]).map((g) => [g.slug, g.versionId]),
    [
      ["freeform", null],
      ["zed", "v2"],
    ],
  );
  const mine = gameOptions([zed, { id: "r2", slug: "freeform", title: "Freeform", versions: [v("f1")] }]);
  assert.deepEqual(
    mine.map((g) => [g.slug, g.versionId]),
    [
      ["freeform", "f1"],
      ["zed", "v2"],
    ],
  );
});

test("a room starts in the mode asked for when the game allows it, else the game's first", () => {
  const g = game({ modes: ["gmless", "solo"] });
  assert.equal(startMode(g, "solo"), "solo");
  assert.equal(startMode(g, "gm"), "gmless");
  assert.equal(startMode(undefined, "solo"), "gm");
});
