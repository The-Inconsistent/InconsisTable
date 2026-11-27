import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { generatorsFor, nextRoll, rollChain } from "./generators.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const generators = ruleset.generators ?? [];
const warren = generators.find((g) => g.id === "warren")!;

test("GENERATE offers the generators making the kind filtered, and every one on all (house decision #226)", () => {
  const ids = (kind: Parameters<typeof generatorsFor>[0]["kind"]) =>
    generatorsFor({ generators, kind }).map((g) => g.id);
  assert.deepEqual(ids("all"), ["warren", "shrine", "chambers"]);
  assert.deepEqual(ids("location"), ["warren", "chambers"]);
  assert.deepEqual(ids("lore"), ["shrine"]);
  assert.deepEqual(ids("npc"), []);
});

test("ROLL ALL rolls each asked roll step to the end of its chain, the run's own first, then each round (house decision #226)", () => {
  const next = (
    answers: Parameters<typeof nextRoll>[0]["answers"],
    rounds: Parameters<typeof nextRoll>[0]["rounds"] = [],
  ) => nextRoll({ ruleset, generator: warren, answers, rounds });
  // The number step is not a roll: the origin is rolled first, and no round is known while the count is unanswered.
  assert.deepEqual(next({}), { round: null, step: "origin", table: "warren" });
  assert.equal(next({ origin: { rows: ["burrowed"] } }), null);
  // A built warren goes on to its builders before the rounds.
  assert.deepEqual(next({ rooms: { value: 2 }, origin: { rows: ["built"] } }), {
    round: null,
    step: "origin",
    table: "builders",
  });
  const done = { rooms: { value: 2 }, origin: { rows: ["built", "monks"] } };
  assert.deepEqual(next(done), { round: 0, step: "chamber", table: "chamber" });
  assert.deepEqual(next(done, [{ chamber: { rows: ["roots"] } }]), { round: 1, step: "chamber", table: "chamber" });
  assert.equal(next(done, [{ chamber: { rows: ["roots"] } }, { chamber: { rows: ["pit"] } }]), null);
});

test("a roll step's chain goes on through a line's next, and stops where a line sends nowhere (house decision #98)", () => {
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: [] }), { trail: [], next: "warren" });
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["built"] }), {
    trail: [{ title: "Warrens", label: "Built warren" }],
    next: "builders",
  });
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["built", "monks"] }).next, undefined);
  assert.deepEqual(rollChain({ ruleset, table: "warren", rows: ["burrowed"] }).next, undefined);
});
