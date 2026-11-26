import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder d20-style ruleset written for tests. Every name, number and cite is our own invention ("Sample p.N"
 * points at no real book); it exists to exercise the engine, not to describe any published game.
 */
/** The resources only sample-d20's notices read (house decision #79); the samples built on it leave them out. */
export const NOTICE_RESOURCES: readonly string[] = ["boons", "renown"];

/**
 * The codex block as it was at 0.1.7 (house decisions #71, #76): the crew sees how a person feels and where they
 * live, the GM whose creature backs them, where a faction stands and where it sits. 0.1.8 adds tags, rows and a
 * reminder (house decision #89); the samples built on the earlier versions keep this one.
 */
export const CODEX_0_1_7: NonNullable<RulesetInput["codex"]> = {
  kinds: {
    npc: {
      fields: {
        mood: {
          type: "enum",
          label: "Mood",
          values: ["warm", "wary", "cold"],
          labels: { warm: "Warm", wary: "Wary", cold: "Cold" },
          notes: { cold: "-2 to sway them" },
          tones: { warm: "good", cold: "bad" },
          visibility: "party",
          cite: "Sample p.14",
        },
        disposition: { type: "int", label: "Disposition", min: -3, max: 3, visibility: "party", cite: "Sample p.14" },
        patron: { type: "ref", label: "Patron", entity: "creature", cite: "Sample p.15" },
        home: { type: "entry", label: "Home", kind: "location", visibility: "party", cite: "Sample p.15" },
      },
    },
    faction: {
      fields: {
        standing: {
          type: "enum",
          label: "Standing",
          values: ["ally", "neutral", "rival"],
          labels: { ally: "Ally", neutral: "Neutral", rival: "Rival" },
          cite: "Sample p.16",
        },
        seat: { type: "entry", label: "Seat", kind: "location", cite: "Sample p.16" },
      },
    },
  },
};

