import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlayerTab, playerAddress, settledTab } from "./player-address.ts";

const q = (s: string) => new URLSearchParams(s);

test("reads a known tab and drops an unknown one", () => {
  assert.equal(parsePlayerTab(q("tab=notebook")), "notebook");
  assert.equal(parsePlayerTab(q("tab=nope")), null);
  assert.equal(parsePlayerTab(q("")), null);
});

test("a tab the seat may not open falls back", () => {
  const allowed = ["sheet", "fight"] as const;
  assert.equal(settledTab({ requested: "run", allowed, fallback: "sheet" }), "sheet");
  assert.equal(settledTab({ requested: "fight", allowed, fallback: "sheet" }), "fight");
  assert.equal(settledTab({ requested: null, allowed, fallback: "sheet" }), "sheet");
});

test("writes the tab and keeps the other parameters", () => {
  assert.equal(playerAddress({ tab: "fight", keep: q("quick=1&tab=sheet").entries() }), "quick=1&tab=fight");
});
