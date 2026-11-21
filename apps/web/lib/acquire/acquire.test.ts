import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_LEDGER_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { acquireKinds, previewAcquire, startPicks, waitingAcquire } from "./acquire.ts";

// House decision #102 on the ledger sample: a hero procures gear against 8 + its rating, eased past the first keyword.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  if (!r.ok) throw new Error("the ledger fixture compiles");
  return r.compiled;
})();
const ruleset = compiled.ruleset;
const hero = {
  id: "h",
  kind: "pc",
  name: "Wren",
  entity: "hero",
  fields: { keywords: ["WARDEN", "BOW"] },
  resources: { coin: 5 },
  derived: {},
  conditions: [],
} as unknown as Actor;
const table = { pools: [], encounter: null, campaign: { fields: { tier: 1 } } } as unknown as Pick<
  LiveState,
  "pools" | "encounter" | "campaign"
>;
const entry = (key: string) => {
  const e = SAMPLE_LEDGER_PACK.entries.find((x) => x.key === key);
  assert.ok(e);
  return { type: e.type, key: e.key, name: e.name, tags: e.tags ?? [], body: e.body ?? {} };
};

test("the phone previews the Test's inputs as parts, for the kinds the hero acquires", () => {
  assert.deepEqual(
    acquireKinds({ ruleset, actor: hero }).map((k) => k.id),
    ["arms", "fittings", "stores", "kit"],
  );
  assert.deepEqual(startPicks(ruleset), { push: 0 });
  const plan = previewAcquire({
    ruleset,
    compiled,
    table,
    actor: hero,
    characters: 1,
    entry: entry("wargear.hunting-bow"),
    picks: { push: 0 },
  });
  assert.ok(!("code" in plan));
  assert.equal(plan.inputs.dn?.total, 10); // 8 + 3, less 1 for a second keyword shared
});

test("an ask waiting on the GM is the character's own", () => {
  const q = { id: "q", actorId: "h", acquire: { type: "wargear", entry: "x", name: "X" } } as never;
  assert.equal(waitingAcquire({ requests: [q], actorId: "h" }), q);
  assert.equal(waitingAcquire({ requests: [q], actorId: "o" }), undefined);
});
