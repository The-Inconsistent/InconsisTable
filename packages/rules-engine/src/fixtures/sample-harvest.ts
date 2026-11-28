import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder board game written for tests (design §4.8). Every name, number and cite is our own invention
 * ("Sample p.N" points at no real book). It has the seated order, two phases and two resources and the scoring
 * block of the same example.
 */
export const SAMPLE_HARVEST: RulesetInput = {
  id: "sample-harvest",
  version: "0.1.3",
  core: "^0.1.0",
  // House decision #107: a round of the game is a scene; it is ready once its setup is written. No read-aloud field.
  codex: {
    kinds: {
      scene: {
        fields: {
          setup: { type: "text", label: "Setup", maxLength: 300, visibility: "party", cite: "Sample p.7" },
        },
        ready: ["setup"],
      },
    },
  },
  sources: [{ id: "sample", title: "Sample Harvest Rules", license: "homebrew", pageOffset: 0 }],
  entities: [
    {
      id: "player",
      label: "Player",
      base: "actor",
      fields: { name: { type: "text", label: "Name", visibility: "public", editableBy: "owner" } },
    },
  ],
  resources: [
    {
      id: "coin",
      label: "Coin",
      cite: "Sample p.6",
      scope: "entity",
      min: "0",
      visibility: "owner",
      editableBy: "owner",
    },
    { id: "vp", label: "Victory points", cite: "Sample p.6", scope: "entity", min: "0", visibility: "public" },
  ],
  initiative: { strategy: "seated", firstPlayer: "rotate", cite: "Sample p.3" },
  phases: [
    { id: "plan", label: "Plan", mode: "simultaneous", cite: "Sample p.4" },
    { id: "act", label: "Act", mode: "turns", cite: "Sample p.5" },
  ],
  scoring: {
    score: "res.vp + res.coin / 3",
    tiebreaks: [{ expr: "res.coin", order: "high" }],
    endWhen: [{ when: "round > 4", cite: "Sample p.8" }],
    cite: "Sample p.8",
  },
  // Random tables (house decision #49): one rolled on a die for the whole table, one weighted and kept from the
  // players, and a deck of secret roles dealt without replacement (six cards), which says it is a deck (house decision
  // #224) although an `owner` table is dealt anyway.
  tables: {
    season: {
      title: "Season",
      die: "d6",
      visibility: "party",
      entries: [
        { id: "thaw", label: "Thaw", range: [1, 2] },
        { id: "bloom", label: "Bloom", range: [3, 4] },
        { id: "frost", label: "Frost", range: [5, 6] },
      ],
    },
    omen: {
      title: "Omen",
      visibility: "gm",
      entries: [
        { id: "calm", label: "Calm", weight: 3 },
        { id: "storm", label: "Storm", weight: 1 },
      ],
    },
    role: {
      title: "Role",
      visibility: "owner",
      deck: true,
      entries: [
        { id: "farmer", label: "Farmer", count: 3 },
        { id: "miller", label: "Miller", count: 2 },
        { id: "thief", label: "Thief" },
      ],
    },
  },
};
