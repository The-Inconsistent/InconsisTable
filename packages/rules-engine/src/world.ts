import { z } from "zod";

import { byteSize, RulesetId, SemVer, SemVerRange } from "./manifest.ts";
import { canonicalJson, sha256Hex } from "./pack-hash.ts";
import { formatPath, type Problem } from "./problem.ts";

// A World: the look of one setting, as an imported document beside the ruleset and the pack (docs/adr/0010, decision
// 2). It holds values for the platform's Theme tokens and picks from the platform's own lists. It carries no code, no
// font file and no image: every typeface, texture and shape it names is drawn by the platform.
// This file is the contract: the token names and the lists. Terms are not in it yet (issue #159).

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
  "side-ally",
  "side-foe",
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
  /** A handout's paper in the dark set: the set's own card, or the World's light card kept (house decision #203). */
  handoutPaper: ["follow", "light"],
  /** The phone's readouts (its strip, the fight plate): the band, or a slate (house decision #204). */
  readout: ["plain", "slate"],
  /** What marks GM-only content: nothing, a spiked crest bar, or the bar with a winged skull (house decision #205). */
  gmSeal: ["none", "crest", "skull"],
  /** The header row of a sheet's grid and card list: the page's ink, or the band (house decision #206). */
  tableHead: ["plain", "band"],
} as const;
export type WorldShape = keyof typeof WORLD_SHAPES;

/**
 * The handout layouts the platform draws with the room's Theme (house decision #72). Each describes a layout, never a
 * setting: a screen readout, a ruled form, a recorded message in lines, a framed public notice. `plain` is always
 * offered. packages/core-schema repeats this list for the entry (`HandoutLayout`); the vectors hold both equal.
 */
export const HANDOUT_LAYOUTS = ["plain", "tablet", "form", "transcript", "proclamation"] as const;
export type HandoutLayoutId = (typeof HANDOUT_LAYOUTS)[number];
/** The longest name a World gives one of the layouts. */
export const MAX_HANDOUT_LAYOUT_NAME = 40;

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
      handoutPaper: shape("handoutPaper"),
      readout: shape("readout"),
      gmSeal: shape("gmSeal"),
      tableHead: shape("tableHead"),
    })
    .default({}),
});
export type WorldTheme = z.infer<typeof WorldTheme>;

/** Which of the platform's handout layouts the setting offers, in its picker's order, and its own names for them. */
export const WorldHandouts = z.object({
  layouts: z
    .array(z.enum(HANDOUT_LAYOUTS))
    .min(1)
    .max(HANDOUT_LAYOUTS.length)
    .refine((l) => new Set(l).size === l.length, "a layout is listed twice"),
  names: z.partialRecord(z.enum(HANDOUT_LAYOUTS), z.string().min(1).max(MAX_HANDOUT_LAYOUT_NAME)).default({}),
});
export type WorldHandouts = z.infer<typeof WorldHandouts>;

