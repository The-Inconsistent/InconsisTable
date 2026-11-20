import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder d20-style ruleset written for tests. Every name, number and cite is our own invention ("Sample p.N"
 * points at no real book); it exists to exercise the engine, not to describe any published game.
 */
export const SAMPLE_D20: RulesetInput = {
  id: "sample-d20",
  version: "0.1.4",
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
  },
  // What a person and a faction carry in the codex (house decision #71): the crew sees how a person feels and where
  // they live, the GM whose creature backs them, where a faction stands and where it sits (house decision #76).
  codex: {
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
  },
};
