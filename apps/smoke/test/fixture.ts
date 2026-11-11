import type { RulesetInput } from "@inconsistable/rules-engine";

// A small made-up ruleset for the api tests. Every name, number and cite is our own invention ("Fixture p.N" points at
// no book); the repo ships no game content (CLAUDE.md). It has just what the pipeline tests touch: a character with
// fields of each visibility and `editableBy`, a creature, resources that clamp and reset, and conditions that stack.
export const FIXTURE_RULESET: RulesetInput = {
  id: "api-fixture",
  version: "0.1.0",
  core: "^0.1.0",
  sources: [{ id: "fixture", title: "Api Fixture Rules", license: "private" }],
  entities: [
    {
      id: "character",
      label: "Character",
      base: "actor",
      fields: {
        name: { type: "text", label: "Name", visibility: "public", editableBy: "owner" },
        level: { type: "int", label: "Level", min: 1, max: 20, visibility: "party" },
        "attr.con": { type: "int", label: "Grit", min: 1, max: 30, visibility: "party", editableBy: "owner" },
        "attr.dex": { type: "int", label: "Grace", min: 1, max: 30, visibility: "party" },
        diary: { type: "text", label: "Diary", visibility: "owner", editableBy: "owner", maxLength: 40 },
        gmNote: { type: "text", label: "GM note" },
        tags: { type: "list", label: "Tags", visibility: "party", maxItems: 3 },
        healthState: { type: "enum", label: "Status", values: ["ok", "dying", "stable", "dead"], visibility: "party" },
        deathSaveSuccesses: { type: "int", label: "Saves passed", visibility: "party" },
        deathSaveFailures: { type: "int", label: "Saves failed", visibility: "party" },
      },
      derived: [
        {
          id: "maxHp",
          label: "Max Vigour",
          expr: "6 + level * 2 + mod(attr.con)",
          visibility: "party",
          cite: "Fixture p.1",
        },
      ],
    },
    {
      id: "creature",
      label: "Creature",
      base: "actor",
      fields: {
        level: { type: "int", label: "Level", min: 0 },
        "attr.con": { type: "int", label: "Grit" },
        "attr.dex": { type: "int", label: "Grace" },
        healthState: { type: "enum", label: "Status", values: ["ok", "dying", "stable", "dead"], visibility: "party" },
      },
      derived: [{ id: "maxHp", label: "Max Vigour", expr: "4 + level * 3" }],
    },
  ],
  resources: [
    {
      id: "hp",
      label: "Vigour",
      cite: "Fixture p.2",
      scope: "entity",
      max: "derived.maxHp",
      resetOn: [{ event: "longRest", to: "max" }],
      visibility: "party",
    },
    { id: "tempHp", label: "Spare Vigour", cite: "Fixture p.2", scope: "entity", visibility: "party" },
    {
      id: "focus",
      label: "Focus",
      cite: "Fixture p.3",
      scope: "entity",
      entities: ["character"],
      max: "3",
      resetOn: [
        { event: "shortRest", to: "max" },
        { event: "sessionStart", to: "1" },
      ],
      visibility: "owner",
      editableBy: "ownerSpendOnly",
    },
  ],
  conditions: [
    { id: "dazed", label: "Dazed", cite: "Fixture p.4", duration: "roundEnd", visibility: "party", effects: [] },
    {
      id: "braced",
      label: "Braced",
      cite: "Fixture p.4",
      duration: "encounterEnd",
      stacking: "stack",
      maxStacks: 3,
      visibility: "party",
      effects: [],
    },
    { id: "burning", label: "Burning", cite: "Fixture p.4", duration: "roundEnd", stacking: "refresh", effects: [] },
    { id: "marked", label: "Marked", cite: "Fixture p.4", duration: "manual", effects: [] },
  ],
  // A d20-style check: roll against a number the caller supplies, adding the named score's modifier.
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
      cite: "Fixture p.6",
    },
    // A d8 Dice pool sized by Grit: the top face scores two, the Omen die flags its ends, the top dice can be shifted.
    skill: {
      kind: "poolSuccesses",
      pool: "attr.con / 4",
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
      inputs: { dn: "int", bonus: "int" },
      cite: "Fixture p.7",
    },
  },
  initiative: { strategy: "ranked", score: "mod(attr.dex)", cite: "Fixture p.5" },
  health: {
    tracks: [{ resource: "hp", temp: "tempHp", deathSaves: { successes: 3, failures: 3 } }],
    states: [],
    cite: "Fixture p.2",
  },
};
