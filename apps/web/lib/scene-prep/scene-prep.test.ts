import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ScenePrep, type Actor, type CodexEntry, type PoolState, type TestDef } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";

import {
  creatureLine,
  creatureOf,
  EMPTY_PREP,
  fightSteps,
  lineAsks,
  lineName,
  lineNames,
  offeredKinds,
  pickedRows,
  poolLineFrom,
  resolveLine,
  revealedNames,
  stepLine,
  withLine,
  withoutLine,
  withSwitch,
  type PrepWorld,
  type Spawnable,
  type SummaryWords,
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
    campaign: { fields: {} } as never,
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
    const spawn = { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", temporary: true };
    assert.deepEqual(resolve("roster"), { state: "ready", action: { ...spawn, count: 3, visibility: "hidden" } });
    const mob = ScenePrep.parse({ roster: [{ id: "m", pack: "sample", key: "ember-wisp", count: 1, mob: 12 }] });
    assert.deepEqual(resolve("roster", world(), mob), {
      state: "ready",
      action: { ...spawn, count: 1, visibility: "hidden", mob: 12 },
    });
  });
  test("roster: the line's view, and its label as the creatures' name (house decision #75)", () => {
    const shown = ScenePrep.parse({
      roster: [
        { id: "b", pack: "sample", key: "ember-wisp", count: 2, visibility: "bar", label: " Cinders " },
        { id: "f", pack: "sample", key: "ember-wisp", count: 50, visibility: "full", label: " " },
      ],
    });
    const spawn = { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", temporary: true };
    assert.deepEqual(resolveLine({ kind: "roster", line: shown.roster[0]!, world: world() }), {
      state: "ready",
      action: { ...spawn, count: 2, visibility: "bar", name: "Cinders" },
    });
    assert.deepEqual(resolveLine({ kind: "roster", line: shown.roster[1]!, world: world() }), {
      state: "ready",
      action: { ...spawn, count: 50, visibility: "full" },
    });
  });
  test("roster: its marker and options go with the spawn; an option the ruleset no longer has breaks it (#92)", () => {
    const [line] = ScenePrep.parse({
      roster: [{ id: "o", pack: "sample", key: "ember-wisp", count: 1, marker: "amber", options: ["quick"] }],
    }).roster;
    assert.ok(line);
    const spawn = { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", temporary: true };
    const ready = { ...spawn, count: 1, visibility: "hidden", options: ["quick"], marker: "amber" };
    assert.deepEqual(resolveLine({ kind: "roster", line, world: { ...world(), options: ["quick", "scaled"] } }), {
      state: "ready",
      action: ready,
    });
    assert.deepEqual(resolveLine({ kind: "roster", line, world: world() }), { state: "ready", action: ready });
    assert.deepEqual(resolveLine({ kind: "roster", line, world: { ...world(), options: ["scaled"] } }), {
      state: "broken",
      missing: "option",
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
  test("exit begins the scene it names; reveal is codex.reveal to the party", () => {
    assert.deepEqual(resolve("exits"), { state: "ready", action: { type: "scene.begin", sceneId: SCENE } });
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
  test("no fight, a size actor.spawn can't make, nobody seated, a spend the pool can't pay", () => {
    assert.deepEqual(resolve("roster", world({ encounter: null })), { state: "blocked", reason: "noFight" });
    // Past what actor.spawn places, held back with its reason (a document saved under another limit).
    const many = { roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 51 }] } as unknown as ScenePrep;
    assert.deepEqual(resolve("roster", world(), many), { state: "blocked", reason: "count" });
    const mobs = ScenePrep.parse({ roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 2, mob: 9 }] });
    assert.deepEqual(resolve("roster", world(), mobs), { state: "blocked", reason: "mobCount" });
    const empty = world({ access: { members: [], guests: [] } as never });
    assert.deepEqual(resolve("tests", empty), { state: "blocked", reason: "nobody" });
    const poor = world({ pools: [pool({ id: "menace", value: 1 })] });
    assert.deepEqual(resolve("pools", poor), { state: "blocked", reason: "short" });
  });
});

describe("a `pick` Test line is taken by the one seated character the GM picks (house decision #75)", () => {
  const picked = ScenePrep.parse({ tests: [{ id: "t", testId: "check", takers: "pick", inputs: { dc: 10 } }] });
  const line = picked.tests[0]!;
  test("it builds nothing until a taker is chosen, then test.call for that one", () => {
    const asked = resolveLine({ kind: "tests", line, world: world() });
    assert.equal(asked.state, "pick");
    assert.deepEqual(asked.state === "pick" && asked.takers.map((a) => a.id), [ANA, BEN]);
    assert.ok(!("action" in asked));
    assert.deepEqual(resolveLine({ kind: "tests", line, world: world(), taker: BEN }), {
      state: "ready",
      action: {
        type: "test.call",
        testId: "check",
        actorIds: [BEN],
        inputs: { dc: 10 },
        hideTarget: false,
        showOutcome: false,
      },
    });
  });
  test("someone not seated is no taker; nobody seated holds it back", () => {
    assert.equal(resolveLine({ kind: "tests", line, world: world(), taker: GONE }).state, "pick");
    const empty = world({ access: { members: [], guests: [] } as never });
    assert.deepEqual(resolveLine({ kind: "tests", line, world: empty }), { state: "blocked", reason: "nobody" });
  });
});

describe("a Test line lacking an input its Test asks for is filled in on the line, for that send only", () => {
  const short = ScenePrep.parse({
    tests: [
      { id: "t", testId: "check", takers: "pick" },
      { id: "u", testId: "check", inputs: { dc: 9 } },
    ],
  });
  test("it asks for the missing input, and holds back even the taker until it is filled", () => {
    const line = short.tests[0]!;
    assert.deepEqual(
      lineAsks({ line, world: world() }).map((i) => i.id),
      ["dc"],
    );
    assert.deepEqual(resolveLine({ kind: "tests", line, world: world(), taker: ANA }), {
      state: "fill",
      missing: [{ id: "dc", type: "int" }],
    });
    // Filled with something that is not a whole number: still held.
    assert.equal(resolveLine({ kind: "tests", line, world: world(), filled: { dc: "x" } }).state, "fill");
    assert.equal(resolveLine({ kind: "tests", line, world: world(), filled: { dc: "11" } }).state, "pick");
    const sent = resolveLine({ kind: "tests", line, world: world(), taker: ANA, filled: { dc: "11" } });
    assert.deepEqual(sent.state === "ready" && sent.action.type === "test.call" && sent.action.inputs, { dc: 11 });
    // The line itself is untouched: the next send asks again.
    assert.deepEqual(line.inputs, {});
  });
  test("a line with everything asks for nothing and sends as it is", () => {
    const line = short.tests[1]!;
    assert.deepEqual(lineAsks({ line, world: world() }), []);
    assert.equal(resolveLine({ kind: "tests", line, world: world() }).state, "ready");
  });
});

describe("a line is named by what it is", () => {
  const names = lineNames(world());
  const t: SummaryWords = (key, values) => `${key}${values ? ` ${JSON.stringify(values)}` : ""}`;
  test("its own label first, else what it does", () => {
    const named = { ...doc.reveals[0]!, label: "  The letter  " };
    assert.equal(lineName({ kind: "reveals", line: named, names, t }), "The letter");
    assert.equal(lineName({ kind: "reveals", line: doc.reveals[0]!, names, t }), `summary.reveal {"entry":"?"}`);
    assert.equal(
      lineName({ kind: "pools", line: doc.pools[0]!, names, t }),
      `summary.pool {"pool":"Luck","amount":-2} · Spend`,
    );
    assert.equal(
      lineName({ kind: "roster", line: doc.roster[0]!, names, t }),
      `summary.roster {"count":3,"name":"Ember Wisp"}`,
    );
    assert.equal(
      lineName({ kind: "exits", line: { ...doc.exits[0]!, label: "" }, names, t }),
      `summary.exit {"scene":"?"}`,
    );
    assert.equal(
      lineName({ kind: "tests", line: doc.tests[0]!, names, t }),
      `summary.testWith {"test":"check","inputs":"dc 12","who":"summary.party"}`,
    );
  });
  test("a Test line in the Test's words, its inputs in the Test's order (house decision #77)", () => {
    const worded = def("check", {
      label: "Ability check",
      inputs: [
        { id: "ability", type: "text", options: ["str", "dex"] },
        { id: "dc", type: "int" },
      ],
      inputLabels: { ability: "Ability", dc: "DC" },
      inputOptionLabels: { ability: { dex: "Dexterity" } },
    });
    const line = { ...doc.tests[0]!, inputs: { dc: 12, ability: "dex" } };
    assert.equal(
      lineName({ kind: "tests", line, names: lineNames(world({ testDefs: [worded] })), t }),
      `summary.testWith {"test":"Ability check","inputs":"Ability Dexterity, DC 12","who":"summary.party"}`,
    );
  });
});

describe("START THE FIGHT is ordinary actions, one after another (house decision #75)", () => {
  const roster = ScenePrep.parse({
    roster: [
      { id: "h", pack: "sample", key: "ember-wisp", count: 2 },
      { id: "b", pack: "sample", key: "ember-wisp", count: 1, visibility: "bar", label: "Cinder" },
      { id: "m", pack: "sample", key: "ember-wisp", count: 1, mob: 12, visibility: "full" },
      { id: "x", pack: "sample", key: "nobody", count: 1 },
    ],
  });
  const seatedWorld = (encounter: PrepWorld["state"]["encounter"]) =>
    world({ encounter, actors: [ANA, BEN].map((id) => ({ ...actor(id), status: "active" }) as Actor) });
  const spawn = { type: "actor.spawn", packVersionId: "pv-1", key: "ember-wisp", temporary: true };
  const lines = [
    { ...spawn, count: 2, visibility: "hidden" },
    { ...spawn, count: 1, visibility: "bar", name: "Cinder" },
    { ...spawn, count: 1, visibility: "full", mob: 12 },
  ];

  test("with no fight: start it, the seated characters join, then each line that can be sent", () => {
    const { steps, skipped } = fightSteps({ prep: roster, world: seatedWorld(null), sided: false });
    assert.deepEqual(
      steps.map((s) => s.action),
      [
        { type: "encounter.start" },
        { type: "encounter.add", actorIds: [ANA, BEN], side: "party", visibility: "full" },
        ...lines,
      ],
    );
    assert.deepEqual(
      steps.map((s) => s.line?.id),
      [undefined, undefined, "h", "b", "m"],
    );
    assert.deepEqual(
      skipped.map((s) => [s.line.id, s.resolved]),
      [["x", { state: "broken", missing: "entry" }]],
    );
  });
  test("with one running: no start, only who is not in it yet joins; a sides order sends no side", () => {
    const running = { combatants: [{ actorId: ANA }] } as never;
    const { steps } = fightSteps({ prep: roster, world: seatedWorld(running), sided: true });
    assert.deepEqual(
      steps.map((s) => s.action),
      [{ type: "encounter.add", actorIds: [BEN], visibility: "full" }, ...lines],
    );
  });
});

describe("what a scene offers follows the ruleset and the packs", () => {
  test("the sample d20 room offers every kind; no pack to place from, no roster", () => {
    const d20 = Ruleset.parse(SAMPLE_D20);
    assert.deepEqual(offeredKinds({ ruleset: d20, spawnable: SPAWNABLE }), [
      "reveals",
      "picks",
      "tests",
      "pools",
      "roster",
      "exits",
    ]);
    const none = { packs: [], entries: [], complete: true };
    assert.deepEqual(offeredKinds({ ruleset: d20, spawnable: none }), ["reveals", "picks", "tests", "pools", "exits"]);
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

// House decision #89: a scene's pick of a place's rows, read and ticked, never sent.
test("a pick line is read, not sent; a gone entry, an unpickable field and a gone row show broken", () => {
  const d20 = Ruleset.parse(SAMPLE_D20);
  const PLACE = "00000000-0000-4000-8000-0000000000d1";
  const place = { ...entry(PLACE, "location"), fields: { dangers: [{ id: "d1", values: { name: "Mud" } }] } };
  const w: PrepWorld = { ...world(), entries: [entry(SCENE, "scene"), place as CodexEntry], ruleset: d20 };
  const line = {
    id: "k",
    entryId: PLACE,
    field: "dangers",
    rows: [
      { rowId: "d1", on: false },
      { rowId: "d9", on: true },
    ],
  };
  assert.deepEqual(resolveLine({ kind: "picks", line, world: w }), { state: "read" });
  assert.deepEqual(
    pickedRows({ line, world: w }).map((r) => [r.rowId, r.on, r.row?.values.name]),
    [
      ["d1", false, "Mud"],
      ["d9", true, undefined],
    ],
  );
  assert.deepEqual(withSwitch({ line, rowId: "d1" }).rows[0], { rowId: "d1", on: true });
  const broken = (missing: string) => ({ state: "broken", missing });
  assert.deepEqual(resolveLine({ kind: "picks", line: { ...line, entryId: GONE }, world: w }), broken("entry"));
  assert.deepEqual(resolveLine({ kind: "picks", line: { ...line, field: "district" }, world: w }), broken("field"));
  assert.deepEqual(resolveLine({ kind: "picks", line, world: { ...w, ruleset: null } }), broken("field"));
});

test("revealedNames lists the titles a begin revealed, in order, leaving out a deleted entry", () => {
  const titled = (id: string, title: string) => ({ ...entry(id, "npc"), title }) as CodexEntry;
  const entries = [titled("a", "Keeper"), titled("b", "Map")];
  const begin = { id: "b1", sceneId: SCENE, revealed: ["b", "gone", "a"] };
  assert.equal(revealedNames({ begin, entries }), "Map, Keeper");
  assert.equal(revealedNames({ begin: { ...begin, revealed: [] }, entries }), "");
});

test("creatureOf and creatureLine: an entry made from a spawnable pack creature gives a plain roster line", () => {
  const made = { ...entry(NPC, "npc"), source: { entity: "creature", key: "ember-wisp" } } as CodexEntry;
  const creature = creatureOf({ entry: made, spawnable: SPAWNABLE });
  assert.equal(creature?.name, "Ember Wisp");
  assert.deepEqual(creatureLine({ creature: creature!, id: "l1" }), {
    id: "l1",
    pack: "sample",
    key: "ember-wisp",
    count: 1,
    visibility: "hidden",
    temporary: true,
  });
  assert.equal(
    creatureOf({ entry: { ...made, source: { entity: "creature", key: "other" } }, spawnable: SPAWNABLE }),
    null,
  );
  assert.equal(
    creatureOf({ entry: { ...made, source: { entity: "legend", key: "ember-wisp" } }, spawnable: SPAWNABLE }),
    null,
  );
  assert.equal(creatureOf({ entry: { ...made, source: null }, spawnable: SPAWNABLE }), null);
  assert.equal(creatureOf({ entry: made, spawnable: { ...SPAWNABLE, entries: [] } }), null);
});

test("a pool line from a pack entry takes the declared pool, the amount spent, the name and the words (#178)", () => {
  const d20 = Ruleset.parse(SAMPLE_D20);
  const omen = { type: "omen", name: "A black crow", body: { cost: 2, gist: "A foe arrives early" } };
  assert.deepEqual(poolLineFrom({ ruleset: d20, entry: omen }), {
    pool: "menace",
    amount: -2,
    label: "A black crow",
    text: "A foe arrives early",
  });
  assert.equal(poolLineFrom({ ruleset: d20, entry: { ...omen, body: { cost: 0 } } }), null);
  assert.equal(poolLineFrom({ ruleset: d20, entry: { ...omen, type: "creature" } }), null);
});