export const SAMPLE_D20_0_1_8: RulesetInput = {
  id: "sample-d20",
  version: "0.1.8",
  core: "^0.1.0",
  sources: [{ id: "sample", title: "Sample d20 Rules", license: "private", pageOffset: 0 }],
  terms: { party: "Crew", foe: "Opposition", hp: "Vigour" },
  options: [{ id: "slowRecovery", label: "Slow recovery", cite: "Sample p.9" }],
  entities: [
    {
      id: "character",
      label: "Character",
      base: "actor",
      fields: {
        name: { type: "text", label: "Name", visibility: "public", editableBy: "owner" },
        level: { type: "int", label: "Level", min: 1, max: 20, visibility: "party" },
        "attr.str": { type: "int", label: "Might", min: 1, max: 30, visibility: "party", editableBy: "owner" },
        "attr.dex": { type: "int", label: "Grace", min: 1, max: 30, visibility: "party", editableBy: "owner" },
        "attr.con": { type: "int", label: "Grit", min: 1, max: 30, visibility: "party", editableBy: "owner" },
        guard: { type: "int", label: "Guard", visibility: "party" },
        size: { type: "enum", label: "Size", values: ["small", "medium"], visibility: "party" },
        diary: { type: "text", label: "Diary", visibility: "owner", editableBy: "owner" },
        gmNote: { type: "text", label: "GM note" },
        healthState: { type: "enum", label: "Status", values: ["ok", "dying", "stable", "dead"], visibility: "party" },
        deathSaveSuccesses: { type: "int", label: "Saves passed", visibility: "party" },
        deathSaveFailures: { type: "int", label: "Saves failed", visibility: "party" },
        strain: { type: "int", label: "Strain", min: 0, max: 9, visibility: "party", cite: "Sample p.6" },
      },
      derived: [
        // Declared out of order on purpose: the engine sorts them.
        {
          id: "maxHp",
          label: "Max Vigour",
          expr: "derived.baseHp + (level - 1) * 4",
          visibility: "party",
          cite: "Sample p.3",
        },
        { id: "baseHp", label: "Base Vigour", expr: "6 + mod(attr.con)", visibility: "party", cite: "Sample p.3" },
        { id: "initBonus", label: "Readiness", expr: "mod(attr.dex)", visibility: "party", cite: "Sample p.4" },
        { id: "defense", label: "Defense", expr: "guard + derived.initBonus", visibility: "party", cite: "Sample p.4" },
        { id: "mightMod", label: "Might bonus", expr: "mod(attr.str)", visibility: "party", cite: "Sample p.2" },
        { id: "graceMod", label: "Grace bonus", expr: "mod(attr.dex)", visibility: "party", cite: "Sample p.2" },
        { id: "gritMod", label: "Grit bonus", expr: "mod(attr.con)", visibility: "party", cite: "Sample p.2" },
      ],
    },
    {
      id: "creature",
      label: "Creature",
      base: "actor",
      fields: {
        name: { type: "text", label: "Name", visibility: "public" },
        level: { type: "int", label: "Level", min: 0 },
        "attr.str": { type: "int", label: "Might" },
        "attr.dex": { type: "int", label: "Grace" },
        "attr.con": { type: "int", label: "Grit" },
        guard: { type: "int", label: "Guard" },
        healthState: { type: "enum", label: "Status", values: ["ok", "dying", "stable", "dead"], visibility: "party" },
      },
      derived: [{ id: "maxHp", label: "Max Vigour", expr: "4 + max(0, mod(attr.con)) * 2 + level * 3" }],
    },
    {
      id: "lineage",
      label: "Lineage",
      base: "ability",
      fields: {
        size: { type: "enum", label: "Size", values: ["small", "medium"], visibility: "public" },
        blurb: { type: "text", label: "Blurb", visibility: "public" },
      },
    },
    {
      id: "calling",
      label: "Calling",
      base: "ability",
      fields: {
        guardBase: { type: "int", label: "Base guard", min: 0, max: 20, visibility: "public" },
        blurb: { type: "text", label: "Blurb", visibility: "public" },
      },
    },
    {
      id: "gear",
      label: "Gear",
      base: "item",
      fields: { weight: { type: "int", label: "Weight", visibility: "public" } },
    },
  ],
  resources: [
    {
      id: "hp",
      label: "Vigour",
      cite: "Sample p.5",
      scope: "entity",
      max: "derived.maxHp",
      resetOn: [{ event: "longRest", to: "max" }],
      visibility: "party",
    },
    { id: "tempHp", label: "Spare Vigour", cite: "Sample p.5", scope: "entity", visibility: "party" },
    {
      id: "focus",
      label: "Focus",
      cite: "Sample p.6",
      scope: "entity",
      entities: ["character"],
      max: "1",
      resetOn: [
        { event: "shortRest", to: "max" },
        { event: "longRest", to: "max" },
      ],
      visibility: "owner",
      editableBy: "ownerSpendOnly",
    },
    {
      id: "luck",
      label: "Luck",
      cite: "Sample p.7",
      scope: "party",
      max: "max(3, party.characters)",
      resetOn: [{ event: "sessionStart", to: "0" }],
      visibility: "party",
      editableBy: "owner",
    },
    {
      id: "menace",
      label: "Menace",
      cite: "Sample p.7",
      scope: "gm",
      max: "party.characters * 2",
      resetOn: [{ event: "encounterEnd", to: "min" }],
    },
    // Boons are spent between sessions; Renown comes back in full when a session ends (house decision #79's fixture).
    {
      id: "boons",
      label: "Boons",
      cite: "Sample p.17",
      scope: "entity",
      entities: ["character"],
      max: "5",
      start: "0",
      visibility: "party",
    },
    {
      id: "renown",
      label: "Renown",
      cite: "Sample p.17",
      scope: "entity",
      entities: ["character"],
      max: "12",
      start: "0",
      resetOn: [{ event: "sessionEnd", to: "max" }],
      visibility: "party",
    },
  ],
  conditions: [
    {
      id: "dazed",
      label: "Dazed",
      cite: "Sample p.8",
      duration: "roundEnd",
      visibility: "party",
      effects: [{ path: "attr.dex", mode: "add", value: "-2" }],
    },
    {
      id: "braced",
      label: "Braced",
      cite: "Sample p.8",
      duration: "encounterEnd",
      visibility: "party",
      effects: [{ path: "derived.defense", mode: "add", value: "2", phase: "derived" }],
    },
    { id: "marked", label: "Marked", cite: "Sample p.8", duration: "manual" },
    { id: "staggered", label: "Staggered", cite: "Sample p.8", duration: "ownTurnEnd", visibility: "party" },
  ],
  tests: {
    check: {
      kind: "sumVsTarget",
      dice: "1d20",
      modifier: "mod(attr[ctx.ability])",
      target: "ctx.dc",
      advantage: true,
      critOn: [20],
      inputs: { ability: "text", dc: "int" },
      inputOptions: { ability: ["str", "dex", "con", "wis"] },
      label: "Ability check",
      inputLabels: { ability: "Ability", dc: "DC" },
      inputOptionLabels: { ability: { str: "Strength", dex: "Dexterity", con: "Constitution", wis: "Wisdom" } },
      cite: "Sample p.2",
    },
    // The table rolls and works it out; the phone only picks what came up.
    gambit: {
      kind: "reported",
      outcomes: [
        { id: "clean", label: "Clean", cite: "Sample p.3" },
        { id: "costly", label: "Costly", cite: "Sample p.3" },
        { id: "missed", label: "Missed", cite: "Sample p.3" },
      ],
      cite: "Sample p.3",
    },
  },
  initiative: {
    strategy: "ranked",
    score: "mod(attr.dex)",
    dice: "1d20",
    tiebreak: ["attr.dex"],
    rerollEachRound: false,
    cite: "Sample p.4",
  },
  health: {
    tracks: [
      {
        resource: "hp",
        temp: "tempHp",
        deathSaves: { successes: 3, failures: 3, criticalFailureCounts: 2, criticalSuccessHeals: 1 },
      },
    ],
    states: [{ id: "bloodied", label: "Bloodied", when: "res.hp * 2 <= derived.maxHp" }],
    cite: "Sample p.5",
  },
  creation: [
    {
      kind: "choose",
      id: "lineage",
      actor: "character",
      label: "Lineage",
      cite: "Sample p.10",
      pick: "lineage",
      copy: [{ from: "size", to: "size" }],
    },
    {
      kind: "choose",
      id: "calling",
      actor: "character",
      label: "Calling",
      cite: "Sample p.11",
      pick: "calling",
      copy: [{ from: "guardBase", to: "guard" }],
    },
    {
      kind: "assign",
      id: "scores",
      actor: "character",
      label: "Scores",
      cite: "Sample p.12",
      fields: ["attr.str", "attr.dex", "attr.con"],
      method: { kind: "table", values: [15, 12, 9] },
    },
    {
      kind: "fields",
      id: "identity",
      actor: "character",
      label: "Name",
      cite: "Sample p.13",
      fields: ["name", "level"],
    },
  ],
  decisions: [
    {
      id: "restsDoNotCascade",
      text: "A long rest does not run the short-rest resets on its own; Focus lists both events.",
      cite: "Sample p.9",
    },
  ],
  layout: {
    sheet: { sections: [{ id: "abilities", label: "Abilities", show: ["attr.str", "attr.dex", "attr.con"] }] },
    // The character's sheet drawn with widgets (house decision #83); every other actor keeps the plain `sheet` rows.
    character: {
      sections: [
        {
          id: "who",
          label: "Character",
          show: [{ widget: "strip", bind: { title: "name", values: ["level", "size", "healthState"] } }],
        },
        {
          id: "abilities",
          label: "Abilities",
          show: [
            {
              widget: "grid",
              bind: {
                ratings: ["attr.str", "attr.dex", "attr.con"],
                bonus: ["derived.mightMod", "derived.graceMod", "derived.gritMod"],
              },
            },
          ],
        },
        {
          id: "vigour",
          label: "Vigour",
          show: [
            // A phone may not work out a bound whose formula reads a field it is not sent: the limit is bound.
            { widget: "track", bind: { value: "res.hp", max: "derived.maxHp" } },
            "res.tempHp",
            { widget: "track", bind: { value: "res.focus" } },
          ],
        },
        {
          id: "defense",
          label: "Defense",
          show: [
            { widget: "frames", bind: { values: ["derived.initBonus", "derived.maxHp"] } },
            {
              widget: "sum",
              label: "Defense",
              bind: { parts: ["guard", "derived.initBonus"], total: "derived.defense" },
            },
          ],
        },
        {
          id: "strain",
          label: "Strain",
          show: [
            {
              widget: "pips",
              bind: { value: "strain" },
              steps: [
                { label: "Calm", size: 3 },
                { label: "Tense", size: 3 },
                { label: "Breaking", size: 3 },
              ],
            },
            "deathSaveSuccesses",
            "deathSaveFailures",
          ],
        },
        { id: "notes", label: "Notes", show: [{ widget: "notes", bind: { fields: ["diary"] } }] },
      ],
    },
  },
  // What a person, a faction and a place carry in the codex (house decisions #71, #76, #89).
  codex: {
    kinds: {
      ...CODEX_0_1_7.kinds,
      // A faction's marks: lineage names offered, any word written in; an ally marked an outsider raises a line.
      faction: {
        fields: {
          ...CODEX_0_1_7.kinds.faction?.fields,
          marks: {
            type: "tags",
            label: "Marks",
            entities: ["lineage"],
            writeIn: true,
            maxItems: 10,
            cite: "Sample p.16",
          },
        },
        reminders: [
          {
            id: "outsiderAlly",
            if: 'fields.standing == "ally" && contains(fields.marks, "Outsider")',
            text: "An outsider ally needs a reason to ride with the crew",
            cite: "Sample p.16",
          },
        ],
      },
      // A place's dangers: rows a creature fills or the GM writes, each with a threat, a strength and a check, picked
      // by a scene and marked noticed there.
      location: {
        fields: {
          dangers: {
            type: "rows",
            label: "Dangers",
            columns: [
              { id: "name", label: "Name", type: "text", maxLength: 80 },
              { id: "threat", label: "Threat", type: "int", min: 0, max: 20 },
              {
                id: "strength",
                label: "Strength",
                type: "enum",
                values: ["faint", "fierce"],
                labels: { faint: "Faint", fierce: "Fierce" },
                tones: { fierce: "bad" },
              },
              { id: "check", label: "Check", type: "test" },
              { id: "effect", label: "What happens", type: "text", maxLength: 200 },
            ],
            maxRows: 12,
            from: [{ entity: "creature", name: "name", values: { threat: "level" } }],
            pick: { label: "Noticed" },
            cite: "Sample p.18",
          },
        },
      },
    },
  },
  // What the GM is told (house decision #79): who still has boons as a session starts, and who rose to the top standing.
  notices: [
    {
      id: "unspent",
      when: "sessionStart",
      entities: ["character"],
      if: "res.boons > 0",
      text: "{name} has boons to spend",
      cite: "Sample p.17",
    },
    {
      id: "renowned",
      when: "crossed",
      entities: ["character"],
      // Renown counts in steps of four; the third step is the top one.
      if: "floor(res.renown, 4) >= 3",
      text: "{name} is renowned",
      cite: "Sample p.17",
    },
  ],
};

