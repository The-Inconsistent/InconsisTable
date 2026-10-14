import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { Ruleset } from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";
import { appendPage, matching, rulesUrl, typeOptions } from "./rules-reader.ts";

const entry = (over: Partial<RulesEntry>): RulesEntry => ({
  pack: "p",
  key: "k",
  type: "spell",
  name: "Spark",
  level: null,
  tags: [],
  cite: "Sample p.1",
  visibility: "party",
  body: {},
  ...over,
});

test("the rules url carries the search, the type and the page, and nothing that is empty", () => {
  assert.equal(
    rulesUrl({ campaignId: "c1", type: "", q: " ", offset: 0 }),
    "/api/campaigns/c1/rules?limit=50&offset=0",
  );
  assert.equal(
    rulesUrl({ campaignId: "c1", type: "spell", q: " spa rk ", offset: 50 }),
    "/api/campaigns/c1/rules?limit=50&offset=50&type=spell&q=spa+rk",
  );
});

test("the type filter lists the ruleset's entity types, then the types entries add", () => {
  const ruleset = Ruleset.parse(SAMPLE_D20);
  const types = typeOptions({ ruleset, entries: [entry({ type: "spell" }), entry({ type: "character" })] });
  assert.deepEqual(types, [...ruleset.entities.map((e) => e.id), "spell"]);
  assert.deepEqual(typeOptions({ ruleset: null, entries: [] }), []);
});

test("a next page that repeats an entry does not list it twice", () => {
  const a = entry({ key: "a" });
  const b = entry({ key: "b" });
  assert.deepEqual(appendPage({ shown: [a], next: [a, b] }), [a, b]);
});

test("a text search ignores case and keeps all when empty", () => {
  const items = ["Dazed", "Braced"];
  assert.deepEqual(matching({ items, q: "daz", text: (s) => s }), ["Dazed"]);
  assert.deepEqual(matching({ items, q: "  ", text: (s) => s }), items);
});
