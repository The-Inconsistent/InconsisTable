import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { TOKEN_NAMES, TOKENS } from "./tokens.ts";

// The Theme token contract. The seam is the shipped CSS text: a small parser reads it, so a Theme cannot rot unseen.

const WEB = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, WEB), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { selector: string; decls: Map<string, string> };

// Every rule with declarations, at any @media depth. A rule's body is read up to its closing brace.
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const head = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media") || head.startsWith("@supports")) walk(body);
      else if (!head.startsWith("@")) {
        const decls = new Map<string, string>();
        for (const d of body.split(";")) {
          const colon = d.indexOf(":");
          if (colon > 0) decls.set(d.slice(0, colon).trim(), d.slice(colon + 1).trim());
        }
        out.push({ selector: head, decls });
      }
      i = j;
    }
  };
  walk(strip(css));
  return out;
}

const customProps = (rules: Rule[]) =>
  new Set(rules.flatMap((r) => [...r.decls.keys()].filter((k) => k.startsWith("--"))));
const merge = (...rules: Rule[]) => new Map(rules.flatMap((r) => [...r.decls]));

const lantern = rulesOf(read("app/theme/lantern.css"));
const felt = rulesOf(read("app/theme/felt.css"));
const globals = rulesOf(read("app/globals.css"));
const motion = rulesOf(read("app/theme/motion.css"));
const lanternRoot = lantern.find((r) => r.selector === ":root");
const feltRoot = felt.find((r) => r.selector === ":root.theme-felt");
const cardScope = lantern.find((r) => r.selector.split(",").some((s) => s.trim() === ".parchment"));
assert.ok(lanternRoot && feltRoot && cardScope, "lantern :root, felt :root.theme-felt and the .parchment scope exist");

// Properties next/font injects on <html>; they are not the Theme's to declare.
const FONT_VARS = new Set(["--font-text", "--font-display-face", "--font-display-felt"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(new URL(dir, WEB), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => `${dir}${f.replaceAll("\\", "/")}`);
}

test("every var(--x) the app uses is declared by the base Theme", () => {
  const declared = new Set([...customProps(lantern), ...customProps(motion), ...customProps(globals), ...FONT_VARS]);
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
  const motionFelt = motion.find((r) => r.selector === ":root.theme-felt");
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
  const found = [...lantern, ...felt, ...globals, ...motion].flatMap((r) =>
    [...r.decls]
      .filter(([prop, value]) => !prop.startsWith("--") && literal.test(value))
      .map(([prop, value]) => `${r.selector} { ${prop}: ${value} }`),
  );
  assert.deepEqual(found, []);
});

// ---------- contrast ----------

// light-dark(a, b) picks one side by the surface's mode; var(--x) is replaced by the context's declaration.
function resolve({
  value,
  decls,
  mode,
}: {
  value: string;
  decls: Map<string, string>;
  mode: "light" | "dark";
}): string {
  let v = value;
  for (let guard = 0; guard < 50 && /var\(|light-dark\(/.test(v); guard++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => decls.get(name) ?? `?${name}`);
    const at = v.indexOf("light-dark(");
    if (at >= 0) {
      let depth = 0;
      let comma = -1;
      let end = -1;
      for (let i = at + "light-dark".length; i < v.length; i++) {
        if (v[i] === "(") depth++;
        else if (v[i] === ")" && --depth === 0) {
          end = i;
          break;
        } else if (v[i] === "," && depth === 1 && comma < 0) comma = i;
      }
      const a = v.slice(at + "light-dark(".length, comma).trim();
      const b = v.slice(comma + 1, end).trim();
      v = v.slice(0, at) + (mode === "light" ? a : b) + v.slice(end + 1);
    }
  }
  return v;
}

function luminance(hex: string): number {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  assert.match(h, /^[0-9a-f]{6}$/i, `a plain hex colour, got ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

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
