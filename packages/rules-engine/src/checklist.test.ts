import assert from "node:assert/strict";
import { test } from "node:test";

import { checklistTicks, type ChecklistRoom } from "./checklist.ts";
import { compileRuleset } from "./compile.ts";
import { SAMPLE_POOL } from "./fixtures/sample-pool.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import { validateRuleset, type ChecklistStep } from "./manifest.ts";

// House decision #90: the setup checklist, ticked from what the room holds.

const steps = (() => {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(r.ok);
  return r.compiled.ruleset.checklist ?? [];
})();

const EMPTY: ChecklistRoom = {
  entries: [],
  actors: [],
  campaignFields: { chapter: 1 },
  pools: [{ id: "momentum", value: 0 }],
  sessions: 0,
  packs: [],
  safety: { lines: [], veils: [] },
};
const ticked = (room: ChecklistRoom) =>
  Object.fromEntries(checklistTicks({ steps, room }).ticks.map((t) => [t.step.id, t.done]));

test("a new room ticks only what it always holds; the next step is the first not done that is not optional", () => {
  const r = checklistTicks({ steps, room: EMPTY });
  assert.deepEqual(ticked(EMPTY), {
    limits: false,
    chapter: true,
    rivals: false,
    bestiary: false,
    crew: false,
    momentum: false,
    fight: false,
    first: false,
  });
  assert.equal(r.next, "limits");
  assert.equal(r.doneCount, 1);
});

test("each count kind ticks from the room", () => {
  const room: ChecklistRoom = {
    entries: [
      { kind: "faction", fields: { standing: "ally" } },
      { kind: "faction", fields: { standing: "rival" } },
      { kind: "scene", fields: {}, prep: { roster: [{}], tests: [] } },
    ],
    actors: [
      { entity: "character", built: false },
      { entity: "character", built: true },
      { entity: "creature", built: false },
    ],
    campaignFields: { chapter: 2 },
    pools: [{ id: "momentum", value: 1 }],
    sessions: 1,
    packs: [{ slug: "sample-bestiary" }],
    safety: { lines: ["Drowning"], veils: [] },
  };
  assert.ok(Object.values(ticked(room)).every(Boolean));
  const r = checklistTicks({ steps, room });
  assert.equal(r.next, null);
  assert.equal(r.ticks.find((t) => t.step.id === "crew")?.count, 2);
  // An optional step left undone is never the next one.
  const noPack = checklistTicks({ steps, room: { ...room, packs: [] } });
  assert.equal(noPack.next, null);
  assert.equal(noPack.doneCount, steps.length - 1);
  // A rival only by its value, a fight only by a scene with creatures, two wardens not one.
  assert.equal(ticked({ ...room, entries: room.entries.slice(0, 1) }).rivals, false);
  assert.equal(ticked({ ...room, entries: [{ kind: "scene", fields: {}, prep: { roster: [] } }] }).fight, false);
  assert.equal(ticked({ ...room, actors: room.actors.slice(1) }).crew, false);
});

test("a field set means text that is not blank, a list that is not empty; a built actor only when built", () => {
  const extra: ChecklistStep[] = [
    { id: "a", label: "A", done: { count: "entries", kind: "lore", field: "frame" } },
    { id: "b", label: "B", done: { count: "actors", entity: "character", built: true } },
    { id: "c", label: "C", done: { count: "packs", slug: "other", min: 1 } },
    { id: "d", label: "D", done: { count: "sessions", min: 2 } },
  ];
  const room = (frame: unknown, built: boolean): ChecklistRoom => ({
    ...EMPTY,
    entries: [{ kind: "lore", fields: { frame } }],
    actors: [{ entity: "character", built }],
    packs: [{ slug: "sample-bestiary" }],
    sessions: 1,
  });
  const done = (r: ChecklistRoom) => checklistTicks({ steps: extra, room: r }).ticks.map((t) => t.done);
  assert.deepEqual(done(room("  ", false)), [false, false, false, false]);
  assert.deepEqual(done(room([], true)), [false, true, false, false]);
  assert.deepEqual(done(room(["x"], true)), [true, true, false, false]);
  assert.deepEqual(done({ ...room("x", false), sessions: 2 }), [true, false, false, true]);
});

test("a ruleset without the block has no checklist; refusals are at their path", () => {
  const pool = compileRuleset(SAMPLE_POOL);
  assert.ok(pool.ok);
  assert.equal(pool.compiled.ruleset.checklist, undefined);
  const problems = (checklist: unknown) => {
    const r = validateRuleset({ ...SAMPLE_SKIRMISH, checklist });
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  const one = (done: object, over: object = {}) => [{ id: "s", label: "S", cite: "Sample p.1", done, ...over }];
  assert.deepEqual(problems(one({ count: "entries", kind: "faction", field: "nope" })), [
    'checklist[0].done.field: "nope" is not a field of faction',
  ]);
  assert.deepEqual(problems(one({ count: "actors", entity: "lineage" })), [
    'checklist[0].done.entity: "lineage" is not an actor entity',
  ]);
  assert.deepEqual(problems(one({ count: "pool", pool: "hp" })), ['checklist[0].done.pool: "hp" is not a shared pool']);
  assert.deepEqual(problems(one({ count: "sessions" }, { goto: { tab: "party", kind: "npc" } })), [
    "checklist[0].goto.kind: only the codex tab takes a kind",
  ]);
  assert.ok(problems(one({ count: "dice" })).length > 0);
  assert.ok(problems(one({ count: "sessions" }, { goto: { tab: "settings" } })).length > 0);
  assert.deepEqual(problems([{ id: "s", label: "S", done: { count: "sessions" } }]), [
    "checklist[0].cite: a rule entry needs a cite",
  ]);
});
