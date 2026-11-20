import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ScenePrep, type Actor, type CodexEntry, type PoolState, type TestDef } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";

import {
  EMPTY_PREP,
  offeredKinds,
  resolveLine,
  stepLine,
  withLine,
  withoutLine,
  type PrepWorld,
  type Spawnable,
} from "./scene-prep.ts";

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b1";
const SCENE = "00000000-0000-4000-8000-0000000000c1";
const NPC = "00000000-0000-4000-8000-0000000000c2";
const GONE = "00000000-0000-4000-8000-0000000000ff";

const actor = (id: string): Actor =>
  ({ id, name: id, kind: "pc", entity: "character", fields: {}, resources: {}, derived: {}, conditions: [] }) as never;
const def = (id: string, over: Partial<TestDef> = {}): TestDef => ({
  id,
  dice: "1d20",
  advantage: true,
  pool: null,
  outcomes: null,
  inputs: [],
  ...over,
});
const pool = (over: Partial<PoolState>): PoolState => ({
  id: "luck",
  label: "Luck",
  scope: "party",
  value: 1,
  min: 0,
  max: 3,
  capped: true,
  visibility: "party",
  editableBy: "owner",
  ...over,
});
const entry = (id: string, kind: CodexEntry["kind"]): CodexEntry => ({ id, kind }) as CodexEntry;

const SPAWNABLE: Spawnable = {
  packs: [{ slug: "sample", id: "pv-1" }],
  entries: [{ pack: "sample", key: "ember-wisp", type: "creature", name: "Ember Wisp" }],
  complete: true,
};
const world = (over: Partial<PrepWorld["state"]> = {}, spawnable = SPAWNABLE): PrepWorld => ({
  state: {
    testDefs: [def("check", { inputs: [{ id: "dc", type: "int" }] }), def("gambit", { outcomes: [] })],
    pools: [pool({}), pool({ id: "menace", scope: "gm", value: 2 })],
    actors: [actor(ANA), actor(BEN)],
    encounter: {} as never,
    access: { members: [{ characterIds: [ANA] }], guests: [{ actorId: BEN }] } as never,
    ...over,
  },
  entries: [entry(SCENE, "scene"), entry(NPC, "npc")],
  spawnable,
});
const doc = ScenePrep.parse({
  roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 3 }],
  tests: [{ id: "t", testId: "check", inputs: { dc: 12 }, hideTarget: true }],
  pools: [{ id: "p", pool: "menace", amount: -2, text: "Spend" }],
  exits: [{ id: "e", label: "On", sceneId: SCENE }],
  reveals: [{ id: "v", entryId: NPC }],
});
const resolve = (k: keyof ScenePrep, w = world(), d = doc) => resolveLine({ kind: k, line: d[k][0]!, world: w });

