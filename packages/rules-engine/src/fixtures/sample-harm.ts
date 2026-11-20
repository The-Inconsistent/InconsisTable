import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder ruleset written for tests of `health.harm` (house decision #66): heroes whose wounds count up until
 * they fall, brutes that never take strain, and swarms that stand for many members. Every name, number and cite is our
 * own invention ("Sample p.N" points at no real book).
 */
export const SAMPLE_HARM: RulesetInput = {
  id: "sample-harm",
  version: "0.1.0",
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
  ],
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
};
