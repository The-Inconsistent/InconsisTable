import assert from "node:assert/strict";
import { test } from "node:test";
import { Ruleset, type RuleState } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { runPrimitive } from "./ruleset.run.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const res = { value: 9, min: 0, max: 14 };
const state: RuleState = { actors: { a1: { id: "a1", fields: {}, resources: { hp: res, focus: res } } }, turn: null };
const adjust = (resource: string) =>
  runPrimitive({
    ruleset,
    state,
    primitive: "resource.capped",
    op: "adjust",
    input: { actorId: "a1", resource, delta: -1 },
  });

test("a plain adjust on a health track's resource is refused", () => {
  assert.throws(() => adjust("hp"), /HP changes through damage and heal/);
});

test("a plain adjust on a resource that is not a track's still runs", () => {
  assert.equal(adjust("focus").length, 1);
});
