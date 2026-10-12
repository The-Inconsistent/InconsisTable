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
