import type { RulesetInput } from "../manifest.ts";
import { NOTICE_RESOURCES, SAMPLE_D20 } from "./sample-d20.ts";

/**
 * A placeholder Dice pool ruleset written for tests, on the sample-d20 characters. Every name, number and cite is our
 * own invention ("Sample p.N" points at no real book); it exercises the engine, it describes no published game. A d8
 * pool sized by one score, a top face worth double, one special die that flags either end, and the doubles shiftable.
 * It has no codex block, so its rooms keep entries as a title and two texts (house decision #71), and none of the
 * d20's notices.
 */
const { codex: _codex, notices: _notices, ...withoutCodex } = SAMPLE_D20;
void _codex;
void _notices;
export const SAMPLE_POOL: RulesetInput = {
  ...withoutCodex,
  id: "sample-pool",
  version: "0.1.2",
  resources: withoutCodex.resources?.filter((x) => !NOTICE_RESOURCES.includes(x.id)),
  tests: {
    skill: {
      kind: "poolSuccesses",
      pool: "attr[ctx.ability] / 3",
      modifier: "ctx.bonus",
      die: 8,
      bands: [
        { id: "top", from: 8, to: 8, worth: 2 },
        { id: "hit", from: 5, to: 7, worth: 1 },
      ],
      special: {
        label: "Omen die",
        count: 1,
        flags: { critical: { from: 8, to: 8 }, complication: { from: 1, to: 1 } },
      },
      shift: "top",
      target: "ctx.dn",
      inputs: { ability: "text", dn: "int", bonus: "int" },
      inputOptions: { ability: ["str", "dex", "con"] },
      cite: "Sample p.20",
    },
  },
};
