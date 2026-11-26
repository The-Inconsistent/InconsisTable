import type { GameModuleInput } from "../module.ts";
import type { RulesetInput } from "../manifest.ts";
import type { PackInput } from "../pack.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";
import { SAMPLE_PACK } from "./sample-pack.ts";
import { SAMPLE_SKIRMISH } from "./sample-skirmish.ts";
import { SAMPLE_SKIRMISH_PACK } from "./sample-skirmish-pack.ts";
import { SAMPLE_WORLD } from "./sample-world.ts";

/**
 * Two invented game modules (house decisions #122 to #125), built from the sample ruleset, packs and World: every name
 * and page is made up and points at no real book. The first is a whole game in one file (a ruleset, a `private` pack
 * and a World); the second a different shape, two packs and no World.
 */
export const SAMPLE_MODULE: GameModuleInput = {
  id: "sample-d20-game",
  version: "0.1.0",
  core: "^1.0.0",
  name: "Sample d20 at Tidewater",
  ruleset: { slug: SAMPLE_D20.id, version: SAMPLE_D20.version },
  packs: [{ slug: SAMPLE_PACK.id, version: SAMPLE_PACK.version }],
  world: { slug: SAMPLE_WORLD.id, version: SAMPLE_WORLD.version },
  documents: { ruleset: SAMPLE_D20, packs: [SAMPLE_PACK], world: SAMPLE_WORLD },
};

/** A second pack for the skirmish sample, so a module can name two: one foe of the first, under its own keys. */
export const SAMPLE_SKIRMISH_RESERVE: PackInput = {
  ...SAMPLE_SKIRMISH_PACK,
  id: "sample-raiders-reserve",
  license: "original",
  entries: SAMPLE_SKIRMISH_PACK.entries.slice(0, 1).map((e) => ({ ...e, key: `reserve-${e.key}` })),
};

export const SAMPLE_SKIRMISH_MODULE: GameModuleInput = {
  id: "sample-skirmish-game",
  version: "0.1.0",
  core: "^1.0.0",
  name: "Sample skirmish",
  ruleset: { slug: SAMPLE_SKIRMISH.id, version: SAMPLE_SKIRMISH.version },
  packs: [
    { slug: SAMPLE_SKIRMISH_PACK.id, version: SAMPLE_SKIRMISH_PACK.version },
    { slug: SAMPLE_SKIRMISH_RESERVE.id, version: SAMPLE_SKIRMISH_RESERVE.version },
  ],
  documents: { ruleset: SAMPLE_SKIRMISH, packs: [SAMPLE_SKIRMISH_PACK, SAMPLE_SKIRMISH_RESERVE] },
};

/** The skirmish sample as a game played only without a GM, so a module's room must be made in that mode. */
export const SAMPLE_SKIRMISH_GMLESS: RulesetInput = {
  ...SAMPLE_SKIRMISH,
  id: "sample-skirmish-gmless",
  game: { title: "Sample skirmish, no GM", players: { min: 2, max: 4 }, modes: ["gmless"], cite: "Sample p.1" },
};

/** Its foes, still a `private` pack, which the owner attaches as the one running a room without a GM. */
export const SAMPLE_GMLESS_RAIDERS: PackInput = {
  ...SAMPLE_SKIRMISH_PACK,
  id: "sample-raiders-gmless",
  ruleset: { id: SAMPLE_SKIRMISH_GMLESS.id, range: SAMPLE_SKIRMISH_PACK.ruleset.range },
};

export const SAMPLE_GMLESS_MODULE: GameModuleInput = {
  id: "sample-gmless-game",
  version: "0.1.0",
  core: "^1.0.0",
  name: "Sample skirmish without a GM",
  ruleset: { slug: SAMPLE_SKIRMISH_GMLESS.id, version: SAMPLE_SKIRMISH_GMLESS.version },
  packs: [{ slug: SAMPLE_GMLESS_RAIDERS.id, version: SAMPLE_GMLESS_RAIDERS.version }],
  world: { slug: SAMPLE_WORLD.id, version: SAMPLE_WORLD.version },
  documents: { ruleset: SAMPLE_SKIRMISH_GMLESS, packs: [SAMPLE_GMLESS_RAIDERS], world: SAMPLE_WORLD },
};

/** A module as a list only: the same parts as the first, named and not carried. */
const { documents: _carried, ...naming } = SAMPLE_MODULE;
export const SAMPLE_NAMING_MODULE: GameModuleInput = naming;