describe("each kind of line becomes the action the table already has", () => {
  test("roster: actor.spawn of the attached version, temporary as the line says", () => {
    assert.deepEqual(resolve("roster"), {
      state: "ready",
      action: { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", count: 3, temporary: true },
    });
    const mob = ScenePrep.parse({ roster: [{ id: "m", pack: "sample", key: "ember-wisp", count: 1, mob: 12 }] });
    assert.deepEqual(resolve("roster", world(), mob), {
      state: "ready",
      action: { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", count: 1, temporary: true, mob: 12 },
    });
  });
  test("test: test.call of the seated characters, with the line's inputs and hidden target", () => {
    assert.deepEqual(resolve("tests"), {
      state: "ready",
      action: {
        type: "test.call",
        testId: "check",
        actorIds: [ANA, BEN],
        inputs: { dc: 12 },
        hideTarget: true,
        showOutcome: false,
      },
    });
    const listed = ScenePrep.parse({ tests: [{ id: "t", testId: "gambit", takers: "listed", actorIds: [BEN] }] });
    const r = resolve("tests", world(), listed);
    assert.equal(r.state === "ready" && r.action.type === "test.call" && r.action.actorIds[0], BEN);
  });
  test("pool: the pool's own adjust by the signed amount", () => {
    assert.deepEqual(resolve("pools"), {
      state: "ready",
      action: {
        type: "rule.op",
        primitive: "resource.capped",
        op: "adjustPool",
        input: { resource: "menace", delta: -2 },
      },
    });
  });
  test("exit opens the scene, no action; reveal is codex.reveal to the party", () => {
    assert.deepEqual(resolve("exits"), { state: "open", sceneId: SCENE });
    assert.deepEqual(resolve("reveals"), {
      state: "ready",
      action: { type: "codex.reveal", id: NPC, visibility: "party", audienceMode: "all", audience: [] },
    });
  });
});

describe("a line naming what the room no longer has is broken, and says what", () => {
  test("each kind", () => {
    const gone = ScenePrep.parse({
      roster: [{ id: "r", pack: "sample", key: "nobody", count: 1 }],
      tests: [{ id: "t", testId: "nope" }],
      pools: [{ id: "p", pool: "nope", amount: 1 }],
      exits: [{ id: "e", label: "On", sceneId: GONE }],
      reveals: [{ id: "v", entryId: GONE }],
    });
    const missing = (["roster", "tests", "pools", "exits", "reveals"] as const).map((k) => resolve(k, world(), gone));
    assert.deepEqual(
      missing.map((r) => (r.state === "broken" ? r.missing : r.state)),
      ["entry", "test", "pool", "scene", "entry"],
    );
    assert.deepEqual(resolve("roster", world({}, { ...SPAWNABLE, packs: [] })), { state: "broken", missing: "pack" });
    const listed = ScenePrep.parse({ tests: [{ id: "t", testId: "check", takers: "listed", actorIds: [GONE] }] });
    assert.deepEqual(resolve("tests", world(), listed), { state: "broken", missing: "actor" });
    // An exit to an entry that is not a scene is as good as gone.
    const notScene = ScenePrep.parse({ exits: [{ id: "e", label: "On", sceneId: NPC }] });
    assert.deepEqual(resolve("exits", world(), notScene), { state: "broken", missing: "scene" });
  });
  test("a key not among entries the page cut short is not called broken: the server answers", () => {
    const gone = ScenePrep.parse({ roster: [{ id: "r", pack: "sample", key: "nobody", count: 1 }] });
    assert.equal(resolve("roster", world({}, { ...SPAWNABLE, complete: false }), gone).state, "ready");
  });
});

describe("a line that can't be sent right now says why", () => {
  test("no fight, a visibility or size actor.spawn can't make, nobody seated, a spend the pool can't pay", () => {
    assert.deepEqual(resolve("roster", world({ encounter: null })), { state: "blocked", reason: "noFight" });
    const shown = ScenePrep.parse({
      roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 1, visibility: "bar" }],
    });
    assert.deepEqual(resolve("roster", world(), shown), { state: "blocked", reason: "visibility" });
    const many = ScenePrep.parse({ roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 21 }] });
    assert.deepEqual(resolve("roster", world(), many), { state: "blocked", reason: "count" });
    const mobs = ScenePrep.parse({ roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 2, mob: 9 }] });
    assert.deepEqual(resolve("roster", world(), mobs), { state: "blocked", reason: "mobCount" });
    const empty = world({ access: { members: [], guests: [] } as never });
    assert.deepEqual(resolve("tests", empty), { state: "blocked", reason: "nobody" });
    const poor = world({ pools: [pool({ id: "menace", value: 1 })] });
    assert.deepEqual(resolve("pools", poor), { state: "blocked", reason: "short" });
  });
});

describe("what a scene offers follows the ruleset and the packs", () => {
  test("the sample d20 room offers every kind; no pack to place from, no roster", () => {
    const d20 = Ruleset.parse(SAMPLE_D20);
    assert.deepEqual(offeredKinds({ ruleset: d20, spawnable: SPAWNABLE }), [
      "reveals",
      "tests",
      "pools",
      "roster",
      "exits",
    ]);
    const none = { packs: [], entries: [], complete: true };
    assert.deepEqual(offeredKinds({ ruleset: d20, spawnable: none }), ["reveals", "tests", "pools", "exits"]);
  });
  test("a ruleset with no pool and no Test offers neither; no ruleset offers exits and reveals only", () => {
    const harvest = Ruleset.parse(SAMPLE_HARVEST);
    const none = { packs: [], entries: [], complete: true };
    assert.deepEqual(offeredKinds({ ruleset: harvest, spawnable: none }), ["reveals", "exits"]);
    assert.deepEqual(offeredKinds({ ruleset: null, spawnable: SPAWNABLE }), ["reveals", "exits"]);
  });
});

test("lines are added, replaced, moved and removed by id", () => {
  const a = { id: "a", entryId: NPC };
  const b = { id: "b", entryId: SCENE };
  let p = withLine({ prep: EMPTY_PREP, kind: "reveals", line: a });
  p = withLine({ prep: p, kind: "reveals", line: b });
  p = withLine({ prep: p, kind: "reveals", line: { ...a, note: "x" } });
  assert.deepEqual(p.reveals, [{ ...a, note: "x" }, b]);
  assert.deepEqual(stepLine({ prep: p, kind: "reveals", id: "b", step: -1 }).reveals, [b, { ...a, note: "x" }]);
  assert.equal(stepLine({ prep: p, kind: "reveals", id: "a", step: -1 }), p);
  assert.deepEqual(withoutLine({ prep: p, kind: "reveals", id: "a" }).reveals, [b]);
});
