import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder duel ruleset written for tests of strikes (house decision #99), a second game whose attack works unlike
 * sample-harm's: one roll plus the duelist's skill against the target's parry, a hit doing the blade's flat cut, no
 * soak, no strain and no mobs. Every name, number and cite is our own invention ("Sample p.N" points at no real book).
 * This is 0.1.0, before its phone's strip and turn.
 */
export const SAMPLE_DUEL_BEFORE_PANELS: RulesetInput = {
  id: "sample-duel",
  version: "0.1.0",
  core: "^0.1.0",
  sources: [{ id: "sample", title: "Sample Duel Rules", license: "private", pageOffset: 0 }],
  entities: [
    {
      id: "duelist",
      label: "Duelist",
      base: "actor",
      fields: {
        skill: { type: "int", label: "Skill", min: 0, max: 10, visibility: "party" },
        parry: { type: "int", label: "Parry", min: 5, max: 25, visibility: "party" },
        blades: { type: "list", label: "Blades", visibility: "party" },
      },
      derived: [{ id: "limit", label: "Cut limit", expr: "5", visibility: "party", cite: "Sample p.2" }],
    },
    { id: "blade", label: "Blade", base: "item", fields: { cut: { type: "int", label: "Cut", min: 1, max: 10 } } },
  ],
  resources: [
    {
      id: "cuts",
      label: "Cuts",
      cite: "Sample p.3",
      scope: "entity",
      max: "derived.limit",
      capped: false,
      start: "0",
      visibility: "party",
    },
  ],
  initiative: { strategy: "seated", firstPlayer: "fixed", cite: "Sample p.4" },
  health: {
    tracks: [],
    states: [],
    harm: { cite: "Sample p.3", wounds: "cuts", profiles: [{ entities: ["duelist"] }] },
  },
  strikes: [
    {
      id: "lunge",
      label: "Lunge",
      cite: "Sample p.5",
      means: [{ from: "list", field: "blades", entry: "blade" }],
      values: { cut: { key: "cut", type: "int" } },
      pool: { label: "Skill", expr: "skill", cite: "Sample p.5" },
      beat: { label: "Parry", expr: "ctx.target.parry", cite: "Sample p.5" },
      outcomes: [
        { id: "hit", label: "Hit", when: "ctx.total >= ctx.beat", wounds: "ctx.means.cut", cite: "Sample p.5" },
        { id: "miss", label: "Miss", when: "true", cite: "Sample p.5" },
      ],
    },
  ],
};

/**
 * sample-duel 0.1.1 (house decisions #114, #115), the third shape: no asks, no sides, no states. The strip shows the
 * duelist's skill and parry and its cuts against its limit; when its cuts rise, a sheet with one line and no ask; on its
 * turn the lunge guide, which only the GM applies (the lunge is not `byOwner`).
 */
export const SAMPLE_DUEL: RulesetInput = {
  ...SAMPLE_DUEL_BEFORE_PANELS,
  version: "0.1.1",
  layout: {
    duelist: {
      sections: [{ id: "duelist", label: "Duelist", show: ["skill", "parry", "derived.limit", "res.cuts"] }],
      phoneStrip: [
        { widget: "frames", bind: { values: ["skill", "parry"] } },
        { widget: "track", bind: { value: "res.cuts", max: "derived.limit" } },
      ],
      phoneTurn: [
        { widget: "panel", variant: "touched" },
        { widget: "strike", variant: "lunge" },
      ],
    },
  },
  panels: [
    {
      id: "touched",
      label: "Touched",
      cite: "Sample p.7",
      entities: ["duelist"],
      opensOn: { rises: "cuts" },
      lines: [{ text: "Step back and call your parry for the next pass", cite: "Sample p.7" }],
    },
  ],
};

/** Blades for SAMPLE_DUEL: the flat cut a hit does. */
export const SAMPLE_DUEL_BLADES = [
  { key: "rapier", name: "Rapier", body: { cut: 2 } },
  { key: "sabre", name: "Sabre", body: { cut: 3 } },
].map(({ key, name, body }) => ({ key, type: "blade", name, tags: [], cite: "Sample p.6", visibility: "gm", body }));
