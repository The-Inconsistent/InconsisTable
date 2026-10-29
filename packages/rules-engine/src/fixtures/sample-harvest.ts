import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder board game written for tests (design §4.8). Every name, number and cite is our own invention
 * ("Sample p.N" points at no real book). It has the seated order, two phases and two resources and the scoring
 * block of the same example.
 */
export const SAMPLE_HARVEST: RulesetInput = {
  id: "sample-harvest",
  version: "0.1.0",
  core: "^0.1.0",
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
};
