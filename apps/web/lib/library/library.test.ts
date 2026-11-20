import assert from "node:assert/strict";
import { test } from "node:test";

import { ImportRefusal, PackImported, exportUrl, formatBytes, kindOf, parseErrorAt } from "./library.ts";

test("a document is a pack, a ruleset or a World by its shape", () => {
  assert.equal(kindOf({ id: "p", entries: [] }), "pack");
  assert.equal(kindOf({ id: "r", entities: [] }), "ruleset");
  assert.equal(kindOf({ id: "w", theme: {} }), "world");
  // A ruleset or pack that also carries a `theme` stays what its body says.
  assert.equal(kindOf({ id: "r", entities: [], theme: {} }), "ruleset");
  assert.equal(kindOf({ id: "x" }), null);
  assert.equal(kindOf([]), null);
  assert.equal(kindOf(null), null);
});

test("the api's refusal and success replies parse, anything else does not", () => {
  const refusal = {
    ok: false,
    problems: [{ path: "entries[0].cite", message: "an entry needs a cite" }],
    warnings: [],
  };
  assert.equal(ImportRefusal.safeParse(refusal).success, true);
  assert.equal(ImportRefusal.safeParse({ message: "Too many imports" }).success, false);
  const saved = {
    ok: true,
    packId: "p",
    versionId: "v",
    version: "0.1.0",
    unchanged: false,
    diff: { added: ["a"], changed: [], removed: [] },
    warnings: [],
  };
  assert.equal(PackImported.safeParse(saved).success, true);
  assert.equal(PackImported.safeParse({ ...saved, diff: null }).success, false);
});

test("a JSON error is placed from either browser's message", () => {
  assert.equal(parseErrorAt({ message: "Unexpected token } in JSON at position 17", text: "" }), 17);
  assert.equal(
    parseErrorAt({ message: "JSON.parse: expected ',' at line 2 column 3 of the JSON data", text: "ab\ncdef" }),
    5,
  );
  assert.equal(parseErrorAt({ message: "Unexpected end of JSON input", text: "{" }), null);
});

test("sizes read as people say them", () => {
  assert.equal(formatBytes(100), "1 KB");
  assert.equal(formatBytes(420 * 1024), "420 KB");
  assert.equal(formatBytes(3.14 * 1024 * 1024), "3.1 MB");
});

test("the edit flow reads the export route of its kind", () => {
  assert.equal(exportUrl("ruleset", "abc"), "/api/rulesets/abc/export");
  assert.equal(exportUrl("pack", "abc"), "/api/packs/abc/export");
});
