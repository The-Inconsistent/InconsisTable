import type { FieldDef, RulesetInput } from "../manifest.ts";
import { CODEX_0_1_7, SAMPLE_D20_0_1_8 } from "./sample-d20.ts";

/** The creature's own fields of house decision #92: its kind and the grudge its Spite starts from. */
const CREATURE_FIELDS: Record<string, FieldDef> = {
  kind: {
    type: "enum",
    label: "Kind",
    values: ["minion", "brute", "boss"],
    labels: { minion: "Minion", brute: "Brute", boss: "Boss" },
    notes: { minion: "Falls at the first wound", brute: "Shrugs off staggering", boss: "Acts twice a round" },
    visibility: "party",
    editableBy: "gm",
    cite: "Sample p.24",
  },
  grudge: { type: "int", label: "Grudge", min: 0, visibility: "gm", editableBy: "gm", cite: "Sample p.24" },
};

/**
 * A placeholder ruleset written for tests: sample-d20 with a turn order of two sides that alternate, a setup with a
 * note, paid out-of-turn action, holding and a first-round bar; reminder lines at a turn's start and end and at the
 * round's end, a condition with its own line, one armed from its holder's next turn that a big enough foe is immune to,
 * and a long rest refused while downed (house decision #81). Its codex is sample-d20's of 0.1.7 plus a second shape of
 * rows (house decision #89): a quest's road log the crew reads, text only, filled by hand and never picked by a scene;
 * and a setup checklist with a campaign field it reads (house decision #90).
 * Every name, number and cite is our own invention. This is 0.1.9, before its phone's panels and strip.
 */
