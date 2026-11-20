import { z } from "zod";

import { RulesetId, SemVer, SemVerRange } from "./manifest.ts";

// A World: the look of one setting, as an imported document beside the ruleset and the pack (docs/adr/0010, decision
// 2). It holds values for the platform's Theme tokens and picks from the platform's own lists. It carries no code, no
// font file and no image: every typeface, texture and shape it names is drawn by the platform.
// This file is the contract: the token names and the lists. Terms and handout styles are not in it yet (issue #159).

/** The largest World document the importer reads. */
export const MAX_WORLD_BYTES = 64 * 1024;

/**
 * The colour tokens a World may give a value, by the names the base Themes declare (apps/web/app/theme/lantern.css;
 * a test holds this list equal to that file's colour tokens). The first group is the palette, the second the names the
 * components read. A token a World leaves out keeps the base value for that scheme.
 */
export const WORLD_COLOUR_TOKENS = [
  "wood-0",
  "wood",
  "wood-2",
  "wood-3",
  "brass",
  "brass-hi",
  "brass-lo",
  "brass-ink",
  "candle",
  "wax",
  "cream",
  "leaf",
  "moss",
  "parchment",
  "parchment-hi",
  "parchment-2",
  "parchment-ink",
  "parchment-ink-2",
  "parchment-line",
  "ink-blue",
  "halo-light",
  "halo-dark",
  "paper",
  "paper-2",
  "ink",
  "ink-2",
  "line",
  "band",
  "band-ink",
  "accent",
  "accent-ink",
  "ok",
  "link",
  "focus",
  "focus-halo",
] as const;
export type WorldColourToken = (typeof WORLD_COLOUR_TOKENS)[number];

/** The two colour sets. A World gives one or both; a device shows the one its own setting picks, when the World has it. */
export const WORLD_SCHEMES = ["light", "dark"] as const;
export type WorldScheme = (typeof WORLD_SCHEMES)[number];

/** The typefaces the platform loads. All are open-licensed and served by the app itself. */
export const WORLD_TYPEFACES = [
  "be-vietnam-pro",
  "fraunces",
  "literata",
  "cinzel",
  "crimson-pro",
  "ibm-plex-mono",
] as const;
export type WorldTypeface = (typeof WORLD_TYPEFACES)[number];
/** The three places a typeface is picked for: headings and labels, running text, and printed-out or machine text. */
export const WORLD_TYPE_ROLES = ["display", "body", "mono"] as const;
export type WorldTypeRole = (typeof WORLD_TYPE_ROLES)[number];

/** The ground the table lies on: planks, baize, or a flat page with a fine grain. Drawn in CSS, tinted by the tokens. */
export const WORLD_TEXTURES = ["wood", "baize", "paper"] as const;
export type WorldTexture = (typeof WORLD_TEXTURES)[number];

/** The shapes a World picks, each from the platform's own list. The first of each list is the base Theme's. */
export const WORLD_SHAPES = {
  /** Buttons, inputs and chips. */
  corners: ["soft", "square", "pill"],
  /** The outline of a card. */
  cardEdge: ["torn", "rounded", "square"],
  /** An ornament along a card's top edge. */
  cardCrest: ["none", "spiked"],
  /** The lower edge of a header band. */
  bandEdge: ["straight", "torn"],
  /** What follows a section heading. */
  headingRule: ["none", "line", "quill"],
  /** Headings, labels and buttons as written, or in tracked capitals. */
  headingCase: ["normal", "caps"],
  /** How a button is built. */
  buttonFrame: ["plate", "flat", "double"],
} as const;
export type WorldShape = keyof typeof WORLD_SHAPES;

/** A colour as a World writes it: an opaque six-digit hex. Nothing else, so contrast can be computed the same everywhere. */
export const WorldColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour like #1c1b1a");

const pick = <T extends readonly [string, ...string[]]>(list: T) => z.enum(list);
const shape = <K extends WorldShape>(k: K) =>
  pick(WORLD_SHAPES[k] as unknown as readonly [string, ...string[]]).optional();

export const WorldTheme = z.object({
  /** Colour values by token, for each set the World brings. At least one set. */
  schemes: z
    .object({
      light: z.partialRecord(z.enum(WORLD_COLOUR_TOKENS), WorldColour).optional(),
      dark: z.partialRecord(z.enum(WORLD_COLOUR_TOKENS), WorldColour).optional(),
    })
    .refine((s) => s.light !== undefined || s.dark !== undefined, "a World brings at least one colour set"),
  typefaces: z
    .object({
      display: pick(WORLD_TYPEFACES).optional(),
      body: pick(WORLD_TYPEFACES).optional(),
      mono: pick(WORLD_TYPEFACES).optional(),
    })
    .default({}),
  texture: pick(WORLD_TEXTURES).optional(),
  shapes: z
    .object({
      corners: shape("corners"),
      cardEdge: shape("cardEdge"),
      cardCrest: shape("cardCrest"),
      bandEdge: shape("bandEdge"),
      headingRule: shape("headingRule"),
      headingCase: shape("headingCase"),
      buttonFrame: shape("buttonFrame"),
    })
    .default({}),
});
export type WorldTheme = z.infer<typeof WorldTheme>;

export const World = z.object({
  /** The World's own id: one owner imports it under this slug, version after version. */
  id: RulesetId,
  version: SemVer,
  /** The core versions it was written for, as a ruleset's is. */
  core: SemVerRange,
  name: z.string().min(1).max(80),
  theme: WorldTheme,
});
export type World = z.infer<typeof World>;
export type WorldInput = z.input<typeof World>;

/**
 * The pairs that must stay readable, foreground on background, with the least contrast ratio for each (principle 8;
 * the same pairs and floors the base Themes are held to). They are checked for every set a World brings, on its values
 * laid over the base Theme's, on the table and inside a card.
 */
export const WORLD_CONTRAST_PAIRS = [
  { fg: "ink", bg: "paper", min: 4.5 },
  { fg: "ink", bg: "paper-2", min: 4.5 },
  { fg: "ink-2", bg: "paper", min: 4.5 },
  { fg: "ink-2", bg: "paper-2", min: 4.5 },
  { fg: "band-ink", bg: "band", min: 4.5 },
  { fg: "accent-ink", bg: "accent", min: 4.5 },
  { fg: "accent", bg: "paper", min: 4.5 },
  { fg: "link", bg: "paper", min: 4.5 },
  { fg: "ok", bg: "paper", min: 4.5 },
  { fg: "brass-ink", bg: "brass", min: 4.5 },
  { fg: "brass-ink", bg: "brass-hi", min: 4.5 },
  { fg: "parchment-ink", bg: "parchment", min: 4.5 },
  { fg: "parchment-ink", bg: "parchment-2", min: 4.5 },
  { fg: "parchment-ink-2", bg: "parchment", min: 4.5 },
  { fg: "focus", bg: "paper", min: 3 },
  { fg: "focus", bg: "focus-halo", min: 3 },
] as const satisfies readonly { fg: WorldColourToken; bg: WorldColourToken; min: number }[];
