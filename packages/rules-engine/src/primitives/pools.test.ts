import assert from "node:assert/strict";
import { test } from "node:test";

import { charge, checkDeltas, isRefusal, type ResourceState, type RuleState } from "./primitive.ts";
import { runOp } from "./registry.ts";

const pool = (res: Partial<ResourceState> & { value: number }): ResourceState => ({ min: 0, max: null, ...res });
const state = (pools: Record<string, ResourceState>): RuleState => ({
  actors: { a: { id: "a", fields: {}, resources: { hp: pool({ value: 2, max: 9, reset: { longRest: 9 } }) } } },
  turn: null,
  pools,
});

const run = (primitive: string, op: string, s: RuleState, input: unknown) =>
  runOp({ primitive, op, params: {}, state: s, input });
const adjust = (s: RuleState, delta: number) => run("resource.capped", "adjustPool", s, { resource: "luck", delta });

test("adjustPool clamps at both ends and returns the change that remains", () => {
  const s = state({ luck: pool({ value: 3, max: 5 }) });
  const up = adjust(s, 10);
  assert.deepEqual(up.ok && up.deltas, [{ target: { pool: "luck" }, kind: "add", value: 2 }]);
  assert.equal(up.ok && up.perm, "pool:adjust");
  const down = adjust(s, -10);
  assert.deepEqual(down.ok && down.deltas, [{ target: { pool: "luck" }, kind: "add", value: -3 }]);
  const none = adjust(state({ luck: pool({ value: 5, max: 5 }) }), 1);
  assert.deepEqual(none.ok && none.deltas, []);
});

test("an uncapped pool clamps only at its minimum", () => {
  const s = state({ luck: pool({ value: 3 }) });
  const up = adjust(s, 500);
  assert.deepEqual(up.ok && up.deltas, [{ target: { pool: "luck" }, kind: "add", value: 500 }]);
  const down = adjust(s, -500);
  assert.deepEqual(down.ok && down.deltas, [{ target: { pool: "luck" }, kind: "add", value: -3 }]);
});

test("adjustPool refuses a pool the state does not have", () => {
  for (const s of [state({}), { actors: {}, turn: null }]) {
    const r = adjust(s, 1);
    assert.equal(r.ok ? "ok" : r.refusal.code, "unknownPool");
  }
});

test("rest.apply resets a pool when no actors are named, and leaves it when some are", () => {
  const s = state({
    luck: pool({ value: 1, max: 5, reset: { longRest: 5 } }),
    same: pool({ value: 2, reset: { longRest: 2 } }),
  });
  const all = run("rest", "apply", s, { event: "longRest" });
  assert.deepEqual(all.ok && all.deltas, [
    { target: { actorId: "a", resource: "hp" }, kind: "add", value: 7 },
    { target: { pool: "luck" }, kind: "add", value: 4 },
  ]);
  const some = run("rest", "apply", s, { event: "longRest", actorIds: ["a"] });
  assert.deepEqual(some.ok && some.deltas, [{ target: { actorId: "a", resource: "hp" }, kind: "add", value: 7 }]);
  const other = run("rest", "apply", s, { event: "shortRest" });
  assert.deepEqual(other.ok && other.deltas, []);
});

test("charge pays, refuses one below the minimum, and refuses an unknown pool", () => {
  const s = state({ luck: pool({ value: 3, min: 1 }) });
  assert.deepEqual(charge({ state: s, pool: "luck", amount: 2 }), {
    delta: { target: { pool: "luck" }, kind: "add", value: -2 },
  });
  const short = charge({ state: s, pool: "luck", amount: 3 });
  assert.ok(isRefusal(short));
  assert.equal(short.code, "cannotPay");
  const gone = charge({ state: s, pool: "nope", amount: 1 });
  assert.ok(isRefusal(gone));
  assert.equal(gone.code, "unknownPool");
});

test("a refusal does not carry the pool's value", () => {
  const s = state({ vault: pool({ value: 4217 }) });
  const r = charge({ state: s, pool: "vault", amount: 9999 });
  assert.ok(isRefusal(r));
  assert.ok(!r.message.includes("4217"));
});

test("only an op that names a pool target may write one", () => {
  const delta = { target: { pool: "luck" }, kind: "add", value: 1 } as const;
  assert.equal(checkDeltas({ deltas: [delta], targets: [{ resource: "*" }] })?.code, "outOfTargets");
  assert.equal(checkDeltas({ deltas: [delta], targets: [{ pool: "*" }] }), null);
});
