import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRuleset, type CompiledRuleset } from "@inconsistable/rules-engine";
import { FIXTURE_RULESET } from "../../test/fixture.ts";
import { type ActorRows, buildActors, toLiveActor } from "./actor.values.ts";

const compiled: CompiledRuleset = (() => {
  const r = compileRuleset(FIXTURE_RULESET);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.problems));
  return r.compiled;
})();

const row = (over: Partial<ActorRows["actor"]> & { id: string }): ActorRows["actor"] => ({
  campaignId: "c",
  createdAt: new Date(0),
  kind: "pc",
  entityType: "character",
  subtype: "",
  name: over.id,
  status: "active",
  temporary: false,
  ownerUserId: null,
  rulesetVersionId: null,
  memberCount: null,
  ...over,
});
const int = (actorId: string, fieldId: string, intValue: number) => ({
  actorId,
  fieldId,
  ordinal: 0,
  intValue,
  textValue: null,
  refKey: null,
});
const text = (actorId: string, fieldId: string, textValue: string, ordinal = 0) => ({
  actorId,
  fieldId,
  ordinal,
  intValue: null,
  textValue,
  refKey: null,
});
const res = (actorId: string, resourceId: string, value: number, maxOverride: number | null = null) => ({
  actorId,
  resourceId,
  value,
  maxOverride,
});

const lyra: ActorRows = {
  actor: row({ id: "lyra" }),
  fields: [
    int("lyra", "level", 3),
    int("lyra", "attr.con", 14),
    text("lyra", "tags", "b", 1),
    text("lyra", "tags", "a", 0),
  ],
  resources: [res("lyra", "hp", 9), res("lyra", "focus", 2)],
  conditions: [
    { id: "x", actorId: "lyra", conditionId: "dazed", stacks: 1, source: "", expiresOn: "roundEnd", expiresAfter: 2 },
  ],
};

test("an actor's rows become fields, derived values, bounds and conditions", () => {
  const built = buildActors({ compiled, rows: [lyra] }).lyra!;
  assert.equal(built.entity, "character");
  assert.deepEqual(built.fields.tags, ["a", "b"], "a list reads in ordinal order");
  assert.equal(built.derived.maxHp, 6 + 3 * 2 + 2, "mod(14) is +2");
  assert.deepEqual(built.bounds.hp, { min: 0, max: 14 });
  assert.deepEqual(built.state.resources.focus, {
    value: 2,
    min: 0,
    max: 3,
    reset: { shortRest: 3, sessionStart: 1 },
    instantDeathAt: null,
  });
  assert.deepEqual(built.state.resources.hp?.reset, { longRest: 14 }, "what the rest primitive resets to");
  assert.deepEqual(built.state.conditions, [{ id: "x", conditionId: "dazed", expiresOn: "roundEnd", expiresAfter: 2 }]);
  assert.deepEqual(toLiveActor(built).conditions, ["dazed"]);
});

test("a per-actor max override replaces the evaluated max, and never drops below the min", () => {
  const rows = [{ ...lyra, resources: [res("lyra", "hp", 9, 20), res("lyra", "focus", 2, -4)] }];
  const built = buildActors({ compiled, rows }).lyra!;
  assert.equal(built.bounds.hp?.max, 20);
  assert.equal(built.bounds.focus?.max, 0);
});

test("an incomplete actor shows no derived values and its resources can't be changed yet", () => {
  const rows = [{ ...lyra, fields: [int("lyra", "level", 3)] }]; // no attr.con
  const built = buildActors({ compiled, rows }).lyra!;
  assert.deepEqual(built.derived, {});
  assert.deepEqual(built.state.resources, {});
  assert.equal(built.resources.hp, 9, "the stored value still shows");
});

test("an actor with no entity the ruleset knows carries no values", () => {
  const rows: ActorRows[] = [
    {
      actor: row({ id: "x", entityType: "" }),
      fields: [int("x", "level", 3)],
      resources: [res("x", "hp", 4)],
      conditions: [],
    },
  ];
  const built = buildActors({ compiled, rows }).x!;
  assert.equal(built.entity, "");
  assert.deepEqual(toLiveActor(built).fields, {});
  assert.deepEqual(toLiveActor(built).resources, {});
  assert.deepEqual(toLiveActor(buildActors({ compiled: null, rows: [lyra] }).lyra!).fields, {}, "no ruleset pinned");
});
