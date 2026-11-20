import type { PackInput } from "../pack.ts";

/**
 * A tiny pack of foes for `sample-skirmish` (house decision #92), invented like the ruleset: a minion, a brute with a
 * grudge and no Grace listed, and a boss. Every name, number and page is made up and points at no real book.
 */
export const SAMPLE_SKIRMISH_PACK: PackInput = {
  id: "sample-raiders",
  version: "0.1.0",
  ruleset: { id: "sample-skirmish", range: "^0.1.0" },
  license: "private",
  sources: [{ id: "sample", title: "Sample d20 Rules", license: "private" }],
  entries: [
    {
      key: "ash-hound",
      type: "creature",
      name: "Ash Hound",
      level: 1,
      cite: "Sample p.41",
      visibility: "gm",
      body: { name: "Ash Hound", level: 1, "attr.str": 8, "attr.dex": 14, "attr.con": 8, guard: 10, kind: "minion" },
    },
    {
      key: "iron-warden",
      type: "creature",
      name: "Iron Warden",
      level: 2,
      cite: "Sample p.42",
      visibility: "gm",
      body: { name: "Iron Warden", level: 2, "attr.str": 14, "attr.con": 12, guard: 13, kind: "brute", grudge: 2 },
    },
    {
      key: "raid-captain",
      type: "creature",
      name: "Raid Captain",
      level: 3,
      cite: "Sample p.43",
      visibility: "gm",
      body: {
        name: "Raid Captain",
        level: 3,
        "attr.str": 12,
        "attr.dex": 12,
        "attr.con": 12,
        guard: 12,
        kind: "boss",
        grudge: 4,
      },
    },
  ],
};