/** The values 0.1.7 added for its widget layout (house decision #83). */
const WIDGET_DERIVED = new Set(["mightMod", "graceMod", "gritMod"]);

/**
 * SAMPLE_D20 as it was at 0.1.6, before its character had a widget layout: the plain `sheet` rows only, without the
 * values the widgets added. The rulesets built on it before then keep their pinned hashes (fixtures.test.ts).
 */
export const SAMPLE_D20_BEFORE_WIDGETS: RulesetInput = {
  ...SAMPLE_D20_0_1_8,
  version: "0.1.6",
  entities: SAMPLE_D20_0_1_8.entities.map((e) => {
    if (e.id !== "character") return e;
    const { strain: _strain, ...fields } = e.fields ?? {};
    return { ...e, fields, derived: e.derived?.filter((d) => !WIDGET_DERIVED.has(d.id)) };
  }),
  layout: { sheet: SAMPLE_D20_0_1_8.layout?.sheet ?? { sections: [] } },
  codex: CODEX_0_1_7,
};

const codex0_1_8 = SAMPLE_D20_0_1_8.codex?.kinds ?? {};

/**
 * 0.1.9 (house decision #97): entries made from pack entries (a place with the places inside it, a scene that brings
 * its checks and its foes, a charter whose season is checked against the campaign's), and a person's name and look
 * rolled on two tables each. Every name, number and page is invented.
 */
