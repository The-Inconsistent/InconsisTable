import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REFUSALS } from "@inconsistable/core-schema";

const load = (locale: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

// Every leaf of a messages tree as a dotted path.
function paths(tree: unknown, prefix = ""): string[] {
  if (typeof tree === "string") return [prefix];
  if (typeof tree !== "object" || tree === null) throw new Error(`${prefix}: a message is a string or a group`);
  return Object.entries(tree).flatMap(([k, v]) => paths(v, prefix === "" ? k : `${prefix}.${k}`));
}

// Every leaf with its text.
function leaves(tree: unknown, prefix = ""): [string, string][] {
  if (typeof tree === "string") return [[prefix, tree]];
  return Object.entries(tree as object).flatMap(([k, v]) => leaves(v, prefix === "" ? k : `${prefix}.${k}`));
}

// The names a message fills in ({name}, {count, plural, …}) and the tags it wraps (<link>), ICU keywords left out.
const slotsOf = (text: string): string[] =>
  [...new Set([...text.matchAll(/\{(\w+)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? m[2] ?? ""))].toSorted();

test("each vi message fills in the same names as its en message", () => {
  const vi = new Map(leaves(load("vi")));
  for (const [key, text] of leaves(load("en"))) assert.deepEqual(slotsOf(vi.get(key) ?? ""), slotsOf(text), key);
});

test("vi.json has exactly the keys of en.json", () => {
  assert.deepEqual(paths(load("vi")).toSorted(), paths(load("en")).toSorted());
});

// Every api refusal code has an English and a Vietnamese message with the catalogue's {slots}; en says what the api says.
test("the errors namespace has one en and one vi message per refusal code", () => {
  for (const locale of ["en", "vi"]) {
    const errors = (load(locale) as { errors: Record<string, string> }).errors;
    assert.deepEqual(Object.keys(errors).toSorted(), Object.keys(REFUSALS).toSorted(), locale);
    for (const [code, text] of Object.entries(REFUSALS)) {
      assert.deepEqual(slotsOf(errors[code] ?? ""), slotsOf(text), `${locale}.${code}`);
      if (locale === "en") assert.equal(errors[code], text, code);
    }
  }
});
