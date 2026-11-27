import {
  WORLD_COLOUR_SOURCES,
  WORLD_COLOUR_TOKENS,
  WORLD_SCHEMES,
  WORLD_SHAPES,
  WORLD_TEXTURES,
  WORLD_TYPE_ROLES,
  WorldColour,
  worldColours,
  type WorldScheme,
  type WorldShape,
  type WorldTheme,
  type WorldTypeRole,
} from "@inconsistable/rules-engine";

// A World's Theme as the room's wrapper wears it (docs/adr/0010, decision 2). The wrapper carries the picks as data
// attributes, which app/theme/world.css draws; the colours go in a <style> element rendered with the page, so the first
// paint is right. The wrapper is an ancestor of the table's surface.

/** The data attribute each shape pick is written to. */
export const SHAPE_ATTRIBUTES = {
  corners: "data-corners",
  cardEdge: "data-card-edge",
  cardCrest: "data-card-crest",
  bandEdge: "data-band-edge",
  headingRule: "data-heading-rule",
  headingCase: "data-heading-case",
  buttonFrame: "data-button-frame",
  handoutPaper: "data-handout-paper",
  readout: "data-readout",
  gmSeal: "data-gm-seal",
  tableHead: "data-table-head",
  statBlock: "data-stat-block",
  gmNav: "data-gm-nav",
} as const satisfies Record<WorldShape, `data-${string}`>;

/** The data attribute each typeface pick is written to. */
export const TYPEFACE_ATTRIBUTES = {
  display: "data-font-display",
  body: "data-font-body",
  mono: "data-font-mono",
} as const satisfies Record<WorldTypeRole, `data-${string}`>;

export type WorldAttributes = Record<`data-${string}`, string>;
export type WorldVars = Record<`--${string}`, string>;

export type WorldLook = {
  /** For the wrapper: `data-world`, the sets it brings (`data-schemes`), the texture, every shape, the typefaces picked. */
  attributes: WorldAttributes;
  /** Each set the World brings: only the tokens it gives a value, so the base Theme's value stands for the rest. */
  schemes: Partial<Record<WorldScheme, WorldVars>>;
  /** A paper handout kept light in the dark set (house decision #203): the light set's palette, resolved. */
  handoutPaper?: WorldVars;
};

// The names a card re-declares from the palette (lantern's .parchment scope), and the band's ink. A light handout takes
// the palette alone, so the card reads its paper and ink from it as it does in the light set.
const SEMANTIC = new Set<string>([
  ...Object.keys(WORLD_COLOUR_SOURCES.light),
  ...Object.keys(WORLD_COLOUR_SOURCES.dark),
  "band-ink",
]);

const isToken = (name: string): name is (typeof WORLD_COLOUR_TOKENS)[number] =>
  (WORLD_COLOUR_TOKENS as readonly string[]).includes(name);

// A set's custom properties. Only the contract's tokens and six-digit hex values pass, since they land in a <style>.
function varsOf(set: Partial<Record<string, string>>): WorldVars {
  const vars: WorldVars = {};
  for (const [name, value] of Object.entries(set)) {
    if (isToken(name) && WorldColour.safeParse(value).success) vars[`--${name}`] = value!;
  }
  return vars;
}

/** What a room's wrapper needs to wear a World's Theme. Shapes and the texture the World leaves out are the first of
 * their list; typefaces it leaves out are not written, so the base faces stand. */
export function worldLook(theme: WorldTheme): WorldLook {
  const schemes: WorldLook["schemes"] = {};
  for (const scheme of WORLD_SCHEMES) {
    const set = theme.schemes[scheme];
    if (set) schemes[scheme] = varsOf(set);
  }
  const attributes: WorldAttributes = {
    "data-world": "",
    "data-schemes": WORLD_SCHEMES.filter((s) => schemes[s]).join(" "),
    "data-texture": theme.texture ?? WORLD_TEXTURES[0],
  };
  for (const shape of Object.keys(SHAPE_ATTRIBUTES) as WorldShape[]) {
    attributes[SHAPE_ATTRIBUTES[shape]] = theme.shapes[shape] ?? WORLD_SHAPES[shape][0];
  }
  for (const role of WORLD_TYPE_ROLES) {
    const face = theme.typefaces[role];
    if (face) attributes[TYPEFACE_ATTRIBUTES[role]] = face;
  }
  const light = theme.schemes.light;
  // ponytail: a World with no light set has no light paper to keep, so the pick draws nothing; the importer could refuse
  // that pairing once Worlds are edited in the app
  if (attributes["data-handout-paper"] !== "light" || !light) return { attributes, schemes };
  const all = worldColours({ scheme: "light", colours: light });
  const handoutPaper: WorldVars = {};
  for (const t of WORLD_COLOUR_TOKENS) if (!SEMANTIC.has(t)) handoutPaper[`--${t}`] = all[t];
  return { attributes, schemes, handoutPaper };
}

// The root wears the World's colours while a wrapper is on the page, so the page ground and the overscroll match it.
const ROOT = ":root:has([data-world])";
const block = (selector: string, scheme: WorldScheme, vars: WorldVars) =>
  `${selector}{color-scheme:${scheme};${Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("")}}`;

/**
 * The <style> text for a look's colours. A World with one set always shows it. With both, the device's pick on the root
 * (`data-scheme`, from the scheme cookie) wins, and without one the system setting does. Each set is declared alone,
 * so a token the dark set leaves out falls back to the base Theme, never to the light set's value.
 */
export function worldStyle(look: WorldLook): string {
  // A paper handout keeps the light set's card whichever set the root shows (house decision #203).
  const paper = look.handoutPaper
    ? `\n${block('[data-handout-paper="light"] .handout.parchment', "light", look.handoutPaper)}`
    : "";
  return setsStyle(look.schemes) + paper;
}

function setsStyle({ light, dark }: WorldLook["schemes"]): string {
  if (light && dark) {
    return [
      `@media (prefers-color-scheme: light){${block(':root:not([data-scheme="dark"]):has([data-world])', "light", light)}}`,
      block(':root[data-scheme="light"]:has([data-world])', "light", light),
      `@media (prefers-color-scheme: dark){${block(':root:not([data-scheme="light"]):has([data-world])', "dark", dark)}}`,
      block(':root[data-scheme="dark"]:has([data-world])', "dark", dark),
    ].join("\n");
  }
  return block(ROOT, light ? "light" : "dark", light ?? dark ?? {});
}
