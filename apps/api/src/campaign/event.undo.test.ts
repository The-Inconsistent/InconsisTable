import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogValue } from "../actor/actor.delta.ts";
import { invertDelta } from "./event.undo.ts";
import type { LoggedDelta } from "./event.log.ts";

const hp = { actorId: "lyra", resource: "hp" } as const;
const note = { actorId: "lyra", field: "diary" } as const;
const dazed = { actorId: "lyra", condition: "0198f7d0-0000-7000-8000-000000000001" } as const; // an actor_condition row id

test("an added resource is undone by the change that was made, not by restoring the old value", () => {
  // Step 1 took hp 10 → 7. Step 2 (not undone) took it 7 → 5. Undoing step 1 gives back its 3, so hp is 8 and not 10.
  const step1: LoggedDelta = { target: hp, kind: "add", before: 10, after: 7 };
  const inverse = invertDelta({ logged: step1, current: null });
  assert.deepEqual(inverse, { ok: true, delta: { target: hp, kind: "add", value: 3 } });
  const afterStep2 = 5;
  assert.equal(afterStep2 + 3, 8);
});

test("the inverse of a clamped change is what was actually applied", () => {
  // −10 was asked of an hp at 3: it stopped at 0, so only 3 comes back.
  const clamped: LoggedDelta = { target: hp, kind: "add", before: 3, after: 0 };
  assert.deepEqual(invertDelta({ logged: clamped, current: null }), {
    ok: true,
    delta: { target: hp, kind: "add", value: 3 },
  });
});

test("a reset (set on a resource) is also undone as a change, so a later delta survives", () => {
  const rest: LoggedDelta = { target: hp, kind: "set", before: 4, after: 12 };
  assert.deepEqual(invertDelta({ logged: rest, current: null }), {
    ok: true,
    delta: { target: hp, kind: "add", value: -8 },
  });
});

test("a step that changed nothing, or created its row, inverts cleanly", () => {
  assert.deepEqual(invertDelta({ logged: { target: hp, kind: "add", before: 6, after: 6 }, current: null }), {
    ok: true,
    delta: null,
  });
  // A row that did not exist before comes back off by the amount it was created with.
  assert.deepEqual(invertDelta({ logged: { target: hp, kind: "add", before: null, after: 4 }, current: null }), {
    ok: true,
    delta: { target: hp, kind: "add", value: -4 },
  });
});

test("a set is undone only while the value is still what the step left", () => {
  const step: LoggedDelta = { target: note, kind: "set", before: "old", after: "new" };
  assert.deepEqual(invertDelta({ logged: step, current: "new" }), {
    ok: true,
    delta: { target: note, kind: "set", value: "old" },
  });
  // A later step wrote "newer": undoing this one would silently overwrite it, so it is refused with a clear message.
  const refused = invertDelta({ logged: step, current: "newer" });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.match(refused.message, /field "diary" changed after this step/);
    assert.match(refused.message, /Undo the later steps first/);
  }
});

test("a set to or from nothing compares null with null", () => {
  const created: LoggedDelta = { target: note, kind: "set", before: null, after: "new" };
  assert.deepEqual(invertDelta({ logged: created, current: "new" }), {
    ok: true,
    delta: { target: note, kind: "set", value: null },
  });
  assert.equal(invertDelta({ logged: created, current: null }).ok, false);
});

test("lists and conditions compare by value, whatever order an object's keys come in", () => {
  const tags: LoggedDelta = {
    target: { actorId: "lyra", field: "tags" },
    kind: "set",
    before: ["a"],
    after: ["a", "b"],
  };
  assert.equal(invertDelta({ logged: tags, current: ["a", "b"] }).ok, true);
  assert.equal(invertDelta({ logged: tags, current: ["b", "a"] }).ok, false);

  const row = { conditionId: "dazed", stacks: 1, source: "trap", expiresOn: "roundEnd", expiresAfter: 2 } as const;
  const add: LoggedDelta = { target: dazed, kind: "set", before: null, after: row };
  const reordered: LogValue = {
    expiresAfter: 2,
    expiresOn: "roundEnd",
    source: "trap",
    stacks: 1,
    conditionId: "dazed",
  };
  assert.deepEqual(invertDelta({ logged: add, current: reordered }), {
    ok: true,
    delta: { target: dazed, kind: "set", value: null },
  });
  // The condition was refreshed since: its row no longer matches what the step left.
  assert.equal(invertDelta({ logged: add, current: { ...row, expiresAfter: 5 } }).ok, false);
});

test("a condition tick is undone by the tick back, even when the row was refreshed since", () => {
  const tick: LoggedDelta = {
    target: dazed,
    kind: "add",
    before: { conditionId: "dazed", stacks: 1, source: "", expiresOn: "roundEnd", expiresAfter: 3 },
    after: { conditionId: "dazed", stacks: 1, source: "", expiresOn: "roundEnd", expiresAfter: 2 },
  };
  assert.deepEqual(invertDelta({ logged: tick, current: null }), {
    ok: true,
    delta: { target: dazed, kind: "add", value: 1 },
  });
  // An uncounted row reads as one tick left, the same as the engine reads it.
  const uncounted: LoggedDelta = { ...tick, before: { ...(tick.before as object), expiresAfter: null } as LogValue };
  assert.deepEqual(invertDelta({ logged: uncounted, current: null }), {
    ok: true,
    delta: { target: dazed, kind: "add", value: -1 },
  });
  // A removal (the last tick) is a set to nothing, undone by putting the row back while it is still gone.
  const gone: LoggedDelta = { target: dazed, kind: "set", before: tick.after, after: null };
  assert.deepEqual(invertDelta({ logged: gone, current: null }), {
    ok: true,
    delta: { target: dazed, kind: "set", value: tick.after },
  });
});