export const SAMPLE_SKIRMISH_BEFORE_PANELS: RulesetInput = {
  ...SAMPLE_D20_0_1_8,
  id: "sample-skirmish",
  version: "0.1.9",
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
      // House decision #107: a scene is ready for the table once its goal and what is read aloud are written.
      scene: {
        fields: {
          goal: { type: "text", label: "Goal", maxLength: 200, visibility: "gm", cite: "Sample p.24" },
          readAloud: { type: "text", label: "Read aloud", maxLength: 600, visibility: "party", cite: "Sample p.24" },
          // House decision #76: one place, an entry of kind location; the scene page draws it because the kind declares it.
          place: { type: "entry", label: "Place", kind: "location", visibility: "party", cite: "Sample p.24" },
        },
        ready: ["goal", "readAloud"],
      },
    },
  },
  // House decision #91: anyone may hold wards up, each raising the target of its own checks by 2, ended by hand.
  // House decision #92: a creature is of a kind (a note each, shown on its tracker row) and carries a grudge.
  entities: SAMPLE_D20_0_1_8.entities.map((e) =>
    e.base !== "actor"
      ? e
      : {
          ...e,
          fields: {
            ...e.fields,
            ...(e.id === "creature" ? CREATURE_FIELDS : {}),
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
    ...(SAMPLE_D20_0_1_8.resources ?? []),
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
    // House decision #92: a creature's Spite starts from its own grudge.
    {
      id: "spite",
      label: "Spite",
      cite: "Sample p.24",
      scope: "entity",
      entities: ["creature"],
      max: "6",
      start: "grudge",
      visibility: "gm",
      editableBy: "gm",
    },
  ],
  // The tracker row names a creature's kind (its tag) and its Spite (a stepper) (house decision #92).
  layout: {
    ...SAMPLE_D20_0_1_8.layout,
    sheet: { sections: SAMPLE_D20_0_1_8.layout?.sheet?.sections ?? [], trackerRow: ["kind", "res.spite"] },
  },
  // House decision #92: two options a foe may be spawned with, one scaling it to the table, and a budget.
  spawn: {
    options: [
      {
        id: "hardened",
        label: "Hardened",
        cite: "Sample p.25",
        entities: ["creature"],
        when: 'kind != "minion"',
        effects: [{ path: "guard", mode: "add", value: "2" }],
      },
      {
        id: "quick",
        label: "Quick",
        cite: "Sample p.25",
        entities: ["creature"],
        // A Grace the entry does not list lands on 10 plus the bonus.
        effects: [
          { path: "attr.dex", mode: "add", value: "2", when: "has(attr.dex)" },
          { path: "attr.dex", mode: "override", value: "12", when: "!has(attr.dex)" },
        ],
      },
      { id: "scaled", label: "Scaled to the table", cite: "Sample p.26", entities: ["creature"] },
    ],
    adjust: [
      {
        option: "scaled",
        entities: ["creature"],
        when: '!ctx.mob && kind != "minion"',
        add: { level: "party.seated + campaign.peril", spite: "1" },
        cite: "Sample p.26",
      },
    ],
    budget: {
      cite: "Sample p.27",
      lines: [
        { id: "foes", label: "Foes", cost: "ctx.mob ? 1 : ctx.count", budget: "party.seated * 2 + campaign.peril" },
        { id: "bosses", label: "Bosses", cost: 'kind == "boss" ? ctx.count : 0', budget: "1" },
      ],
      switches: [{ id: "fortified", label: "Fortified", by: "ctx.budget * 2" }],
    },
  },
  tests: {
    ...SAMPLE_D20_0_1_8.tests,
    check: { ...SAMPLE_D20_0_1_8.tests?.check, target: "ctx.dc + derived.wardLoad" } as NonNullable<
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
    ...(SAMPLE_D20_0_1_8.conditions ?? []),
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
    ...SAMPLE_D20_0_1_8.health,
    states: [...(SAMPLE_D20_0_1_8.health?.states ?? []), { id: "downed", label: "Downed", when: "res.hp <= 0" }],
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
  campaignFields: {
    // The chapter a campaign is in, which the checklist's second step reads (house decision #90).
    chapter: { type: "int", label: "Chapter", min: 1, max: 9, default: 1, cite: "Sample p.22" },
    // The peril spawn scaling and the budget read (house decision #92).
    peril: { type: "int", label: "Peril", min: 1, max: 5, default: 1, cite: "Sample p.25" },
  },
  // What the GM's header shows beside the name: the peril and the fight's round (house decision #109).
  header: { fields: ["peril"], round: true },
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

const characterLayout = SAMPLE_SKIRMISH_BEFORE_PANELS.layout?.character ?? { sections: [] };

/**
 * sample-skirmish 0.1.10 (house decisions #114, #115), the second shape of a phone's fight: a sides order. The strip
 * shows the warden's name and status, its vigour against its maximum, its nerve and defense. While it is barred, a
 * panel offers to shake it off; while a foe acts, its defense and, when it holds an action, the reminder to cut in;
 * while its status field reads dying (a field, not a health state), its saves; on its turn the moves it may make,
 * grouped by kind, the ones its nerve cannot pay sunk with what they need, hidden while dying; and its asks.
 */
export const SAMPLE_SKIRMISH: RulesetInput = {
  ...SAMPLE_SKIRMISH_BEFORE_PANELS,
  version: "0.1.10",
  entities: [
    ...(SAMPLE_SKIRMISH_BEFORE_PANELS.entities ?? []),
    {
      id: "move",
      label: "Move",
      base: "ability",
      fields: {
        kind: {
          type: "enum",
          label: "Kind",
          values: ["strike", "guard", "step"],
          labels: { strike: "Strikes", guard: "Guards", step: "Steps" },
        },
        nerve: { type: "int", label: "Nerve", min: 0, max: 4 },
        needs: { type: "text", label: "Needs" },
      },
    },
  ],
  layout: {
    ...SAMPLE_SKIRMISH_BEFORE_PANELS.layout,
    character: {
      ...characterLayout,
      phoneStrip: [
        { widget: "strip", bind: { title: "name", values: ["healthState"] } },
        { widget: "track", bind: { value: "res.hp", max: "derived.maxHp" } },
        { widget: "frames", bind: { values: ["res.nerve", "derived.defense"] } },
      ],
      phoneTurn: [
        { widget: "panel", variant: "ambushed" },
        { widget: "panel", variant: "incoming" },
        { widget: "panel", variant: "dying" },
        { widget: "panel", variant: "moves" },
        { widget: "spends" },
      ],
    },
  },
  panels: [
    {
      id: "ambushed",
      label: "Ambushed",
      cite: "Sample p.18",
      entities: ["character"],
      when: "ctx.fight.barred",
      lines: [{ text: "Caught unready: no turn this round unless you shake it off", cite: "Sample p.18" }],
      spends: ["shake"],
    },
    {
      id: "incoming",
      label: "Incoming",
      cite: "Sample p.26",
      entities: ["character"],
      when: "ctx.fight.foeActing",
      lines: [
        { text: "Keep your guard up: the foe beats your defense to hit", cite: "Sample p.26" },
        { text: "You hold an action: cut in now if you will", when: "ctx.fight.held", cite: "Sample p.17" },
      ],
      figures: [{ label: "Defense", expr: "derived.defense", cite: "Sample p.4" }],
    },
    {
      id: "dying",
      label: "Dying",
      cite: "Sample p.6",
      entities: ["character"],
      when: 'healthState == "dying"',
      lines: [
        { text: "Roll a save at the start of each turn", cite: "Sample p.6" },
        { text: "Three passed and you are stable; three failed and you are gone", cite: "Sample p.6" },
      ],
      figures: [
        { label: "Saves passed", expr: "deathSaveSuccesses", cite: "Sample p.6" },
        { label: "Saves failed", expr: "deathSaveFailures", cite: "Sample p.6" },
      ],
    },
    {
      id: "moves",
      label: "This turn",
      cite: "Sample p.27",
      entities: ["character"],
      when: 'ctx.fight.acting && healthState != "dying"',
      options: { entry: "move", group: "kind", usable: "res.nerve >= entry.nerve", needs: "needs" },
    },
  ],
};

/** Moves for SAMPLE_SKIRMISH 0.1.10: the entries its `moves` panel lists (house decision #114). */
export const SAMPLE_SKIRMISH_MOVES = [
  { key: "lunge", name: "Lunge", body: { kind: "strike", nerve: 0 } },
  { key: "feint", name: "Feint", body: { kind: "strike", nerve: 2, needs: "2 Nerve" } },
  { key: "brace", name: "Brace", body: { kind: "guard", nerve: 1, needs: "1 Nerve" } },
  { key: "sidestep", name: "Sidestep", body: { kind: "step", nerve: 0 } },
].map(({ key, name, body }) => ({ key, type: "move", name, tags: [], cite: "Sample p.27", visibility: "party", body }));

/** SAMPLE_SKIRMISH as it was at 0.1.5, before its spawn block, the fields, Spite and Peril it reads (#92) and its scene kind (#107). */
export const SAMPLE_SKIRMISH_BEFORE_SPAWN: RulesetInput = (() => {
  const { spawn: _spawn, layout: _layout, header: _header, ...before } = SAMPLE_SKIRMISH_BEFORE_PANELS;
  const { peril: _peril, ...campaignFields } = before.campaignFields ?? {};
  const { scene: _scene, ...kinds } = before.codex?.kinds ?? {};
  return {
    ...before,
    version: "0.1.5",
    codex: { kinds },
    layout: SAMPLE_D20_0_1_8.layout,
    campaignFields,
    resources: before.resources?.filter((x) => x.id !== "spite"),
    entities: before.entities.map((e) => {
      if (e.id !== "creature") return e;
      const { kind: _kind, grudge: _grudge, ...fields } = e.fields ?? {};
      return { ...e, fields };
    }),
  };
})();

/** SAMPLE_SKIRMISH as it was at 0.1.4, before the wards it holds up, Nerve, Channel and its backlash table (#91). */
export const SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND: RulesetInput = (() => {
  const { tables: _tables, ...before } = SAMPLE_SKIRMISH_BEFORE_SPAWN;
  return {
    ...before,
    version: "0.1.4",
    entities: SAMPLE_D20_0_1_8.entities,
    tests: SAMPLE_D20_0_1_8.tests,
    resources: before.resources?.filter((x) => x.id !== "nerve"),
    spends: before.spends?.filter((x) => x.id !== "channel"),
  };
})();

/** SAMPLE_SKIRMISH as it was at 0.1.3, before its checklist and the campaign field the checklist reads. */
export const SAMPLE_SKIRMISH_BEFORE_CHECKLIST: RulesetInput = (() => {
  const { checklist: _checklist, campaignFields: _fields, ...before } = SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND;
  return { ...before, version: "0.1.3" };
})();
