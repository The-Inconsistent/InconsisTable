import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_FILTER, filterGames, gameOptions, genresOf, startMode, type GameOption } from "./games.ts";

const game = (over: Partial<GameOption>): GameOption => ({
  key: "g",
  versionId: "v",
  moduleVersionId: null,
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

test("a game module is offered after Freeform, in the place of the ruleset it plays; other rulesets stay", () => {
  const v = (id: string) => ({ id, version: id, createdAt: "", modes: ["gm" as const], game: null });
  const zed = { id: "r1", slug: "zed", title: "Zed", versions: [v("v2")] };
  const ace = { id: "r3", slug: "ace", title: "Ace", versions: [v("a1")] };
  const part = (slug: string, versionId: string) => ({ slug, versionId, version: "1.0.0" });
  const zedGame = {
    id: "m1",
    slug: "zed",
    versions: [
      {
        id: "mv2",
        version: "1.1.0",
        name: "Zed at the shore",
        createdAt: "",
        ruleset: part("zed", "v2"),
        packs: [part("zed-foes", "p1")],
        world: null,
        modes: ["gm" as const, "solo" as const],
        game: { title: "Zed", genres: ["sea"], players: { min: 1, max: 4 } },
      },
    ],
  };
  const options = gameOptions([zed, ace], [zedGame]);
  assert.deepEqual(
    options.map((g) => [g.key, g.title, g.versionId, g.moduleVersionId]),
    [
      ["freeform", "Freeform", null, null],
      ["module:zed", "Zed at the shore", "v2", "mv2"],
      ["ace", "Ace", "a1", null],
    ],
  );
  assert.deepEqual(options[1]?.modes, ["gm", "solo"]);
  assert.deepEqual(options[1]?.genres, ["sea"]);
});

test("a room starts in the mode asked for when the game allows it, else the game's first", () => {
  const g = game({ modes: ["gmless", "solo"] });
  assert.equal(startMode(g, "solo"), "solo");
  assert.equal(startMode(g, "gm"), "gmless");
  assert.equal(startMode(undefined, "solo"), "gm");
});
