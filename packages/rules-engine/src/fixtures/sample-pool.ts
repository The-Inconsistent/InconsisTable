import type { RulesetInput } from "../manifest.ts";
import { NOTICE_RESOURCES, SAMPLE_D20_BEFORE_WIDGETS } from "./sample-d20.ts";

/**
 * A placeholder Dice pool ruleset written for tests, on the sample-d20 characters. Every name, number and cite is our
 * own invention ("Sample p.N" points at no real book); it exercises the engine, it describes no published game. A d8
 * pool sized by one score, a top face worth double, one special die that flags either end, and the doubles shiftable.
 * It has no codex block, so its rooms keep entries as a title and two texts (house decision #71), and none of the
 * d20's notices.
 */
const { codex: _codex, notices: _notices, ...withoutCodex } = SAMPLE_D20_BEFORE_WIDGETS;
void _codex;
void _notices;
/** SAMPLE_POOL as it was at 0.1.3, before the choice its taker makes while reporting (house decision #170). */
export const SAMPLE_POOL_0_1_3: RulesetInput = {
  ...withoutCodex,
  id: "sample-pool",
  version: "0.1.3",
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
      // House decision #80: the GM may call it under Dread; a failure then feeds the Menace pool, and any failure
      // strains the taker by what the score fell short, twice that when the Omen die showed its lowest face.
      marks: { dread: { label: "Dread", cite: "Sample p.21" } },
      offers: [
        {
          id: "shaken",
          label: "Shaken",
          when: "!result.passed && ctx.dread",
          changes: [{ pool: "menace", by: "1" }],
          cite: "Sample p.21",
        },
        {
          id: "strain",
          label: "Strain",
          when: "!result.passed",
          changes: [
            { resource: "tempHp", by: "max(0, result.target - result.total) * (result.flags.complication ? 2 : 1)" },
            { pool: "luck", by: "1" },
          ],
          cite: "Sample p.21",
        },
      ],
    },
  },
};

const skill = SAMPLE_POOL_0_1_3.tests?.skill;
if (skill?.kind !== "poolSuccesses") throw new Error("sample-pool 0.1.3 has its skill Test");

/**
 * sample-pool 0.1.4 (house decision #170): the taker may spend a Luck point while reporting to steady the roll, one off
 * the number to beat but never below 1; the GM side is then offered to take the point from the Luck pool.
 */
export const SAMPLE_POOL: RulesetInput = {
  ...SAMPLE_POOL_0_1_3,
  version: "0.1.4",
  tests: {
    skill: {
      ...skill,
      target: "max(1, ctx.dn - ctx.steady)",
      choices: { steady: { label: "Luck spent", max: 1, cite: "Sample p.22" } },
      offers: [
        ...(skill.offers ?? []),
        {
          id: "steadied",
          label: "Luck spent",
          when: "ctx.steady > 0",
          changes: [{ pool: "luck", by: "-ctx.steady" }],
          cite: "Sample p.22",
        },
      ],
    },
  },
};
