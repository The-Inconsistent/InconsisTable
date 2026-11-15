import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "@inconsistable/rules-engine";

import { FREEFORM } from "./freeform.ts";

test("Freeform is a valid homebrew ruleset with no cites and no game's numbers", () => {
  const r = compileRuleset(FREEFORM);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.problems));
  assert.ok(!JSON.stringify(FREEFORM).includes('"cite"'), "homebrew carries no cites");
  assert.deepEqual(FREEFORM.game?.modes, ["gm", "gmless", "solo"]);
});
