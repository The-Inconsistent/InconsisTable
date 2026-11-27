// What the TypeScript World validator answers (packages/rules-engine/src/world.ts), for internal/engine/world.go to
// match: the lists, the base colours, the linear table, contrast at and around each floor, and valid and refused Worlds
// with their problems and hashes. Every World here is invented. generate.ts writes these under `worlds`.
import { SAMPLE_WORLD } from "../../../packages/rules-engine/src/fixtures/sample-world.ts";
import { SAMPLE_WORLD_WORDS } from "../../../packages/rules-engine/src/fixtures/sample-words.ts";
import {
  contrastHundredths,
  HANDOUT_LAYOUTS,
  MAX_HANDOUT_LAYOUT_NAME,
  MAX_WORLD_BYTES,
  validateWorld,
  WORLD_BASE_COLOURS,
  WORLD_COLOUR_SOURCES,
  WORLD_COLOUR_TOKENS,
  WORLD_CONTRAST_PAIRS,
  WORLD_LINEAR,
  WORLD_SCHEMES,
  WORLD_SHAPES,
  WORLD_TEXTURES,
  WORLD_TYPEFACES,
  worldHash,
} from "../../../packages/rules-engine/src/world.ts";

const world = (schemes: unknown, theme: Record<string, unknown> = {}) => ({
  id: "w",
  version: "1.0.0",
  core: "^1.0.0",
  name: "W",
  theme: { schemes, ...theme },
});

// Pairs at the floors, found by search over the integer arithmetic: the 4.5 and 3 floors from just under, exactly at
// and just over, and the extremes.
const FLOOR_PAIRS: [string, string][] = [
  ["#bb17fe", "#ffffff"], // 4.4999996: 4.49, refused
  ["#4966cd", "#ffecdd"], // exactly 4.5
  ["#ffe1f8", "#b804c5"], // exactly 4.5, the other way round
  ["#936c7a", "#ffffff"], // 4.5000001
  ["#45a93f", "#ffffff"], // 2.9999995: 2.99, refused
  ["#e85934", "#84ffff"], // exactly 3
  ["#242424", "#6d6d6d"], // exactly 3, greys
  ["#989a30", "#ffffff"], // 3.0000004
  ["#000000", "#ffffff"],
  ["#ffffff", "#ffffff"],
  ["#000000", "#000000"],
  ["#ABCDEF", "#abcdef"],
];

const JUNK: unknown[] = [null, 1, true, "x", [], {}];

