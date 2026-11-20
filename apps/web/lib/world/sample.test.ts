import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WORLD_CONTRAST_PAIRS,
  WORLD_SCHEMES,
  WORLD_SHAPES,
  WORLD_TEXTURES,
  WORLD_TYPEFACES,
} from "@inconsistable/rules-engine";

import { merge, ratio, read, resolve, rulesOf, type Rule } from "../tokens/css.ts";
import { SAMPLE_WORLDS } from "./sample.ts";
import { SHAPE_ATTRIBUTES, TYPEFACE_ATTRIBUTES, worldLook } from "./world.ts";

const lantern = rulesOf(read("app/theme/lantern.css"));
const world = rulesOf(read("app/theme/world.css"));
const lanternRoot = lantern.find((r) => r.selector === ":root");
const cardScope = lantern.find((r) => r.selector.split(",").some((s) => s.trim() === ".parchment"));
// The table's chrome (band, tabs, fight bar ...) re-declares the semantic names as the band's.
const bandScope = world.find((r) => r.selector.includes(".band,") && r.decls.get("--paper") === "var(--band)");
assert.ok(lanternRoot && cardScope && bandScope, "lantern :root, the card scope and the band scope exist");

test("every member of every list in the World contract has a rule keyed on its attribute", () => {
  const keyed = (attribute: string, value: string) =>
    world.some((r: Rule) => r.selector.includes(`[${attribute}="${value}"]`) && r.decls.size > 0);
  const missing: string[] = [];
  const lists: [string, readonly string[]][] = [
    ["data-texture", WORLD_TEXTURES],
    ...Object.entries(SHAPE_ATTRIBUTES).map(
      ([shape, attribute]) =>
        [attribute, WORLD_SHAPES[shape as keyof typeof WORLD_SHAPES]] as [string, readonly string[]],
    ),
    ...Object.values(TYPEFACE_ATTRIBUTES).map(
      (attribute) => [attribute, WORLD_TYPEFACES] as [string, readonly string[]],
    ),
  ];
  for (const [attribute, values] of lists) {
    for (const value of values) if (!keyed(attribute, value)) missing.push(`${attribute}="${value}"`);
  }
  assert.deepEqual(missing, []);
});

// What each button frame, a chip, the pressed toggle and the focus ring draw on, beyond the contract's own pairs: the
// plate, flat and double grounds are the page's two surfaces under ink, the main action is brass under brass-ink.
const DRAWN_PAIRS = [
  { fg: "ink", bg: "paper", min: 4.5 },
  { fg: "ink", bg: "paper-2", min: 4.5 },
  { fg: "brass-ink", bg: "brass", min: 4.5 },
  { fg: "brass-ink", bg: "brass-hi", min: 4.5 },
  { fg: "focus", bg: "paper", min: 3 },
  { fg: "focus", bg: "focus-halo", min: 3 },
] as const;

for (const [name, theme] of Object.entries(SAMPLE_WORLDS)) {
  test(`${name}: the contrast pairs hold in each set it brings, on the table, inside a card and on the band`, () => {
    const look = worldLook(theme);
    const failures: string[] = [];
    for (const scheme of WORLD_SCHEMES) {
      const set = look.schemes[scheme];
      if (!set) continue;
      const own = { selector: name, decls: new Map(Object.entries(set)) };
      const contexts = [
        { name: "table", decls: merge(lanternRoot!, own), pairs: [...WORLD_CONTRAST_PAIRS, ...DRAWN_PAIRS] },
        { name: "card", decls: merge(lanternRoot!, own, cardScope!), pairs: [...WORLD_CONTRAST_PAIRS, ...DRAWN_PAIRS] },
        { name: "band", decls: merge(lanternRoot!, own, bandScope!), pairs: DRAWN_PAIRS },
      ];
      for (const c of contexts) {
        const colour = (token: string) => resolve({ value: `var(--${token})`, decls: c.decls, mode: scheme });
        for (const { fg, bg, min } of c.pairs) {
          const r = ratio(colour(fg), colour(bg));
          if (r < min) failures.push(`${scheme} / ${c.name}: ${fg} on ${bg} is ${r.toFixed(2)}`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });
}

test("the cold World has dark cards in its dark set and light ones in its light set", () => {
  const { light, dark } = worldLook(SAMPLE_WORLDS.hoarfrost).schemes;
  const lum = (hex: string) =>
    parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5), 16);
  assert.ok(lum(light!["--parchment-hi"]!) > 600 && lum(dark!["--parchment-hi"]!) < 200);
});
