import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { costText, inputsText, nextTable, offersOf, shown, usedUp } from "./spends.ts";

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

test("a spend used up this round stays shown, disabled, until the round moves on (house decision #91)", () => {
  const armed = { ...actor, resources: { nerve: 4 } } as unknown as Actor;
  const fight = (round: number, used?: string[]) =>
    ({
      ...table(3, false),
      encounter: { round, combatants: [{ actorId: "c1", barred: false, ...(used ? { used } : {}) }] },
    }) as unknown as ReturnType<typeof table>;
  const channel = (t: ReturnType<typeof table>) =>
    offersOf({ ruleset: compiled.ruleset, compiled, table: t, actor: armed, characters: 1 }).find(
      (o) => o.spend.id === "channel",
    );
  const free = channel(fight(2));
  assert.ok(free && free.plan !== null && shown(free) && !usedUp(free));
  const spent = channel(fight(2, ["channel"]));
  assert.ok(spent && spent.plan === null && shown(spent) && usedUp(spent));
});

test("a cost and an ask's inputs read in the ruleset's words", () => {
  const labels = new Map([["momentum", "Momentum"]]);
  assert.equal(costText({ costs: [{ pool: "momentum", amount: 2, byRun: false }], labels }), "2 Momentum");
  assert.equal(inputsText({ spend: compiled.ruleset.spends?.[0], inputs: { dice: 2 } }), "Dice 2");
});

test("a use opens its table with the spend's inputs carried onto the table's (house decision #91)", () => {
  const channel = compiled.ruleset.spends?.find((s) => s.id === "channel");
  assert.ok(channel);
  const ruleset = compiled.ruleset;
  const opened = (inputs: Record<string, number>) => nextTable({ ruleset, spend: channel, inputs });
  assert.deepEqual(opened({ push: 2 }), { tableId: "backlash", title: "Backlash", inputs: { extra: 2 } });
  // A push not picked carries the spend input's min; one past the table's bounds is held to them.
  assert.deepEqual(opened({})?.inputs, { extra: 0 });
  assert.deepEqual(opened({ push: 5 })?.inputs, { extra: 2 });
  // A switch is on when the number is not 0; a spend without `then` opens nothing.
  const tables = {
    backlash: { ...ruleset.tables!.backlash!, inputs: [{ id: "extra", label: "Extra", type: "bool" as const }] },
  };
  assert.deepEqual(nextTable({ ruleset: { ...ruleset, tables }, spend: channel, inputs: { push: 1 } })?.inputs, {
    extra: true,
  });
  assert.equal(nextTable({ ruleset, spend: { ...channel, then: undefined }, inputs: {} }), null);
});