function cases(): unknown[] {
  const inputs: unknown[] = [
    SAMPLE_WORLD,
    world({ light: {} }),
    world({ dark: {} }),
    world({ light: {}, dark: {} }),
    world({ light: {} }, { typefaces: {}, shapes: {} }),
    world({ light: { INK: "#000000" } }),
    world({ light: { ink: "#ABCDEF" } }),
    // A palette name moves the semantic names that read it; a semantic name set directly wins.
    world({ light: { parchment: "#2a1b10" } }),
    world({ light: { parchment: "#2a1b10", paper: "#f2e5c6", "paper-2": "#f2e5c6" } }),
    world({ dark: { wood: "#f4e8cd" } }),
    world({ dark: { "parchment-ink": "#000000" } }),
    world({ dark: { ink: "#000000" } }),
    world({
      light: { ink: "#ffffff", "ink-2": "#ffffff", accent: "#ffffff", focus: "#ffffff" },
      dark: { band: "#f4e8cd" },
    }),
    // At and around the floors.
    world({ dark: { "band-ink": "#bb17fe", band: "#ffffff" } }),
    world({ dark: { "band-ink": "#4966cd", band: "#ffecdd" } }),
    world({ light: { "band-ink": "#936c7a", band: "#ffffff" } }),
    world({ light: { paper: "#ffffff", focus: "#45a93f", "focus-halo": "#ffffff" } }),
    world({ light: { paper: "#ffffff", focus: "#e85934", "focus-halo": "#84ffff" } }),
    world({ light: { paper: "#ffffff", focus: "#989a30", "focus-halo": "#ffffff" } }),
    // The schema, one kind of problem each.
    world({}),
    world({ light: "#000000" }),
    world({ light: { ink: "red" } }),
    world({ light: { ink: "#12345" } }),
    world({ light: { ink: "#1234567" } }),
    world({ light: { ink: "#12345g" } }),
    world({ light: { ink: 1 } }),
    world({ light: { glow: "#000000" } }),
    // Keys in sorted order: zod names unknown keys in the input's order, and Go's PartialRecord sorts them, since the
    // vectors decode into a map that has lost it.
    world({ light: { aura: "#000000", glow: "#000000", ink: "bad" } }),
    world({ light: {} }, { typefaces: { body: "comic" } }),
    world({ light: {} }, { typefaces: { display: "cinzel", extra: "x" } }),
    world({ light: {} }, { typefaces: "cinzel" }),
    world({ light: {} }, { texture: "marble" }),
    world({ light: {} }, { shapes: "round" }),
    world({ light: {} }, { shapes: { corners: "round", buttonFrame: "x", headingCase: "caps" } }),
    world({ light: {} }, { extra: true }),
    // The slate readout holds the band's pair to 5:1 (house decision #204): 4.55 is refused with it, kept without.
    world({ dark: { band: "#000000", "band-ink": "#757575" } }, { shapes: { readout: "slate" } }),
    world({ dark: { band: "#000000", "band-ink": "#757575" } }, { shapes: { readout: "plain" } }),
    world({ dark: { band: "#000000", "band-ink": "#808080" } }, { shapes: { readout: "slate" } }),
    { ...world({ light: {} }), id: "Not Kebab" },
    { ...world({ light: {} }), id: "a".repeat(65) },
    { ...world({ light: {} }), version: "1.0" },
    { ...world({ light: {} }), core: "one" },
    { ...world({ light: {} }), core: ">=1.0.0 <2.0.0 || 3.x" },
    { ...world({ light: {} }), name: "" },
    { ...world({ light: {} }), name: "n".repeat(80) },
    { ...world({ light: {} }), name: "n".repeat(81) },
    // Terms (issue #159): a word, a word and its plural, per language, and refused ones.
    SAMPLE_WORLD_WORDS,
    { ...world({ light: {} }), terms: { party: "crew" } },
    { ...world({ light: {} }), terms: {} },
    { ...world({ light: {} }), terms: { party: { one: "Crew", other: "Crews" }, gm: { vi: "Trưởng" } } },
    { ...world({ light: {} }), terms: { crew: "Crew" } },
    { ...world({ light: {} }), terms: { party: {} } },
    { ...world({ light: {} }), terms: { party: { fr: "Équipe" } } },
    { ...world({ light: {} }), terms: { party: { one: "Crew" } } },
    { ...world({ light: {} }), terms: { party: { en: "" } } },
    { ...world({ light: {} }), terms: { party: "x".repeat(61) } },
    { ...world({ light: {} }), terms: { markerRed: "coral", tableScreen: { en: { one: "Wall", other: "Walls" } } } },
    // Handout layouts (house decision #72): offered, named, and refused.
    { ...world({ light: {} }), handouts: { layouts: ["plain"] } },
    { ...world({ light: {} }), handouts: { layouts: [...HANDOUT_LAYOUTS], names: { tablet: "Glass", plain: "Note" } } },
    { ...world({ light: {} }), handouts: { layouts: ["form"], names: { transcript: "n".repeat(40) } } },
    { ...world({ light: {} }), handouts: { layouts: ["form"], names: { transcript: "n".repeat(41) } } },
    { ...world({ light: {} }), handouts: { layouts: ["form"], names: { form: "" } } },
    { ...world({ light: {} }), handouts: { layouts: ["form"], names: { scroll: "Scroll", form: 1 } } },
    { ...world({ light: {} }), handouts: { layouts: ["scroll"] } },
    { ...world({ light: {} }), handouts: { layouts: ["form", "plain", "form"] } },
    { ...world({ light: {} }), handouts: { layouts: [] } },
    { ...world({ light: {} }), handouts: { layouts: [...HANDOUT_LAYOUTS, "plain"] } },
    { ...world({ light: {} }), handouts: { names: { form: "Ledger" } } },
    { ...world({ light: {} }), handouts: { layouts: ["form"], extra: true } },
    { id: "w" },
    {},
    null,
    [],
    "world",
    // The size cap, as serialised: just under and just over.
    { ...world({ light: {} }), pad: "x".repeat(MAX_WORLD_BYTES - 200) },
    { ...world({ light: {} }), pad: "x".repeat(MAX_WORLD_BYTES) },
  ];
  for (const junk of JUNK) inputs.push({ ...world({ light: {} }), terms: junk });
  for (const key of ["id", "version", "core", "name", "theme"])
    for (const junk of JUNK) inputs.push({ ...world({ light: {} }), [key]: junk });
  for (const junk of JUNK) inputs.push({ ...world({ light: {} }), handouts: junk });
  for (const junk of JUNK) inputs.push({ ...world({ light: {} }), handouts: { layouts: junk } });
  for (const junk of JUNK) inputs.push({ ...world({ light: {} }), handouts: { layouts: ["form"], names: junk } });
  for (const key of ["schemes", "typefaces", "texture", "shapes"])
    for (const junk of JUNK) inputs.push(world({ light: {} }, { [key]: junk }));
  for (const [key, options] of Object.entries(WORLD_SHAPES))
    for (const v of [...options, "nope"]) inputs.push(world({ light: {} }, { shapes: { [key]: v } }));
  for (const v of [...WORLD_TYPEFACES, "nope"]) inputs.push(world({ light: {} }, { typefaces: { mono: v } }));

  return inputs.map((input) => {
    const r = validateWorld(input);
    return r.ok
      ? { input, ok: true, world: r.world, hash: worldHash(r.world) }
      : { input, ok: false, problems: r.problems };
  });
}

export function worldVectors() {
  return {
    maxBytes: MAX_WORLD_BYTES,
    tokens: WORLD_COLOUR_TOKENS,
    schemes: WORLD_SCHEMES,
    typefaces: WORLD_TYPEFACES,
    textures: WORLD_TEXTURES,
    layouts: HANDOUT_LAYOUTS,
    maxLayoutName: MAX_HANDOUT_LAYOUT_NAME,
    shapes: Object.entries(WORLD_SHAPES).map(([key, options]) => ({ key, options })),
    pairs: WORLD_CONTRAST_PAIRS,
    base: WORLD_BASE_COLOURS,
    sources: WORLD_COLOUR_SOURCES,
    linear: WORLD_LINEAR,
    contrast: [
      ...FLOOR_PAIRS,
      ...WORLD_SCHEMES.flatMap((s) =>
        WORLD_CONTRAST_PAIRS.map(({ fg, bg }): [string, string] => [
          WORLD_BASE_COLOURS[s][fg],
          WORLD_BASE_COLOURS[s][bg],
        ]),
      ),
    ].map(([a, b]) => ({ a, b, hundredths: contrastHundredths(a, b) })),
    cases: cases(),
  };
}
