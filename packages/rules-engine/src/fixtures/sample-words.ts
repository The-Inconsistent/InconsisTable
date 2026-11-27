import type { RulesetInput } from "../manifest.ts";
import type { WorldInput } from "../world.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";
import { SAMPLE_WORLD } from "./sample-world.ts";

// Words in two languages (issue #159), written for tests. Every word is our own invention; none names a game.

const VIGOUR = { en: "Vigour", vi: "Sinh lực" };

/**
 * The sample-d20 ruleset with some of its labels and terms in English and Vietnamese, English its own language. The
 * GM's Menace pool (no visibility: `gm`) is labelled in both, so a test can show a player is sent neither word. Some
 * labels stay in English only, so the Vietnamese reading falls back to them.
 */
export const SAMPLE_WORDS: RulesetInput = {
  ...SAMPLE_D20,
  id: "sample-words",
  version: "0.1.0",
  language: "en",
  terms: {
    party: { en: { one: "Crew", other: "Crews" }, vi: "Thuỷ thủ đoàn" },
    creature: { en: { one: "Shade", other: "Shades" }, vi: "Bóng ma" },
    // English only: a Vietnamese viewer reads the ruleset's own English word.
    foe: "Opposition",
    // Vietnamese only: an English viewer reads the app's own word, never the Vietnamese one.
    session: { vi: "Chuyến" },
  },
  resources: SAMPLE_D20.resources?.map((r) =>
    r.id === "hp"
      ? { ...r, label: VIGOUR }
      : r.id === "menace"
        ? { ...r, label: { en: "Menace", vi: "Hiểm hoạ" } }
        : r.id === "luck"
          ? { ...r, label: { vi: "May mắn", en: "Luck" } }
          : r,
  ),
  conditions: SAMPLE_D20.conditions?.map((c) => (c.id === "marked" ? { ...c, label: { vi: "Bị đánh dấu" } } : c)),
};

/** The same ruleset written in Vietnamese first: a label without a Vietnamese word falls back to its English one. */
export const SAMPLE_WORDS_VI: RulesetInput = { ...SAMPLE_WORDS, id: "sample-words-vi", language: "vi" };

/** The sample World with terms: plural English words, plain Vietnamese ones, and one term in English alone. */
export const SAMPLE_WORLD_WORDS: WorldInput = {
  ...SAMPLE_WORLD,
  id: "sample-tidewater-words",
  terms: {
    character: { en: { one: "Wayfarer", other: "Wayfarers" }, vi: "Lữ khách" },
    gm: { en: "Harbourmaster", vi: "Trưởng cảng" },
    fight: { en: { one: "Skirmish", other: "Skirmishes" } },
    markerRed: { en: "coral", vi: "san hô" },
  },
};
