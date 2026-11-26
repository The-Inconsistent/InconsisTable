import type { PackInput } from "../pack.ts";

/**
 * A tiny pack for `sample-d20`, invented for tests like the ruleset: every name, number and page is made up and
 * points at no real book.
 */
export const SAMPLE_PACK: PackInput = {
  id: "sample-bestiary",
  version: "0.1.0",
  ruleset: { id: "sample-d20", range: "^0.1.0" },
  license: "private",
  sources: [{ id: "sample", title: "Sample d20 Rules", license: "private" }],
  entries: [
    {
      key: "reedfolk",
      type: "lineage",
      name: "Reedfolk",
      tags: ["lineage"],
      cite: "Sample p.10",
      visibility: "public",
      body: { size: "small", blurb: "Marsh dwellers who travel light." },
    },
    {
      key: "wayfinder",
      type: "calling",
      name: "Wayfinder",
      tags: ["calling"],
      cite: "Sample p.11",
      visibility: "public",
      body: { guardBase: 3, blurb: "Scouts the road ahead." },
    },
    {
      key: "ember-wisp",
      type: "creature",
      name: "Ember Wisp",
      level: 1,
      tags: ["spirit", "fire"],
      cite: "Sample p.40",
      visibility: "gm",
      body: { name: "Ember Wisp", level: 1, "attr.str": 6, "attr.dex": 14, "attr.con": 8, guard: 11 },
    },
    {
      key: "coil-rope",
      type: "gear",
      name: "Coil of Rope",
      cite: "Sample p.50",
      visibility: "party",
      body: { weight: 2 },
    },
  ],
};

/** Two entries whose effects reach an actor that chose them (house decision #61); a pack beside the plain sample. */
export const SAMPLE_PACK_EFFECTS: PackInput = {
  ...SAMPLE_PACK,
  id: "sample-boons",
  entries: [
    {
      key: "swift-blood",
      type: "lineage",
      name: "Swift Blood",
      cite: "Sample p.12",
      visibility: "public",
      body: { size: "small" },
      effects: [{ path: "attr.dex", mode: "add", value: "2", phase: "base" }],
    },
    {
      key: "shield-arm",
      type: "calling",
      name: "Shield Arm",
      cite: "Sample p.13",
      visibility: "public",
      body: { guardBase: 3 },
      effects: [{ path: "derived.defense", mode: "add", value: "3", phase: "derived" }],
    },
  ],
};

/**
 * Entries sample-d20 0.1.9 makes codex entries from (house decision #97): a place three deep, a GM-only scene that
 * brings two checks and two of the bestiary's foes, and a charter written for two seasons. Invented like the rest.
 */
export const SAMPLE_ATLAS: PackInput = {
  ...SAMPLE_PACK,
  id: "sample-atlas",
  entries: [
    { key: "old-mill", type: "site", name: "Old Mill", cite: "Sample p.60", visibility: "party", body: { peril: 2 } },
    {
      key: "mill-cellar",
      type: "site",
      name: "Mill Cellar",
      cite: "Sample p.61",
      visibility: "party",
      body: { within: "old-mill", peril: 4 },
    },
    {
      key: "cellar-well",
      type: "site",
      name: "Cellar Well",
      cite: "Sample p.61",
      visibility: "party",
      body: { within: "mill-cellar" },
    },
    {
      key: "bridge-toll",
      type: "incident",
      name: "Bridge Toll",
      cite: "Sample p.70",
      visibility: "gm",
      body: { checks: ["check", "gambit"], dc: 12, foes: ["ember-wisp", "ember-wisp"] },
    },
    {
      key: "lantern-charter",
      type: "charter",
      name: "Lantern Charter",
      cite: "Sample p.80",
      visibility: "public",
      body: { seasonFrom: 2, seasonTo: 3 },
    },
  ],
};

/**
 * Entries sample-d20 0.1.16 fills from (house decisions #177, #178): a house whose marks fill a faction's, a hazard whose
 * check fills a danger's, an incident naming the skill its check reads, and an omen a scene spends menace on. Invented.
 */
export const SAMPLE_ANNALS: PackInput = {
  ...SAMPLE_PACK,
  id: "sample-annals",
  ruleset: { id: "sample-d20", range: "^0.1.16" },
  entries: [
    {
      key: "house-reed",
      type: "house",
      name: "House Reed",
      cite: "Sample p.16",
      visibility: "party",
      body: { marks: ["Reedfolk", "Boatwrights"] },
    },
    {
      key: "loose-scree",
      type: "hazard",
      name: "Loose Scree",
      cite: "Sample p.18",
      visibility: "gm",
      body: { threat: 3, check: "check", strengths: ["faint"] },
    },
    {
      key: "ferry-raid",
      type: "incident",
      name: "Ferry Raid",
      cite: "Sample p.71",
      visibility: "gm",
      body: { checks: ["check"], dc: 14, skill: "dex" },
    },
    {
      key: "black-crow",
      type: "omen",
      name: "A black crow",
      cite: "Sample p.72",
      visibility: "gm",
      body: { cost: 2, gist: "A foe arrives early" },
    },
  ],
};