export const SAMPLE_D20_0_1_9: RulesetInput = {
  ...SAMPLE_D20_0_1_8,
  version: "0.1.9",
  entities: [
    ...SAMPLE_D20_0_1_8.entities,
    {
      id: "site",
      label: "Site",
      base: "item",
      fields: {
        within: { type: "ref", label: "Within", entity: "site", visibility: "public" },
        peril: { type: "int", label: "Peril", min: 0, max: 10, visibility: "public" },
      },
    },
    {
      id: "incident",
      label: "Incident",
      base: "item",
      fields: {
        checks: { type: "list", label: "Checks", maxItems: 6, visibility: "public" },
        dc: { type: "int", label: "DC", min: 1, max: 30, visibility: "public" },
        foes: { type: "list", label: "Foes", maxItems: 10, visibility: "public" },
      },
    },
    {
      id: "charter",
      label: "Charter",
      base: "ability",
      fields: {
        seasonFrom: { type: "int", label: "From season", min: 1, max: 5, visibility: "public" },
        seasonTo: { type: "int", label: "To season", min: 1, max: 5, visibility: "public" },
      },
    },
  ],
  campaignFields: { season: { type: "int", label: "Season", min: 1, max: 5, default: 1, cite: "Sample p.21" } },
  tables: {
    forename: {
      title: "Forenames",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.30",
      entries: [
        { id: "ash", label: "Ash", range: [1, 2] },
        { id: "bryn", label: "Bryn", range: [3, 4] },
        { id: "cael", label: "Cael", range: [5, 6] },
      ],
    },
    surname: {
      title: "Surnames",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.30",
      entries: [
        { id: "reed", label: "Reed", range: [1, 3] },
        { id: "vane", label: "Vane", range: [4, 6] },
      ],
    },
    hue: {
      title: "Eye hues",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.33",
      entries: [
        { id: "grey", label: "Grey eyes", range: [1, 3] },
        { id: "amber", label: "Amber eyes", range: [4, 6] },
      ],
    },
    scar: {
      title: "Marks",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.33",
      entries: [
        { id: "none", label: "no mark", range: [1, 4] },
        { id: "burn", label: "a burn on one hand", range: [5, 6] },
      ],
    },
  },
  codex: {
    kinds: {
      ...codex0_1_8,
      npc: {
        fields: {
          ...codex0_1_8.npc?.fields,
          look: {
            type: "text",
            label: "Look",
            maxLength: 200,
            roll: { tables: ["hue", "scar"], join: ", " },
            cite: "Sample p.33",
          },
        },
        titleRoll: { tables: ["forename", "surname"] },
      },
      location: {
        fields: {
          ...codex0_1_8.location?.fields,
          peril: { type: "int", label: "Peril", min: 0, max: 10, cite: "Sample p.18" },
        },
        from: [{ entity: "site", values: { peril: "peril" }, children: "within" }],
      },
      scene: {
        fields: {},
        from: [{ entity: "incident", tests: { field: "checks", inputs: { dc: "dc" } }, roster: "foes" }],
      },
      lore: {
        fields: {
          charter: { type: "text", label: "Charter", maxLength: 120, visibility: "party", cite: "Sample p.21" },
          seasonFrom: { type: "int", label: "From season", min: 1, max: 5, cite: "Sample p.21" },
          seasonTo: { type: "int", label: "To season", min: 1, max: 5, cite: "Sample p.21" },
        },
        from: [{ entity: "charter", name: "charter", values: { seasonFrom: "seasonFrom", seasonTo: "seasonTo" } }],
        reminders: [
          {
            id: "offSeason",
            if: "fields.seasonFrom > campaign.season || fields.seasonTo < campaign.season",
            text: "Written for another season: a hint only, the season stays as it is",
            cite: "Sample p.21",
          },
        ],
      },
    },
  },
};

