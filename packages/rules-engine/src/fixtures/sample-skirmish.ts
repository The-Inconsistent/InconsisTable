import type { RulesetInput } from "../manifest.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";

/**
 * A placeholder ruleset written for tests: sample-d20 with a turn order of two sides that alternate, a setup with a
 * note, paid out-of-turn action, holding and a first-round bar; reminder lines at a turn's start and end and at the
 * round's end, a condition with its own line, one armed from its holder's next turn that a big enough foe is immune to,
 * and a long rest refused while downed (house decision #81). Every name, number and cite is our own invention.
 */
export const SAMPLE_SKIRMISH: RulesetInput = {
  ...SAMPLE_D20,
  id: "sample-skirmish",
  version: "0.1.1",
  resources: [
    ...(SAMPLE_D20.resources ?? []),
    { id: "momentum", label: "Momentum", cite: "Sample p.15", scope: "party", max: "6", visibility: "party" },
    { id: "pressure", label: "Pressure", cite: "Sample p.15", scope: "gm", max: "6" },
  ],
  conditions: [
    ...(SAMPLE_D20.conditions ?? []),
    {
      id: "burning",
      label: "Burning",
      cite: "Sample p.19",
      duration: "manual",
      visibility: "party",
      at: "turnStart",
      text: "Burning: lose 1 Vigour unless doused",
    },
    {
      id: "reeling",
      label: "Reeling",
      cite: "Sample p.19",
      duration: "ownTurnEnd",
      from: "nextOwnTurn",
      stacking: "stack",
      maxStacks: 3,
      visibility: "party",
      immune: "level >= 5",
    },
  ],
  reminders: [
    {
      id: "rally",
      at: "turnStart",
      text: "Rally: below half Vigour, spend 1 Momentum to steady",
      if: "res.hp * 2 <= derived.maxHp",
      cite: "Sample p.19",
    },
    { id: "footing", at: "turnEnd", text: "Check footing on broken ground", cite: "Sample p.19" },
    { id: "heldLost", at: "roundEnd", text: "A held action is lost", if: "held", cite: "Sample p.17" },
    {
      id: "offGuardEnds",
      at: "roundEnd",
      text: "No longer caught off guard: acts next round",
      if: "barred && round == 1",
      cite: "Sample p.18",
    },
  ],
  rests: [{ event: "longRest", refusedIn: ["downed"], cite: "Sample p.20" }],
  health: {
    ...SAMPLE_D20.health,
    states: [...(SAMPLE_D20.health?.states ?? []), { id: "downed", label: "Downed", when: "res.hp <= 0" }],
  },
  initiative: {
    strategy: "sides",
    sides: [
      { id: "wardens", label: "Wardens", entities: ["character"] },
      { id: "raiders", label: "Raiders", entities: ["creature"] },
    ],
    unableStates: ["downed"],
    firstSide: "rotate",
    roundEnd: "manual",
    setup: { cite: "Sample p.16", note: "Mark who is caught off guard, describe the field, then begin the round" },
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
  // House decision #84: a party-pool spend with a number, a paid out-of-turn start and a lifted bar, each taken by its
  // own op; at most three asks per user.
  spends: [
    {
      id: "rally",
      label: "Rally",
      cite: "Sample p.19",
      entities: ["character"],
      cost: [{ pool: "momentum", amount: "ctx.dice" }],
      inputs: { dice: { label: "Dice", min: 1, max: "3" } },
    },
    {
      id: "jump",
      label: "Jump the line",
      cite: "Sample p.17",
      entities: ["character"],
      cost: [{ pool: "momentum", amount: "1", byRun: true }],
      if: "ctx.fight.in",
      run: [{ primitive: "initiative.sides", op: "seize", input: { id: "ctx.self" } }],
      clearOn: ["encounterEnd"],
    },
    {
      id: "shake",
      label: "Shake it off",
      cite: "Sample p.18",
      entities: ["character"],
      cost: [{ pool: "momentum", amount: "2", byRun: true }],
      if: "ctx.fight.barred",
      run: [{ primitive: "initiative.sides", op: "lift", input: { id: "ctx.self" } }],
      clearOn: ["encounterEnd"],
    },
  ],
  requests: { max: 3 },
};
