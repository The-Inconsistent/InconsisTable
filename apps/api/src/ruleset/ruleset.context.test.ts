import assert from "node:assert/strict";
import { test } from "node:test";
import { Ruleset, type TurnState } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import type { BuiltActor } from "../actor/actor.values.ts";
import { decideRun } from "./ruleset.context.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const res = { value: 9, min: 0, max: 14 };
const actor = (id: string) =>
  ({ state: { id, fields: {}, resources: { hp: res, focus: res } } }) as unknown as BuiltActor;
const built = { a1: actor("a1"), a2: actor("a2") };
const turn: TurnState = { round: 1, currentId: "a1", order: ["a1", "a2"] };
const expire = { ruleset, built, primitive: "conditions.expire", op: "encounterEnd", input: {} };

test("conditions.expire with a turn and no session is paused", () => {
  assert.throws(() => decideRun({ ...expire, turn, sessionRunning: false }), /Start a session/);
});

test("initiative.ranked with a turn and no session is paused", () => {
  const next = { ...expire, primitive: "initiative.ranked", op: "next" };
  assert.throws(() => decideRun({ ...next, turn, sessionRunning: false }), /Start a session/);
});

test("with a session running the op runs", () => {
  assert.deepEqual(decideRun({ ...expire, turn, sessionRunning: true }), []);
});

test("without a turn nothing is paused", () => {
  assert.doesNotThrow(() => decideRun({ ...expire, turn: null, sessionRunning: false }));
});

test("rest is never paused", () => {
  const rest = { ...expire, primitive: "rest", op: "apply", input: { event: "encounterEnd" } };
  assert.doesNotThrow(() => decideRun({ ...rest, turn, sessionRunning: false }));
});

test("exclude removes an actor from the state the op sees", () => {
  const input = { actorId: "a2", resource: "focus", delta: -1 };
  const adjust = (exclude: ReadonlySet<string>) => () =>
    decideRun({
      ...expire,
      primitive: "resource.capped",
      op: "adjust",
      input,
      turn: null,
      sessionRunning: true,
      exclude,
    });
  assert.throws(adjust(new Set(["a2"])));
  assert.doesNotThrow(adjust(new Set(["a1"])));
});