const codex0_1_9 = SAMPLE_D20_0_1_9.codex?.kinds ?? {};

/**
 * 0.1.10 (house decision #98): a warren generator. The GM sets how many chambers, rolls what made the warren (a built
 * one goes on to its builders' table), picks a creature to keep it (a flooded warren only a creature of level 1 or
 * more), and rolls each chamber; the warren is made as a place with its keeper, and its chambers inside it. Invented.
 */
export const SAMPLE_D20_0_1_10: RulesetInput = {
  ...SAMPLE_D20_0_1_9,
  version: "0.1.10",
  tables: {
    ...SAMPLE_D20_0_1_9.tables,
    warren: {
      title: "Warrens",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.90",
      entries: [
        { id: "flooded", label: "Flooded warren", range: [1, 2] },
        { id: "burrowed", label: "Burrowed warren", range: [3, 4] },
        { id: "built", label: "Built warren", range: [5, 6], next: "builders" },
      ],
    },
    builders: {
      title: "Builders",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.90",
      entries: [
        { id: "smiths", label: "Warren of the smiths", range: [1, 3] },
        { id: "monks", label: "Warren of the monks", range: [4, 6] },
      ],
    },
    chamber: {
      title: "Chambers",
      die: "1d6",
      visibility: "gm",
      cite: "Sample p.91",
      entries: [
        { id: "roots", label: "Root hall", range: [1, 2] },
        { id: "vault", label: "Dripping vault", range: [3, 4] },
        { id: "pit", label: "Bone pit", range: [5, 6] },
      ],
    },
  },
  codex: {
    kinds: {
      ...codex0_1_9,
      location: {
        ...codex0_1_9.location!,
        fields: {
          ...codex0_1_9.location?.fields,
          keeper: { type: "ref", label: "Keeper", entity: "creature", cite: "Sample p.90" },
        },
      },
    },
  },
  generators: [
    {
      id: "warren",
      label: "A warren",
      cite: "Sample p.90",
      steps: [
        { id: "rooms", label: "Chambers", kind: "number", min: 1, max: 6 },
        { id: "origin", label: "What made it", kind: "roll", table: "warren" },
        {
          id: "keeper",
          label: "Its keeper",
          kind: "pick",
          entity: "creature",
          filter: 'steps.origin != "flooded" || entry.level >= 1',
        },
      ],
      each: { times: "steps.rooms", steps: [{ id: "chamber", label: "Chamber", kind: "roll", table: "chamber" }] },
      make: {
        kind: "location",
        title: "origin",
        fields: { keeper: "keeper", peril: "rooms" },
        each: { title: "chamber" },
      },
    },
  ],
};

