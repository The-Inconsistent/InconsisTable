import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder ruleset written for tests of `health.harm` (house decision #66): heroes whose wounds count up until
 * they fall, brutes that never take strain, and swarms that stand for many members. Since 0.1.2 a lookup the GM types
 * a result into (house decision #87): a switch that changes the wounds, surge dice that raise the total, a stacking
 * condition brutes are immune to, applied again for each point of press, an open-ended last line, and a line that
 * sends the GM to a second table. Every name, number and cite is our own invention ("Sample p.N" points at no real
 * book). This is 0.1.2; SAMPLE_HARM, below, adds what a hero holds in play.
 */
export const SAMPLE_HARM_BEFORE_HELD: RulesetInput = {
  id: "sample-harm",
  version: "0.1.2",
  core: "^0.1.0",
  sources: [{ id: "sample", title: "Sample Harm Rules", license: "private", pageOffset: 0 }],
  entities: [
    {
      id: "hero",
      label: "Hero",
      base: "actor",
      fields: {
        grit: { type: "int", label: "Grit", min: 1, max: 10, visibility: "party", editableBy: "owner" },
        scars: { type: "int", label: "Scars", min: 0, visibility: "party" },
        gone: { type: "bool", label: "Gone", visibility: "party" },
      },
      derived: [
        { id: "limit", label: "Wound limit", expr: "grit + 3", visibility: "party", cite: "Sample p.2" },
        { id: "strainCap", label: "Strain limit", expr: "grit", visibility: "party", cite: "Sample p.2" },
      ],
    },
    {
      id: "brute",
      label: "Brute",
      base: "actor",
      fields: { hide: { type: "int", label: "Hide", min: 1 }, gone: { type: "bool", label: "Gone" } },
      derived: [
        { id: "limit", label: "Wound limit", expr: "hide", cite: "Sample p.5" },
        { id: "strainCap", label: "Strain limit", expr: "0", cite: "Sample p.5" },
      ],
    },
    {
      id: "swarm",
      label: "Swarm",
      base: "actor",
      fields: { size: { type: "int", label: "Size", min: 1, max: 500, visibility: "party" } },
      derived: [
        { id: "limit", label: "Wound limit", expr: "1", cite: "Sample p.6" },
        { id: "strainCap", label: "Strain limit", expr: "2", cite: "Sample p.6" },
      ],
    },
  ],
  resources: [
    {
      id: "wounds",
      label: "Wounds",
      cite: "Sample p.3",
      scope: "entity",
      max: "derived.limit",
      capped: false,
      start: "0",
      visibility: "party",
    },
    {
      id: "strain",
      label: "Strain",
      cite: "Sample p.3",
      scope: "entity",
      max: "derived.strainCap",
      capped: false,
      start: "0",
      visibility: "party",
      resetOn: [{ event: "longRest", to: "0" }],
    },
    {
      id: "resolve",
      label: "Resolve",
      cite: "Sample p.8",
      scope: "entity",
      entities: ["hero"],
      max: "3",
      start: "2",
      visibility: "party",
    },
    {
      id: "members",
      label: "Members",
      cite: "Sample p.6",
      scope: "entity",
      entities: ["swarm"],
      max: "size",
      visibility: "party",
    },
  ],
  conditions: [
    { id: "down", label: "Down", cite: "Sample p.4", duration: "manual", visibility: "party" },
    { id: "winded", label: "Winded", cite: "Sample p.4", duration: "manual", visibility: "party" },
    {
      id: "dazed",
      label: "Dazed",
      cite: "Sample p.4",
      duration: "manual",
      stacking: "stack",
      maxStacks: 3,
      visibility: "party",
      immune: "derived.strainCap == 0",
    },
  ],
  tables: {
    blow: {
      title: "Telling Blow",
      die: "d66",
      visibility: "gm",
      cite: "Sample p.8",
      typedOnly: true,
      entities: ["hero", "brute"],
      inputs: [
        { id: "past", label: "Past the hide", type: "bool", cite: "Sample p.8" },
        { id: "surge", label: "Surge dice", type: "int", min: 0, max: 4, cite: "Sample p.8" },
        { id: "press", label: "Press", type: "int", min: 0, max: 3, cite: "Sample p.9" },
      ],
      modifier: "ctx.surge * 10",
      entries: [
        { id: "graze", label: "Graze", range: [11, 36], apply: [{ kind: "harm", wounds: "ctx.past ? 2 : 1" }] },
        {
          id: "reel",
          label: "Reel",
          range: [41, 56],
          apply: [
            { kind: "harm", wounds: "2", when: "ctx.past" },
            { kind: "harm", wounds: "1", when: "!ctx.past" },
            { kind: "condition", condition: "dazed", when: "ctx.past" },
            { kind: "condition", condition: "dazed", when: "ctx.past", times: "ctx.press" },
          ],
          note: "The foe staggers back a step",
          cite: "Sample p.9",
        },
        {
          id: "ruin",
          label: "Ruin",
          range: [61],
          apply: [{ kind: "harm", wounds: "ctx.past ? 4 : 1" }],
          cite: "Sample p.9",
          next: "aftermath",
        },
      ],
    },
    aftermath: {
      title: "Aftermath",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.10",
      entries: [
        { id: "limp", label: "Limp", range: [1, 3] },
        { id: "scar", label: "Scar", range: [4, 6] },
      ],
    },
  },
  initiative: { strategy: "seated", firstPlayer: "fixed", cite: "Sample p.7" },
  health: {
    states: [
      { id: "hurt", label: "Hurt", when: "res.wounds > 0 && res.wounds <= derived.limit", entities: ["hero", "brute"] },
      { id: "fallen", label: "Fallen", when: "res.wounds > derived.limit", entities: ["hero", "brute"] },
      { id: "routing", label: "Routing", when: "res.members * 2 <= size && res.members > 0", entities: ["swarm"] },
    ],
    harm: {
      cite: "Sample p.3",
      wounds: "wounds",
      shock: "strain",
      mob: { members: "members", start: "size" },
      profiles: [
        {
          entities: ["hero"],
          spent: { when: "res.strain > derived.strainCap", conditions: ["winded"] },
          felled: { when: "res.wounds > derived.limit", injuries: "scars", condition: "down", healTo: "derived.limit" },
          destroyed: { over: "derived.limit * 2", field: "gone" },
          convert: true,
        },
        {
          entities: ["brute"],
          shockless: "derived.strainCap == 0",
          destroyed: { over: "derived.limit * 2", field: "gone" },
        },
        { entities: ["swarm"] },
      ],
    },
  },
  // House decision #84: a costed spend with no effect, one that pays a personal resource and heals by an expression,
  // and a free one that converts harm by a number the player reports.
  spends: [
    {
      id: "retry",
      label: "Try again",
      cite: "Sample p.8",
      entities: ["hero"],
      cost: [{ resource: "resolve", amount: "1" }],
    },
    {
      id: "steady",
      label: "Steady yourself",
      cite: "Sample p.8",
      entities: ["hero"],
      cost: [{ resource: "resolve", amount: "1" }],
      if: "res.strain > 0 && res.wounds <= derived.limit",
      run: [{ primitive: "health.harm", op: "hit", input: { actorId: "ctx.self", shock: "-grit" } }],
    },
    {
      id: "endure",
      label: "Endure",
      cite: "Sample p.9",
      entities: ["hero"],
      cost: [],
      inputs: { marks: { label: "Marks rolled", min: 1, max: "grit * 2" } },
      run: [{ primitive: "health.harm", op: "convert", input: { actorId: "ctx.self", amount: "ctx.marks" } }],
      clearOn: ["encounterEnd"],
    },
  ],
};

const [hero, ...others] = SAMPLE_HARM_BEFORE_HELD.entities ?? [];

/**
 * sample-harm 0.1.3 (house decision #88): a hero gains growths in play, pack entries of the type `growth` kept in its
 * `growths` list, seen by name only by the hero's player and the GM side ("Unseen" to everyone else). The GM steps
 * through a chain of tables with one hero: the Omen's d6 picks the Lesser or the Greater table; the Lesser's d66 adds
 * 10 for each growth the hero holds already, and its top line sends the GM on to the Greater; a line of either grants
 * its growth. Nothing is granted until the last step is applied.
 */
export const SAMPLE_HARM: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_HELD,
  version: "0.1.3",
  entities: [
    {
      ...hero!,
      fields: { ...hero!.fields, growths: { type: "list", label: "Growths", visibility: "owner" } },
    },
    ...others,
    { id: "growth", label: "Growth", base: "ability", fields: {} },
  ],
  layout: {
    hero: {
      sections: [
        { id: "body", label: "Body", show: ["grit", "derived.limit", "res.wounds", "res.strain"] },
        { id: "growths", label: "Growths", show: [{ widget: "held" }] },
      ],
    },
  },
  held: {
    growth: {
      label: "Growths",
      entry: "growth",
      field: "growths",
      entities: ["hero"],
      unseen: "Unseen",
      max: 5,
      cite: "Sample p.11",
    },
  },
  tables: {
    ...SAMPLE_HARM_BEFORE_HELD.tables,
    omen: {
      title: "Omen",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.11",
      entries: [
        { id: "faint", label: "Faint", range: [1, 3], next: "lesser" },
        { id: "stark", label: "Stark", range: [4, 6], next: "greater" },
      ],
    },
    lesser: {
      title: "Lesser Growths",
      die: "d66",
      visibility: "gm",
      cite: "Sample p.12",
      entities: ["hero"],
      modifier: "count(growths) * 10",
      entries: [
        { id: "horn", label: "Horn", range: [11, 36], apply: [{ kind: "grant", held: "growth", entry: "horn" }] },
        { id: "scales", label: "Scales", range: [41, 56], apply: [{ kind: "grant", held: "growth", entry: "scales" }] },
        { id: "worse", label: "Worse", range: [61], next: "greater", note: "Roll again on the Greater table" },
      ],
    },
    greater: {
      title: "Greater Growths",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.13",
      entities: ["hero"],
      entries: [
        { id: "wings", label: "Wings", range: [1, 3], apply: [{ kind: "grant", held: "growth", entry: "wings" }] },
        {
          id: "eye",
          label: "Third Eye",
          range: [4, 6],
          apply: [{ kind: "grant", held: "growth", entry: "third-eye" }],
        },
      ],
    },
  },
};

/** Growths for SAMPLE_HARM 0.1.3: each adds to a hero's wound limit, which every seat reads (house decision #88). */
export const SAMPLE_HARM_GROWTHS = [
  { key: "horn", name: "Horn", value: "1" },
  { key: "scales", name: "Scales", value: "2" },
  { key: "wings", name: "Wings", value: "1" },
  { key: "third-eye", name: "Third Eye", value: "1" },
].map(({ key, name, value }) => ({
  key,
  type: "growth",
  name,
  tags: [],
  cite: "Sample p.14",
  visibility: "gm",
  body: {},
  effects: [{ path: "derived.limit", mode: "add", value, phase: "derived" }],
}));
