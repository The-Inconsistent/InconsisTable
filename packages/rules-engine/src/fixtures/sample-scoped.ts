import type { RulesetInput } from "../manifest.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";

/**
 * A placeholder ruleset written for tests: the sample-d20 actors with a Test and a health state that only characters
 * have (house decision #50). Both read values a creature lacks, so they compile only because they name their actor
 * type. Every name, number and cite is our own invention.
 */
export const SAMPLE_SCOPED: RulesetInput = {
  ...SAMPLE_D20,
  id: "sample-scoped",
  version: "0.1.0",
  tests: {
    ...SAMPLE_D20.tests,
    brace: {
      kind: "sumVsTarget",
      dice: "1d20",
      modifier: "derived.initBonus",
      target: "ctx.dc",
      inputs: { dc: "int" },
      entities: ["character"],
      cite: "Sample p.12",
    },
  },
  resources: [
    ...(SAMPLE_D20.resources ?? []),
    {
      id: "strain",
      label: "Strain",
      cite: "Sample p.13",
      scope: "entity",
      max: "derived.maxHp",
      capped: false,
      start: "min",
      visibility: "party",
    },
  ],
  health: {
    ...SAMPLE_D20.health,
    states: [
      ...(SAMPLE_D20.health?.states ?? []),
      { id: "guarded", label: "Guarded", when: "derived.defense > 12", entities: ["character"] },
    ],
  },
};