/** Invented meanings by definition id (house decision #126), never a book's words. */
const MEANINGS: Readonly<Record<string, string>> = {
  "attr.str": "How hard you push, lift and strike. Its bonus is added to checks that lean on strength.",
  guard: "What your training adds to Defense before anything else.",
  gmNote: "The GM's own line about this character; players never see it.",
  defense: "How hard you are to hit: an attack must reach this number.",
  hp: "How much harm you can take. At 0 you are down and start rolling to stay alive.",
  dazed: "Your footing is gone for a moment: Grace counts 2 lower until the round ends.",
  season: "Where the year stands. Some charters and places only fit certain seasons.",
  mood: "How this person feels about the crew right now. A cold one is harder to sway.",
};
const meant = <T extends object>(id: string, def: T): T => (MEANINGS[id] ? { ...def, summary: MEANINGS[id] } : def);

/**
 * 0.1.11 (house decision #126): a field, a derived value, a resource, a Condition, a campaign field and the GM's own
 * field each say what they mean in a line of our own. 0.1.10 hashes as it did.
 */
export const SAMPLE_D20_0_1_11: RulesetInput = {
  ...SAMPLE_D20_0_1_10,
  version: "0.1.11",
  entities: SAMPLE_D20_0_1_10.entities.map((e) =>
    e.id !== "character"
      ? e
      : {
          ...e,
          fields: Object.fromEntries(Object.entries(e.fields ?? {}).map(([id, f]) => [id, meant(id, f)])),
          derived: e.derived?.map((d) => meant(d.id, d)),
        },
  ),
  resources: SAMPLE_D20_0_1_10.resources?.map((r) => meant(r.id, r)),
  conditions: SAMPLE_D20_0_1_10.conditions?.map((c) => meant(c.id, c)),
  campaignFields: Object.fromEntries(
    Object.entries(SAMPLE_D20_0_1_10.campaignFields ?? {}).map(([id, f]) => [id, meant(id, f)]),
  ),
  codex: {
    kinds: Object.fromEntries(
      Object.entries(SAMPLE_D20_0_1_10.codex?.kinds ?? {}).map(([kind, k]) => [
        kind,
        { ...k, fields: Object.fromEntries(Object.entries(k.fields).map(([id, f]) => [id, meant(id, f)])) },
      ]),
    ),
  },
};

const layout0_1_11 = SAMPLE_D20_0_1_11.layout ?? {};

/**
 * 0.1.12 (house decision #127): the table screen shows each character's Vigour against its most, its Defense and its
 * level, and a creature the GM shows in full its Vigour. 0.1.11 hashes as it did.
 */
export const SAMPLE_D20: RulesetInput = {
  ...SAMPLE_D20_0_1_11,
  version: "0.1.12",
  layout: {
    ...layout0_1_11,
    sheet: { ...layout0_1_11.sheet!, screen: [{ widget: "track", bind: { value: "res.hp" } }] },
    character: {
      ...layout0_1_11.character!,
      screen: [
        { widget: "track", bind: { value: "res.hp", max: "derived.maxHp" } },
        { widget: "frames", bind: { values: ["derived.defense", "level"] } },
      ],
    },
  },
};
