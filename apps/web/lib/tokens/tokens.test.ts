import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import { WEB, customProps, merge, ratio, read, resolve, rulesOf, strip, type Rule } from "./css.ts";
import { TOKEN_NAMES, TOKENS } from "./tokens.ts";

// The Theme token contract. The seam is the shipped CSS text: a small parser reads it, so a Theme cannot rot unseen.

const lantern = rulesOf(read("app/theme/lantern.css"));
const felt = rulesOf(read("app/theme/felt.css"));
const globals = rulesOf(read("app/globals.css"));
const motion = rulesOf(read("app/theme/motion.css"));
const world = rulesOf(read("app/theme/world.css"));
const lanternRoot = lantern.find((r) => r.selector === ":root");
// felt steps aside on a page that wears a World (theme/world.css)
const FELT_ROOT = ":root.theme-felt:not(:has([data-world]))";
const feltRoot = felt.find((r) => r.selector === FELT_ROOT);
const cardScope = lantern.find((r) => r.selector.split(",").some((s) => s.trim() === ".parchment"));
assert.ok(lanternRoot && feltRoot && cardScope, "lantern :root, felt's root and the .parchment scope exist");

// Properties next/font injects on <html>; they are not the Theme's to declare.
const FONT_VARS = new Set([
  "--font-text",
  "--font-display-face",
  "--font-display-felt",
  "--font-cinzel",
  "--font-crimson-pro",
  "--font-ibm-plex-mono",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(new URL(dir, WEB), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => `${dir}${f.replaceAll("\\", "/")}`);
}

test("every var(--x) the app uses is declared by the base Theme", () => {
  const declared = new Set([
    ...customProps(lantern),
    ...customProps(motion),
    ...customProps(globals),
    ...customProps(world),
    ...FONT_VARS,
  ]);
  const missing: string[] = [];
  for (const file of [...sourceFiles("app/"), ...sourceFiles("components/")]) {
    const text = file.endsWith(".css") ? strip(read(file)) : read(file);
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!declared.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("felt re-maps every token the base Theme declares", () => {
  const base = customProps([lanternRoot!]);
  const remapped = customProps([feltRoot!]);
  assert.deepEqual(
    [...base].filter((t) => !remapped.has(t)),
    [],
  );
  assert.ok(base.size > 40, "the base Theme declares its tokens on :root");
});

test("motion.css declares the duration and easing tokens; felt and the TV re-map durations only", () => {
  const motionRoot = motion.find((r) => r.selector === ":root");
  const motionFelt = motion.find((r) => r.selector === FELT_ROOT);
  const motionTv = motion.find((r) => r.selector === '[data-density="tv"]');
  assert.ok(motionRoot && motionFelt && motionTv, "motion :root, felt and tv rules exist");
  const declared = customProps([motionRoot]);
  for (const t of [
    "dur-tap",
    "dur-quick",
    "dur-move",
    "dur-scene",
    "ease-out",
    "ease-in",
    "ease-glide",
    "ease-spring",
  ]) {
    assert.ok(declared.has(`--${t}`), `--${t} is declared in motion.css`);
  }
  for (const rule of [motionFelt, motionTv]) {
    assert.deepEqual(
      [...customProps([rule])].filter((t) => !declared.has(t) || t.startsWith("--ease")),
      [],
    );
  }
});

test("rules read durations and easings from the tokens: no literal time or cubic-bezier outside a keyframe", () => {
  const literal = /(?<![\w.-])\d*\.?\d+m?s\b|cubic-bezier/;
  const found = [...lantern, ...felt, ...globals, ...motion, ...world].flatMap((r) =>
    [...r.decls]
      .filter(([prop, value]) => !prop.startsWith("--") && literal.test(value))
      .map(([prop, value]) => `${r.selector} { ${prop}: ${value} }`),
  );
  assert.deepEqual(found, []);
});

// ---------- contrast ----------

// Text pairs (4.5:1) and the focus ring (3:1), per Theme and per context: the system light page, the dark page and the
// table, and anything inside a parchment card.
const TEXT_PAIRS: [string, string][] = [
  ["ink", "paper"],
  ["ink", "paper-2"],
  ["ink-2", "paper"],
  ["ink-2", "paper-2"],
  ["band-ink", "band"],
  ["accent-ink", "accent"],
  ["accent", "paper"],
  ["link", "paper"],
  ["ok", "paper"],
  ["plate-main-ink", "brass"],
  ["plate-main-ink", "brass-hi"],
  ["parchment-hi", "wood-3"],
];
const FOCUS_PAIRS: [string, string][] = [
  ["focus", "paper"],
  ["focus", "focus-halo"],
];

for (const [theme, rules] of [
  ["lantern", [lanternRoot!]],
  ["felt", [lanternRoot!, feltRoot!]],
] as const) {
  const root = merge(...rules);
  const contexts = [
    { name: "app, light", mode: "light" as const, decls: root },
    { name: "table and app, dark", mode: "dark" as const, decls: root },
    { name: "parchment card", mode: "light" as const, decls: merge(...rules, cardScope!) },
  ];
  test(`${theme}: body text meets 4.5:1 and the focus ring 3:1 in every context`, () => {
    const failures: string[] = [];
    for (const c of contexts) {
      const colour = (token: string) => resolve({ value: `var(--${token})`, decls: c.decls, mode: c.mode });
      for (const [fg, bg] of TEXT_PAIRS) {
        const r = ratio(colour(fg), colour(bg));
        if (r < 4.5) failures.push(`${theme} / ${c.name}: ${fg} on ${bg} is ${r.toFixed(2)}`);
      }
      for (const [fg, bg] of FOCUS_PAIRS) {
        const r = ratio(colour(fg), colour(bg));
        if (r < 3) failures.push(`${theme} / ${c.name}: focus ring ${fg} on ${bg} is ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}

// ---------- mirrors and house rules ----------

test("tokens.ts mirrors the base Theme values it claims to", () => {
  const css = read("app/theme/lantern.css");
  for (const [key, value] of Object.entries(TOKENS)) {
    const name = TOKEN_NAMES[key as keyof typeof TOKENS];
    assert.match(css, new RegExp(`--${name}: ${value};`), `${key} mirrors --${name}`);
  }
});

test("the style guide's floors hold: no hex in TSX, text of at least 12px", () => {
  const hexInTsx = sourceFiles("components/")
    .concat(sourceFiles("app/"))
    .filter((f) => f.endsWith(".tsx") && /["'`]#[0-9a-f]{3,8}\b/i.test(read(f)));
  assert.deepEqual(hexInTsx, []);
  const small = [...strip(read("app/globals.css")).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter(
    (m) => Number(m[1]) < 12,
  );
  assert.deepEqual(
    small.map((m) => m[0]),
    [],
  );
});

// ---------- what a World can reach (#235): a screen paints from the tokens, or from a listed exemption ----------

// The CSS named colours a value could paint with (the common ones; `transparent` and `currentColor` take no colour).
const NAMED =
  "white|black|red|green|blue|yellow|orange|purple|pink|brown|gr[ae]y|silver|gold|maroon|navy|teal|olive|lime|aqua|" +
  "cyan|magenta|fuchsia|ivory|beige|crimson|indigo|violet|tan|khaki|salmon|coral|tomato|wheat|snow|linen";
// A colour a World cannot reach: hex (also %23-encoded in a data URI), any colour function but black or grey shades,
// a named colour, or an SVG fill or stroke written into a data URI. Token references are read out first.
const PLAIN_COLOUR = new RegExp(
  [
    "#[0-9a-f]{3,8}\\b",
    "%23[0-9a-f]{3,8}\\b",
    "\\brgba?\\((?!\\s*0 0 0\\b|\\s*128 128 128\\b)",
    "\\b(?:hsla?|hwb|oklch|oklab|lab|lch)\\(",
    "\\bcolor\\(",
    `(?:^|[\\s,(])(?:${NAMED})(?=$|[\\s,)])`,
    "(?:fill|stroke)=['\"](?!none|currentColor)",
  ].join("|"),
  "i",
);
const withoutTokens = (value: string) => value.replace(/var\(--[\w-]+\)/g, "");
const plainColour = ({ prop, value }: { prop: string; value: string }) =>
  // a mask's shape is painted by the element's own colour, whatever its SVG fills say
  !prop.startsWith("mask") && PLAIN_COLOUR.test(withoutTokens(value));
// The safety screen is plain black and white on purpose: it must look the same in every Theme and every World.
const PLAIN_ON_PURPOSE = new Set([".xcard", ".xcard-mark"]);

test("the plain-colour guard catches every way a literal colour can be written", () => {
  for (const value of [
    "#c0ffee",
    "1px solid #abc",
    "rgb(255 0 0 / 0.5)",
    "hsl(20 50% 40%)",
    "oklch(0.7 0.1 30)",
    "color(srgb 1 0 0)",
    "white",
    "0 0 4px grey",
    "url(\"data:image/svg+xml,%3Csvg fill='%23ff0000'%3E\")",
    "url(\"data:image/svg+xml,<svg fill='red'>\")",
    "linear-gradient(red, var(--paper))",
  ]) {
    assert.ok(plainColour({ prop: "background", value }), `caught: ${value}`);
  }
  for (const value of ["var(--marker-red)", "rgb(0 0 0 / 0.5)", "transparent", "currentColor", "solid var(--line)"]) {
    assert.ok(!plainColour({ prop: "background", value }), `passed: ${value}`);
  }
  assert.ok(!plainColour({ prop: "mask", value: "url(\"data:image/svg+xml,<svg fill='black'>\")" }));
});

test("globals.css paints no literal colour a World cannot reach: only black and grey shades, and the safety screen", () => {
  const found = globals.flatMap((r) =>
    r.selector.split(",").every((s) => PLAIN_ON_PURPOSE.has(s.trim()))
      ? []
      : [...r.decls]
          .filter(([prop, value]) => plainColour({ prop, value }))
          .map(([prop, value]) => `${r.selector} { ${prop}: ${value} }`),
  );
  assert.deepEqual(found, []);
});

// A fixed rounding: a length over 4px (rem and em at 16px), or a percentage other than a circle's 50%. A pill (999px)
// and a cap on a token (min(var(--radius-btn), 10px)) are not fixed.
function fixedRadius(value: string): boolean {
  if (/\b999px|var\(--radius/.test(value)) return false;
  return [...value.matchAll(/(\d*\.?\d+)(px|rem|em|%)/g)].some(([, n, unit]) =>
    unit === "%" ? Number(n) !== 50 : Number(n) * (unit === "px" ? 1 : 16) > 4,
  );
}

test("the radius guard catches a fixed rounding in any unit", () => {
  for (const value of ["8px", "0.5rem", "1em", "20%", "4px 12px 0 0"])
    assert.ok(fixedRadius(value), `caught: ${value}`);
  for (const value of ["2px", "4px", "50%", "999px", "var(--radius-md)", "min(var(--radius-btn), 10px)", "0"]) {
    assert.ok(!fixedRadius(value), `passed: ${value}`);
  }
});

test("rounded boxes read the radius tokens, so a World's square corners reach them: no fixed radius", () => {
  const found = globals.flatMap((r) =>
    [...r.decls]
      .filter(([prop, value]) => /^border(-[\w-]+)?-radius$/.test(prop) && fixedRadius(value))
      .map(([prop, value]) => `${r.selector} { ${prop}: ${value} }`),
  );
  assert.deepEqual(found, []);
});

// Every `style={{ ... }}` object in a TSX text, read to its closing brace by depth (a template literal's ${} included).
function styleObjects(text: string): string[] {
  const out: string[] = [];
  for (let at = text.indexOf("style={{"); at >= 0; at = text.indexOf("style={{", at + 1)) {
    let depth = 0;
    let i = at + "style=".length;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    out.push(text.slice(at, i + 1));
  }
  return out;
}
// A style that sets a size or a colour a World cannot reach: a number or a numeric string for a font size, a literal
// colour or a gradient in a string for any painting property.
const literalStyle = (style: string) =>
  /fontSize:\s*["'`]?\d/.test(style) ||
  [
    ...style.matchAll(/(?:color|background\w*|border\w*|outline\w*|fill|stroke|\w*[sS]hadow):\s*(["'`])([^"'`]*)\1/g),
  ].some(([, , value]) => PLAIN_COLOUR.test(withoutTokens(value!)) || /gradient\(/.test(value!));

test("the inline-style guard catches sizes and colours written in any form", () => {
  for (const style of [
    "style={{ fontSize: 22 }}",
    'style={{ fontSize: "22px" }}',
    "style={{ fontSize: `1.4rem` }}",
    'style={{ color: "white" }}',
    'style={{ background: "oklch(0.7 0.1 30)" }}',
    'style={{ backgroundImage: "linear-gradient(var(--paper), var(--ink))" }}',
    'style={{ borderColor: "#fff", width: `${n}px` }}',
  ]) {
    assert.ok(literalStyle(style), `caught: ${style}`);
  }
  assert.deepEqual(styleObjects("<i style={{ width: `${a}px`, color: 'red' }} />"), [
    "style={{ width: `${a}px`, color: 'red' }}",
  ]);
  for (const style of ['style={{ fontSize: "var(--fs-name)" }}', 'style={{ color: "var(--ink)", gap: 6 }}']) {
    assert.ok(!literalStyle(style), `passed: ${style}`);
  }
});

test("inline styles in TSX read tokens: no numeric font size, no literal colour", () => {
  const found = [...sourceFiles("components/"), ...sourceFiles("app/")]
    .filter((f) => f.endsWith(".tsx"))
    .flatMap((f) =>
      styleObjects(read(f))
        .filter(literalStyle)
        .map((s) => `${f}: ${s}`),
    );
  assert.deepEqual(found, []);
});

// The palette names (wood, brass, candle, wax ...) are lantern's own materials. A rule that paints with one is restyled
// under a World: a theme/world.css rule whose selector names every class of the base selector (and its pseudo-element)
// sets the same property, or a longhand or shorthand of it. Otherwise the selector is listed here with why it may keep
// the material.
const PALETTE = /var\(--(wood(-\d)?|brass(-\w+)?|candle|wax|cream|leaf|moss|parchment(-[\w-]+)?|ink-blue|halo-\w+)\)/;
const OUTSIDE_ROOMS = "the workspace shell is outside every room, so no World reaches it";
const KEEPS_ITS_MATERIAL: Record<string, string> = {
  ".tabs-bottom": "is also a .tabs, whose outline world.css restyles",
  '.clock-face[data-full="true"] .clock-wedge.lit':
    "a full clock is a state: its lit wedges keep the candle and the wax",
  ".clock-wedge.lit": "a lit wedge is the clock's state, in the candle",
  ".term.chip": "a term chip lies in a card and reads the card's own line, which a World sets",
  '.game-card[aria-pressed="true"]': "the picked card's outline is a state, in the main action's colour",
  '.combatant[data-selected="true"]': "the selected row's dashed outline is a state, in the main action's colour",
  '.btn[data-attention="true"]': "the attention outline is a state, in the main action's colour",
  '.tab[aria-selected="true"]': "the open tab is the main action's state: brass, which a World sets",
  ".btn.primary": "the main action, in brass, which a World sets",
  ".combatant": 'the acting glow is the candle, which a World sets ("now")',
  '.combatant[data-acting="true"]': 'the acting glow is the candle, which a World sets ("now")',
  '.combatant[data-acting="true"]::before': 'the acting ring is the main action\'s brass and the candle ("now")',
  ".fightbar .round": 'the round number is the candle on the band ("now")',
  ".spend-notice": 'its stripe is the candle on the band ("now")',
  '.spend-notice[data-status="denied"]': "a refusal's stripe is the wax, the accent's material",
  ".badge-offline": "brass-ink on brass, the main action's pair",
  ".outcome-criticalSuccess": "a critical success's double rule is the main action's brass",
  ".roll-key.report": "the report key is the main action, in brass",
  ".bottom-sheet": "its fill below the fold is the card's own paper, which a World sets",
  ".spotlight-sheet":
    "the shown card's ink is the card's own (on --bg-card), which a World sets; world.css restyles its rule",
  ".combatant .chip": "a chip in a card reads the card's own line, which a World sets",
  ".card .chip": "a chip in a card reads the card's own line; world.css's [data-world] .chip rule outranks it",
  '.chip[data-live="true"]::before': "the live dot's ring is the ok colour's own leaf, which a World sets",
  ".combatant::before": "the slip's edge is the card's own line, which a World sets",
  ".ws-brand": OUTSIDE_ROOMS,
  ".ws-nav": OUTSIDE_ROOMS,
  ".ws-foot": OUTSIDE_ROOMS,
  ".ws-mark": OUTSIDE_ROOMS,
  ".ws-link:hover": OUTSIDE_ROOMS,
  '.ws-link[aria-current="page"]': OUTSIDE_ROOMS,
  ".ws-count": OUTSIDE_ROOMS,
  '.ws-link[aria-current="page"] .ws-count': OUTSIDE_ROOMS,
  ".ws-tile:hover::before": OUTSIDE_ROOMS,
  ".ws-rail": OUTSIDE_ROOMS,
};

// A selector list split at its top-level commas (an :is(...) list stays whole).
function selectorItems(selector: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")") depth--;
    else if (selector[i] === "," && depth === 0) {
      items.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  return [...items, selector.slice(start).trim()];
}
const classesOf = (selector: string) => [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
const pseudoOf = (selector: string) => /::(before|after)/.exec(selector)?.[1];
// "border-bottom" and "border-color" both paint a border; "box-shadow" a shadow: the family is the first word.
const family = (prop: string) => prop.split("-")[0];

/** Whether a World rule restyles this base selector's painting of `prop`. */
function restyled({ selector, prop, world }: { selector: string; prop: string; world: Rule[] }): boolean {
  const classes = classesOf(selector);
  return world.some(
    (w) =>
      [...w.decls.keys()].some((p) => !p.startsWith("--") && family(p) === family(prop)) &&
      selectorItems(w.selector).some(
        (item) =>
          pseudoOf(item) === pseudoOf(selector) && classes.every((c) => new RegExp(`\\.${c}(?![\\w-])`).test(item)),
      ),
  );
}

test("the restyle guard needs every class, the same pseudo-element and the same property, never a mention", () => {
  const world = rulesOf(`/* .reminders is restyled */
    [data-world] :is(.band, .reminders-list) { border-left-color: var(--line); }
    [data-world] .card .chip { color: var(--ink); }
    [data-world] .chip::after { background: var(--line); }`);
  assert.ok(!restyled({ selector: ".reminders", prop: "border-left", world }), "a comment or a prefix is no restyle");
  assert.ok(restyled({ selector: ".band", prop: "border-bottom", world }), "a border longhand restyles a border");
  assert.ok(!restyled({ selector: ".band", prop: "background", world }), "another property is no restyle");
  assert.ok(!restyled({ selector: ".combatant .chip", prop: "color", world }), "every class of the base selector");
  assert.ok(restyled({ selector: ".card .chip", prop: "color", world }));
  assert.ok(!restyled({ selector: ".chip::before", prop: "background", world }), "the same pseudo-element");
});

// The TV's creature card is itself a .sheet-card, so its name (.head.stat-title) is a section head too: a stat block's
// band rules for section heads must leave the title alone, or they outrank its bar (house decision #219).
const bandsTheTitle = (selector: string) =>
  selectorItems(selector).some(
    (item) => item.includes(".stat-block") && /\.head(?![\w-])(?!:not\(\.stat-title\))/.test(item),
  );

test("a stat block's section-head rules never reach its title", () => {
  assert.ok(bandsTheTitle('[data-stat-block="printed"] .stat-block :is(.sheet-card > .head, .w-label)'));
  assert.ok(!bandsTheTitle('[data-stat-block="printed"] .stat-block :is(.sheet-card > .head:not(.stat-title))'));
  assert.deepEqual(
    world.filter((r) => bandsTheTitle(r.selector)).map((r) => r.selector),
    [],
  );
});

test("a rule that paints with lantern's palette is restyled under a World, or listed with its reason", () => {
  const found = new Set<string>();
  for (const r of globals) {
    for (const [prop, value] of r.decls) {
      if (prop.startsWith("--") || !PALETTE.test(value)) continue;
      for (const s of selectorItems(r.selector)) {
        if (classesOf(s).length > 0 && !(s in KEEPS_ITS_MATERIAL) && !restyled({ selector: s, prop, world })) {
          found.add(`${s} { ${prop} }`);
        }
      }
    }
  }
  assert.deepEqual([...found], []);
});

test("a plate on a light app page carries the page's ink (the admin console's buttons, #235)", () => {
  for (const [theme, rules] of [
    ["lantern", [lanternRoot!]],
    ["felt", [lanternRoot!, feltRoot!]],
  ] as const) {
    const decls = merge(...rules);
    const ink = resolve({ value: "var(--ink)", decls, mode: "light" });
    const plate = resolve({ value: "var(--plate)", decls, mode: "light" });
    const stops = plate.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    assert.ok(stops.length > 0, `${theme}: the light plate resolves to colours, got ${plate}`);
    for (const stop of stops) assert.ok(ratio(ink, stop) >= 4.5, `${theme}: ink on the light plate's ${stop}`);
  }
});
