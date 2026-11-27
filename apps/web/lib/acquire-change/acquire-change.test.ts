import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { changeFields, itemChange } from "./acquire-change.ts";

test("the change form offers the entry type's number and choice fields, and sends only what was typed (#196)", () => {
  const fields = changeFields({ ruleset: Ruleset.parse(SAMPLE_LEDGER_RULESET), type: "wargear" });
  assert.ok(fields.some((f) => f.id === "rating" && f.options === undefined));
  assert.equal(itemChange({ fields, typed: {}, tags: " " }), undefined);
  assert.deepEqual(itemChange({ fields, typed: { rating: " 2 ", nope: "4" }, tags: "WARDEN, , RARE" }), {
    fields: { rating: 2 },
    tags: ["WARDEN", "RARE"],
  });
  // Not a whole number: sent as typed, for the server to refuse, never dropped.
  assert.deepEqual(itemChange({ fields, typed: { rating: "2.5" }, tags: "" }), { fields: { rating: "2.5" } });
});
