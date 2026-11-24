import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { costText, inputsText, offersOf } from "./spends.ts";

const compiled = (() => {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(r.ok);
  return r.compiled;
})();

const actor = {
  id: "c1",
  entity: "character",
  fields: { "attr.str": 10, "attr.dex": 12, "attr.con": 10, level: 1 },
  resources: {},
  derived: {},
} as unknown as Actor;

const table = (momentum: number, barred: boolean | null): Pick<LiveState, "pools" | "encounter" | "campaign"> =>
  ({
    pools: [{ id: "momentum", label: "Momentum", value: momentum, min: 0, max: 6 }],
    encounter:
      barred === null
        ? null
        : {
            round: 1,
            combatants: [
              { actorId: "c1", barred },
              { actorId: "r1", barred: false },
            ],
          },
    campaign: { fields: {} },
  }) as unknown as Pick<LiveState, "pools" | "encounter" | "campaign">;

const available = (t: ReturnType<typeof table>, inputs = {}) =>
  offersOf({ ruleset: compiled.ruleset, compiled: null, table: t, actor, characters: 1, inputs })
    .filter((o) => o.plan !== null)
    .map((o) => o.spend.id);

test("a character is offered what it could spend now: the pool, the fight and the bar decide", () => {
  assert.deepEqual(available(table(3, null)), ["rally"]);
  assert.deepEqual(available(table(3, false)), ["rally", "jump"]);
  assert.deepEqual(available(table(3, true)), ["rally", "jump", "shake"]);
  assert.deepEqual(available(table(1, true)), ["rally", "jump"]);
  assert.deepEqual(available(table(1, null), { rally: { dice: 2 } }), []);
});

test("a cost and an ask's inputs read in the ruleset's words", () => {
  const labels = new Map([["momentum", "Momentum"]]);
  assert.equal(costText({ costs: [{ pool: "momentum", amount: 2, byRun: false }], labels }), "2 Momentum");
  assert.equal(inputsText({ spend: compiled.ruleset.spends?.[0], inputs: { dice: 2 } }), "Dice 2");
});