export const World = z.object({
  /** The World's own id: one owner imports it under this slug, version after version. */
  id: RulesetId,
  version: SemVer,
  /** The core versions it was written for, as a ruleset's is. */
  core: SemVerRange,
  name: z.string().min(1).max(80),
  theme: WorldTheme,
  /** Absent: every layout under the platform's names. */
  handouts: WorldHandouts.optional(),
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

/**
 * The slate readout's scanlines (house decision #204) mix 4% of the band's ink into the band under text: a World that
 * picks it holds the band's pair to 5:1, so a line keeps at least 4.5:1.
 */
export const WORLD_SLATE_PAIR = { fg: "band-ink", bg: "band", min: 5 } as const satisfies {
  fg: WorldColourToken;
  bg: WorldColourToken;
  min: number;
};

// ---------- the base values, the contrast check, the validator and the hash (house decision #65) ----------

// The palette is declared once in lantern.css, so it is the same in both sets.
const BASE_PALETTE = {
  "wood-0": "#170d07",
  wood: "#2a1a10",
  "wood-2": "#3b2517",
  "wood-3": "#52341f",
  brass: "#c99a3e",
  "brass-hi": "#f0c870",
  "brass-lo": "#8a6322",
  "brass-ink": "#251509",
  candle: "#ffb64f",
  wax: "#9c2f23",
  cream: "#fff6e2",
  leaf: "#3e6a2a",
  moss: "#a6d68e",
  parchment: "#f2e5c6",
  "parchment-hi": "#f9f0da",
  "parchment-2": "#e7d5ad",
  "parchment-ink": "#2a1b10",
  "parchment-ink-2": "#5a4430",
  "parchment-line": "#b59a68",
  "ink-blue": "#123a8f",
  "halo-light": "#fff3cf",
  "halo-dark": "#120a05",
  // the two sides of a fight on the phone's order (house decision #207), tuned for a card, which lantern keeps light
  "side-ally": "#2f5f9e",
  "side-foe": "#b3541e",
} as const;

/**
 * The base Theme's value of every colour token, per set, as apps/web/app/theme/lantern.css resolves it on :root (a
 * test under apps/web/lib/tokens holds this table equal to that file). A World's values are laid over these.
 */
export const WORLD_BASE_COLOURS: Record<WorldScheme, Record<WorldColourToken, string>> = {
  light: {
    ...BASE_PALETTE,
    paper: "#f2e5c6",
    "paper-2": "#e7d5ad",
    ink: "#2a1b10",
    "ink-2": "#5a4430",
    line: "#b59a68",
    band: "#170d07",
    "band-ink": "#f4e8cd",
    accent: "#9c2f23",
    "accent-ink": "#fff6e2",
    ok: "#3e6a2a",
    link: "#9c2f23",
    focus: "#123a8f",
    "focus-halo": "#fff3cf",
  },
  dark: {
    ...BASE_PALETTE,
    paper: "#2a1a10",
    "paper-2": "#3b2517",
    ink: "#f4e8cd",
    "ink-2": "#d2bf99",
    line: "#7d5d34",
    band: "#170d07",
    "band-ink": "#f4e8cd",
    accent: "#c99a3e",
    "accent-ink": "#251509",
    ok: "#a6d68e",
    link: "#f0c870",
    focus: "#f0c870",
    "focus-halo": "#120a05",
  },
};

/**
 * Which palette name each semantic name reads in each set, as lantern.css writes it (`--paper: light-dark(
 * var(--parchment), var(--wood))`). A semantic name missing here holds its own value in that set (`--ink` in the dark).
 * So a World that sets only `parchment` moves the light `paper` too, unless it sets `paper` itself.
 */
export const WORLD_COLOUR_SOURCES: Record<WorldScheme, Partial<Record<WorldColourToken, WorldColourToken>>> = {
  light: {
    paper: "parchment",
    "paper-2": "parchment-2",
    ink: "parchment-ink",
    "ink-2": "parchment-ink-2",
    line: "parchment-line",
    band: "wood-0",
    accent: "wax",
    "accent-ink": "cream",
    ok: "leaf",
    link: "wax",
    focus: "ink-blue",
    "focus-halo": "halo-light",
  },
  dark: {
    paper: "wood",
    "paper-2": "wood-2",
    band: "wood-0",
    accent: "brass",
    "accent-ink": "brass-ink",
    ok: "moss",
    link: "brass-hi",
    focus: "brass-hi",
    "focus-halo": "halo-dark",
  },
};

/** Every colour token of one set: a World's values laid over the base, the semantic names resolved as the base does. */
export function worldColours({
  scheme,
  colours,
}: {
  scheme: WorldScheme;
  colours: Partial<Record<WorldColourToken, string>>;
}): Record<WorldColourToken, string> {
  const base = WORLD_BASE_COLOURS[scheme];
  const sources = WORLD_COLOUR_SOURCES[scheme];
  const own = (t: WorldColourToken) => colours[t] ?? base[t];
  return Object.fromEntries(
    WORLD_COLOUR_TOKENS.map((t) => {
      const source = sources[t];
      return [t, colours[t] ?? (source === undefined ? base[t] : own(source))];
    }),
  ) as Record<WorldColourToken, string>;
}

// The contrast ratio in integers, so the Go twin (internal/engine/world.go) gets the same number to the last digit:
// each channel's linear value is rounded to millionths once, in this table, and everything after is exact integer
// arithmetic (the largest product stays under 2^53). The vectors hold both tables equal.
/** sRGB channel 0..255 → its linear value in millionths (the WCAG 2 formula, as lib/tokens/tokens.test.ts computes it). */
export const WORLD_LINEAR: readonly number[] = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round(1e6 * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
});
// Luminance in ten-billionths: 2126 + 7152 + 722 = 10000 times the linear millionths. 0.05 of that scale is the flare.
const FLARE = 500_000_000;
const luminance = (hex: string) =>
  2126 * (WORLD_LINEAR[parseInt(hex.slice(1, 3), 16)] ?? 0) +
  7152 * (WORLD_LINEAR[parseInt(hex.slice(3, 5), 16)] ?? 0) +
  722 * (WORLD_LINEAR[parseInt(hex.slice(5, 7), 16)] ?? 0);

/** The WCAG contrast ratio of two six-digit hex colours in hundredths, rounded down (so 4.4999 is 449, never 450). */
export function contrastHundredths(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  // Both sides are integers under 2^53 and the quotient is never within an ulp of the next integer, so floor is exact.
  return Math.floor(((hi + FLARE) * 100) / (lo + FLARE));
}

/** The ratio as the problem text writes it: hundredths with two decimals, "4.49". */
const hundredths = (h: number) => `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`;

/** Each pair of `WORLD_CONTRAST_PAIRS` under its floor, for every set the World brings. */
export function contrastProblems(theme: WorldTheme): Problem[] {
  return WORLD_SCHEMES.flatMap((scheme) => {
    const set = theme.schemes[scheme];
    if (set === undefined) return [];
    const colour = worldColours({ scheme, colours: set });
    const pairs = theme.shapes.readout === "slate" ? [...WORLD_CONTRAST_PAIRS, WORLD_SLATE_PAIR] : WORLD_CONTRAST_PAIRS;
    return pairs.flatMap(({ fg, bg, min }) => {
      const h = contrastHundredths(colour[fg], colour[bg]);
      return h >= min * 100
        ? []
        : [{ path: `theme.schemes.${scheme}`, message: `"${fg}" on "${bg}" is ${hundredths(h)}:1, under ${min}:1` }];
    });
  });
}

export type WorldResult = { ok: true; world: World } | { ok: false; problems: Problem[] };

/**
 * Size cap (as serialised), schema, then the contrast every set the World brings must keep. `core` is checked as a
 * ruleset's is: by the shape of its range. The Go twin is `engine.ValidateWorld`.
 */
export function validateWorld(input: unknown): WorldResult {
  const size = byteSize(input);
  if (size === null) return { ok: false, problems: [{ path: "(root)", message: "not a JSON document" }] };
  if (size > MAX_WORLD_BYTES) {
    return { ok: false, problems: [{ path: "(root)", message: `${size} bytes, over the cap of ${MAX_WORLD_BYTES}` }] };
  }
  const parsed = World.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  const problems = contrastProblems(parsed.data.theme);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, world: parsed.data };
}

/** The hash a World version is stored under: of the canonical parsed document, defaults applied, as a ruleset's is. */
export function worldHash(world: World): string {
  return sha256Hex(canonicalJson(world));
}
