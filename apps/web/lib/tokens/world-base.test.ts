import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORLD_BASE_COLOURS,
  WORLD_COLOUR_SOURCES,
  WORLD_COLOUR_TOKENS,
  WORLD_SCHEMES,
  type WorldColourToken,
} from "@inconsistable/rules-engine";

// The engine judges a World's contrast against its own copy of the base Theme's colours (house decision #65). This holds
// that copy, and the list of tokens a World may set, equal to the shipped lantern.css, so neither can drift from it.

const css = readFileSync(new URL("../../app/theme/lantern.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const rootBody = /(?:^|\})\s*:root\s*\{([^}]*)\}/.exec(css)?.[1];
assert.ok(rootBody, "lantern.css declares :root");
const root = new Map(
  rootBody
    .split(";")
    .map((d) => d.split(/:(.*)/s).map((s) => s.trim()))
    .filter(([name]) => name?.startsWith("--"))
    .map(([name, value]) => [name!.slice(2), value!]),
);

// One step of a declaration in a set: light-dark(a, b) picks its side, var(--x) names the token it reads.
const side = (value: string, scheme: "light" | "dark") => {
  const m = /^light-dark\((.*)\)$/s.exec(value);
  if (!m) return value;
  const [a, b] = m[1]!.split(/,(?![^(]*\))/).map((s) => s.trim());
  return scheme === "light" ? a! : b!;
};
const readsFrom = (value: string) => /^var\(--([\w-]+)\)$/.exec(value)?.[1];
const resolve = (token: string, scheme: "light" | "dark"): string => {
  const value = side(root.get(token) ?? `?${token}`, scheme);
  const from = readsFrom(value);
  return from === undefined ? value : resolve(from, scheme);
};

test("every colour token lantern.css declares is one a World may set", () => {
  const colourTokens = [...root]
    .filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v) || v.startsWith("light-dark("))
    .map(([n]) => n);
  const listed = new Set<string>(WORLD_COLOUR_TOKENS);
  assert.deepEqual(
    colourTokens.filter((t) => !listed.has(t)),
    [],
  );
});

test("the engine's base colours are lantern.css's, set by set", () => {
  for (const scheme of WORLD_SCHEMES) {
    const fromCss = Object.fromEntries(WORLD_COLOUR_TOKENS.map((t) => [t, resolve(t, scheme).toLowerCase()]));
    assert.deepEqual(fromCss, WORLD_BASE_COLOURS[scheme], `the ${scheme} set`);
  }
});

test("the engine reads each semantic name from the palette name lantern.css does", () => {
  for (const scheme of WORLD_SCHEMES) {
    const fromCss: Partial<Record<WorldColourToken, string>> = {};
    for (const t of WORLD_COLOUR_TOKENS) {
      const from = readsFrom(side(root.get(t) ?? "", scheme));
      if (from !== undefined) fromCss[t] = from;
    }
    assert.deepEqual(fromCss, WORLD_COLOUR_SOURCES[scheme], `the ${scheme} set`);
  }
});
