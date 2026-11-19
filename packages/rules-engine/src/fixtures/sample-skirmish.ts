import type { RulesetInput } from "../manifest.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";

/**
 * A placeholder ruleset written for tests: sample-d20 with a turn order of two sides that alternate, a setup, paid
 * out-of-turn action, holding and a first-round bar. Every name, number and cite is our own invention.
 */
export const SAMPLE_SKIRMISH: RulesetInput = {
  ...SAMPLE_D20,
  id: "sample-skirmish",
  version: "0.1.0",
  resources: [
    ...(SAMPLE_D20.resources ?? []),
    { id: "momentum", label: "Momentum", cite: "Sample p.15", scope: "party", max: "6", visibility: "party" },
    { id: "pressure", label: "Pressure", cite: "Sample p.15", scope: "gm", max: "6" },
  ],
  initiative: {
    strategy: "sides",
    sides: [
      { id: "wardens", label: "Wardens" },
      { id: "raiders", label: "Raiders" },
    ],
    firstSide: "rotate",
    roundEnd: "manual",
    setup: { cite: "Sample p.16" },
    outOfTurn: {
      cost: { wardens: { pool: "momentum", amount: 1 }, raiders: { pool: "pressure", amount: 1 } },
      cite: "Sample p.17",
    },
    hold: { cite: "Sample p.17" },
    barred: {
      throughRound: 1,
      liftCost: { wardens: { pool: "momentum", amount: 2 }, raiders: { pool: "pressure", amount: 2 } },
      cite: "Sample p.18",
    },
    cite: "Sample p.16",
  },
};
