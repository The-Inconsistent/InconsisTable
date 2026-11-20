import type { RulesetInput } from "../manifest.ts";
import { CODEX_0_1_7, SAMPLE_D20 } from "./sample-d20.ts";

/**
 * A placeholder ruleset written for tests: sample-d20 with a turn order of two sides that alternate, a setup with a
 * note, paid out-of-turn action, holding and a first-round bar; reminder lines at a turn's start and end and at the
 * round's end, a condition with its own line, one armed from its holder's next turn that a big enough foe is immune to,
 * and a long rest refused while downed (house decision #81). Its codex is sample-d20's of 0.1.7 plus a second shape of
 * rows (house decision #89): a quest's road log the crew reads, text only, filled by hand and never picked by a scene;
 * and a setup checklist with a campaign field it reads (house decision #90).
 * Every name, number and cite is our own invention.
 */
export const SAMPLE_SKIRMISH: RulesetInput = {
  ...SAMPLE_D20,
  id: "sample-skirmish",
  version: "0.1.5",
  codex: {
    kinds: {
      ...CODEX_0_1_7.kinds,
      quest: {
        fields: {
          log: {
            type: "rows",
            label: "Road log",
            visibility: "party",
            columns: [
              { id: "day", label: "Day", type: "text", maxLength: 20 },
              { id: "what", label: "What came of it", type: "text", maxLength: 200 },
            ],
            maxRows: 20,
            cite: "Sample p.21",
          },
        },
      },
    },
  },
  // House decision #91: anyone may hold wards up, each raising the target of its own checks by 2, ended by hand.
  entities: SAMPLE_D20.entities.map((e) =>
    e.base !== "actor"
      ? e
      : {
          ...e,
          fields: {
            ...e.fields,
            wards: {
              type: "list",
              label: "Holding",
              visibility: "party",
              editableBy: "owner",
              maxItems: 6,
              chips: true,
              picks: { entity: "gear" },
              cite: "Sample p.23",
            },
          },
          derived: [
            ...(e.derived ?? []),
            { id: "wardLoad", label: "Ward load", expr: "2 * count(wards)", visibility: "party", cite: "Sample p.23" },
          ],
        },
  ),
  resources: [
    ...(SAMPLE_D20.resources ?? []),
    { id: "momentum", label: "Momentum", cite: "Sample p.15", scope: "party", max: "6", visibility: "party" },
    { id: "pressure", label: "Pressure", cite: "Sample p.15", scope: "gm", max: "6" },
    {
      id: "nerve",
      label: "Nerve",
      cite: "Sample p.22",
      scope: "entity",
      entities: ["character"],
      max: "4",
      start: "4",
      visibility: "party",
      editableBy: "owner",
    },
  ],
  tests: {
    ...SAMPLE_D20.tests,
    check: { ...SAMPLE_D20.tests?.check, target: "ctx.dc + derived.wardLoad" } as NonNullable<
      RulesetInput["tests"]
    >[string],
  },
  tables: {
    backlash: {
      title: "Backlash",
      die: "1d6",
      visibility: "party",
      cite: "Sample p.22",
      // The Channel's push, carried over by its `then`, adds to the count (house decision #91).
      inputs: [{ id: "extra", label: "Extra", type: "int", min: 0, max: 2 }],
      modifier: "ctx.extra",
      entries: [
        { id: "jolt", label: "Jolt", range: [1, 3] },
        { id: "daze", label: "Daze", range: [4, 5] },
        { id: "burst", label: "Burst", range: [6] },
      ],
    },
  },
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
    // House decision #91: once a round in a fight, pushed by up to 2 for a Nerve each; a backlash count opens the table.
    {
      id: "channel",
      label: "Channel",
      cite: "Sample p.22",
      entities: ["character"],
      cost: [{ resource: "nerve", amount: "1 + ctx.push" }],
      inputs: { push: { label: "Push", min: 0, max: "2" } },
      limit: { per: "round", max: 1 },
      then: { table: "backlash", inputs: { extra: "push" } },
    },
  ],
  requests: { max: 3 },
  // The chapter a campaign is in, which the checklist's second step reads (house decision #90).
  campaignFields: { chapter: { type: "int", label: "Chapter", min: 1, max: 9, default: 1, cite: "Sample p.22" } },
  // Setting up a skirmish campaign, in the order the invented book gives (house decision #90).
  checklist: [
    {
      id: "limits",
      label: "Agree on lines and veils",
      done: { count: "safety" },
      goto: { tab: "party" },
      cite: "Sample p.22",
    },
    {
      id: "chapter",
      label: "Pick the chapter",
      done: { count: "campaignField", field: "chapter" },
      goto: { tab: "party" },
      cite: "Sample p.22",
    },
    {
      id: "rivals",
      label: "Name a rival faction",
      done: { count: "entries", kind: "faction", field: "standing", equals: "rival" },
      goto: { tab: "codex", kind: "faction" },
      note: "Allies can wait",
      cite: "Sample p.23",
    },
    {
      id: "bestiary",
      label: "Attach a bestiary",
      done: { count: "packs" },
      goto: { tab: "rules" },
      cite: "Sample p.23",
      optional: true,
    },
    {
      id: "crew",
      label: "Make two wardens",
      done: { count: "actors", entity: "character", min: 2 },
      goto: { tab: "party" },
      cite: "Sample p.24",
    },
    {
      id: "momentum",
      label: "Start with momentum",
      done: { count: "pool", pool: "momentum", min: 1 },
      goto: { tab: "track" },
      cite: "Sample p.24",
    },
    {
      id: "fight",
      label: "Prepare a fight",
      done: { count: "entries", kind: "scene", prep: "roster" },
      goto: { tab: "prep" },
      cite: "Sample p.25",
    },
    {
      id: "first",
      label: "Play the first session",
      done: { count: "sessions" },
      goto: { tab: "party" },
      cite: "Sample p.25",
    },
  ],
};

/** SAMPLE_SKIRMISH as it was at 0.1.4, before the wards it holds up, Nerve, Channel and its backlash table (#91). */
export const SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND: RulesetInput = (() => {
  const { tables: _tables, ...before } = SAMPLE_SKIRMISH;
  return {
    ...before,
    version: "0.1.4",
    entities: SAMPLE_D20.entities,
    tests: SAMPLE_D20.tests,
    resources: before.resources?.filter((x) => x.id !== "nerve"),
    spends: before.spends?.filter((x) => x.id !== "channel"),
  };
})();

/** SAMPLE_SKIRMISH as it was at 0.1.3, before its checklist and the campaign field the checklist reads. */
export const SAMPLE_SKIRMISH_BEFORE_CHECKLIST: RulesetInput = (() => {
  const { checklist: _checklist, campaignFields: _fields, ...before } = SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND;
  return { ...before, version: "0.1.3" };
})();
