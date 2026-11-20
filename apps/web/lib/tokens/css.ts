import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reads the shipped CSS for the tests that hold the Theme contract (tokens.test.ts, lib/world): a small parser, the
// value a token resolves to in a context, and the contrast of two colours.

export const WEB = new URL("../../", import.meta.url);
export const read = (path: string) => readFileSync(new URL(path, WEB), "utf8");
export const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

export type Rule = { selector: string; decls: Map<string, string> };

// Every rule with declarations, at any @media depth. A rule's body is read up to its closing brace.
export function rulesOf(css: string): Rule[] {
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

export const customProps = (rules: Rule[]) =>
  new Set(rules.flatMap((r) => [...r.decls.keys()].filter((k) => k.startsWith("--"))));
export const merge = (...rules: Rule[]) => new Map(rules.flatMap((r) => [...r.decls]));

// light-dark(a, b) picks one side by the surface's mode; var(--x) is replaced by the context's declaration.
export function resolve({
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

export function luminance(hex: string): number {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  assert.match(h, /^[0-9a-f]{6}$/i, `a plain hex colour, got ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
