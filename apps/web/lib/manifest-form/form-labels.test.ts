import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as specs from "../../components/library/library-view/components/manifest-form/constants.ts";

const load = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as {
    manifestForm: { f: Record<string, string> };
  };

// Every box the form lays out has a label in both languages; a spec's own `text` (a field of the user's ruleset) is the
// only exception.
test("every spec key and raw field has a label in en and vi", () => {
  const keys = new Set<string>();
  for (const v of Object.values(specs)) {
    if (!Array.isArray(v) && typeof v !== "object") continue;
    const lists = Array.isArray(v) ? [v] : Object.values(v as object).filter(Array.isArray);
    for (const list of lists)
      for (const s of list as { key?: string }[]) if (typeof s?.key === "string") keys.add(s.key);
  }
  // The raw JSON fields the sections add by name.
  for (const k of [
    "derived",
    "resetOn",
    "inputs",
    "inputOptions",
    "special",
    "tiebreak",
    "tiebreaks",
    "copy",
    "method",
    "health",
    "terms",
    "layout",
    "extends",
    "sources",
    "body",
    "key",
  ])
    keys.add(k);
  assert.ok(keys.size > 50);
  for (const locale of ["en", "vi"]) {
    const f = load(locale).manifestForm.f;
    for (const k of keys) assert.ok(typeof f[k] === "string" && f[k] !== "", `${locale}: f.${k}`);
  }
});
