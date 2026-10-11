import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder d20-style ruleset written for tests. Every name, number and cite is our own invention ("Sample p.N"
 * points at no real book); it exists to exercise the engine, not to describe any published game.
 */
export const SAMPLE_D20: RulesetInput = {
  id: "sample-d20",
  version: "0.1.0",
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
      resetOn: [{ event: "shortRest", to: "max" }],
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
    { id: "menace", label: "Menace", cite: "Sample p.7", scope: "gm", max: "party.characters * 2" },
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
      cite: "Sample p.2",
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
  layout: {
    sheet: { sections: [{ id: "abilities", label: "Abilities", show: ["attr.str", "attr.dex", "attr.con"] }] },
  },
};
