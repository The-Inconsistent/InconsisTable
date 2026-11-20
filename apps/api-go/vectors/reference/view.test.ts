import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  Actor,
  BuilderDraftBody,
  Codex,
  CodexEntry,
  CogmScope,
  Combatant,
  Ctx,
  LiveState,
  TestCall,
} from "../../../../packages/core-schema/src/index.ts";
import { compileRuleset } from "../../../../packages/rules-engine/src/index.ts";
// Made up for the engine's own tests (not exported from the package): a small ruleset and a pack for it.
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { Ruleset } from "../../../../packages/rules-engine/src/manifest.ts";
import { seatManifest, seatView, type Snapshot } from "./view.ts";
import type { PoolState } from "../../../../packages/core-schema/src/index.ts";

// The matrix: one campaign, every kind of seat, and a digest of what each receives of the parts that can be hidden.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
})();

const actor = (id: string, kind: Actor["kind"], entity: string, over: Partial<Actor>): Actor => ({
  id,
  kind,
  name: id,
  status: "active",
  ownerUserId: "u-owner-of-" + id,
  entity,
  fields: {},
  resources: {},
  derived: {},
  conditions: [],
  conditionTimers: [],
  ledger: null,
  ...over,
});
const actors: Actor[] = [
  actor("lyra", "pc", "character", {
    fields: { name: "Lyra", diary: "dear diary", gmNote: "secretly royal" },
    resources: { hp: 9, focus: 1 },
    conditions: ["dazed", "marked"],
    conditionTimers: [
      { id: "dazed", expiresOn: "roundEnd", expiresAfter: 2 },
      { id: "marked", expiresOn: "manual", expiresAfter: null },
    ],
  }),
  actor("bran", "pc", "character", { fields: { name: "Bran" }, resources: { hp: 7 } }),
  actor("ogre", "creature", "creature", { fields: { name: "Ogre", "attr.con": 18 }, resources: { hp: 30 } }),
  actor("wisp", "creature", "creature", { fields: { name: "Wisp", "attr.con": 4 }, resources: { hp: 5 } }),
  actor("imp", "npc", "creature", { fields: { name: "Imp", "attr.con": 9 }, resources: { hp: 12 } }),
];

const combatant = (id: string, visibility: Combatant["visibility"], hp: number, over: Partial<Combatant> = {}) =>
  ({
    id: "c-" + id,
    actorId: id,
    name: id,
    side: "foe",
    ord: 0,
    initiative: 10,
    visibility,
    keep: true,
    hp: { value: hp, max: 31 },
    bar: 0.5,
    states: [{ id: "hurt", label: "Hurt" }],
    members: null,
    conditions: [{ id: "marked", left: null, expiresOn: "manual" }],
    ...over,
  }) satisfies Combatant;

const sum: TestCall = {
  id: "t-sum",
  testId: "check",
  dice: "1d20",
  advantage: true,
  pool: null,
  outcomes: null,
  status: "open",
  createdAt: "",
  inputs: { ability: "dex", dc: 17 },
  secretInputs: ["dc"], // the target number is hidden, so the input it is computed from is too
  showTarget: false,
  showModifier: true,
  showOutcome: false,
  revealed: false,
  called: 1,
  reported: 1,
  targets: [
    {
      actorId: "lyra",
      modifier: 3,
      target: 17,
      pool: null,
      report: { natural: 12, total: 15, outcome: "failure", margin: null, shifts: null, flags: [] },
    },
  ],
};
// A Dice pool with a hidden difficulty number and a hidden pool size: house decision #30.
const pool: TestCall = {
  ...sum,
  id: "t-pool",
  dice: "d6 pool",
  advantage: false,
  pool: { die: 6, bands: [{ id: "top", from: 6, to: 6, worth: 2 }], special: null, shift: "top" },
  showModifier: false,
  targets: [
    {
      actorId: "lyra",
      modifier: 1,
      target: 17,
      pool: 5,
      report: { natural: null, total: 19, outcome: "success", margin: 2, shifts: 1, flags: ["complication"] },
    },
  ],
};

const state: LiveState = {
  campaign: {
    id: "c1",
    name: "R",
    ownerUserId: "owner",
    archived: false,
    nextSessionAt: null,
    nextSessionPlace: "",
    tableMode: "gm",
    safety: { lines: [], veils: [], xCard: true },
    fields: { danger: 2 },
    worldVersionId: null,
  },
  stateVersion: 1,
  session: { id: "s", number: 1, title: "", startedAt: "", endedAt: null, recap: "", notes: "session notes" },
  actors,
  clocks: [],
  requests: [],
  requestAnswers: [],
  rolls: [],
  dealt: [],
  pools: [],
  myDraft: null,
  tests: [sum, pool],
  testDefs: [{ id: "check", dice: "1d20", advantage: true, pool: null, outcomes: null, inputs: [] }],
  encounter: {
    id: "e",
    round: 1,
    currentId: "c-wisp", // the turn is a hidden Combatant's
    firstId: null,
    phaseId: null,
    phases: [],
    done: [],
    firstPlayer: null,
    paused: false,
    endMet: [],
    scoring: null,
    health: { resource: "hp", temp: null, deathSaves: false },
    conditionDefs: [{ id: "marked", label: "Marked", duration: "manual" }],
    combatants: [
      combatant("wisp", "hidden", 5, { ord: 0 }),
      combatant("ogre", "full", 30, { ord: 1 }),
      combatant("imp", "bar", 12, { ord: 2 }),
    ],
  },
  games: [],
  access: {
    members: [],
    invites: [
      {
        id: "i",
        mode: "room",
        role: "player",
        actorId: null,
        allowGuests: true,
        expiresAt: "",
        uses: 0,
        maxUses: null,
      },
    ],
    guests: [],
    screens: 0,
    transfer: null,
  },
};
const entry = (id: string, over: Partial<CodexEntry> = {}): CodexEntry => ({
  id,
  kind: "handout",
  title: id,
  body: "B",
  gmNotes: "notes on " + id,
  visibility: "party",
  audienceMode: "all",
  audience: [],
  status: null,
  parentId: null,
  position: 0,
  links: [],
  plannedTests: [],
  imageId: null,
  imageRevealed: false,
  ...over,
});
const codex: Codex = {
  entries: [
    entry("secret", { visibility: "gm" }),
    entry("open"),
    entry("for-lyra", { audienceMode: "listed", audience: ["lyra", "kael"] }),
  ],
  recaps: [{ sessionId: "s2", number: 2, title: "", endedAt: "2026-02-01T10:00:00.000Z", recap: "They crossed." }],
};
const draft: BuilderDraftBody = { actorId: "lyra", answers: { lineage: "reedfolk" } };
const snapshot: Snapshot = { state, codex, drafts: new Map([["u-lyra", draft]]) };

// What a seat received of everything that can be hidden. Absent is undefined, nulled is null.
function digest(ctx: Ctx) {
  const v = seatView({ snapshot, compiled, ctx });
  const s = v.state;
  const call = (id: string) => {
    const c = s.tests.find((t) => t.id === id);
    const t = c?.targets[0];
    return (
      c && {
        target: t?.target,
        modifier: t?.modifier,
        pool: t?.pool,
        shifts: t?.report?.shifts,
        secret: c.secretInputs,
      }
    );
  };
  const lyra = s.actors.find((a) => a.id === "lyra");
  const hp = (id: string) => s.encounter?.combatants.find((c) => c.actorId === id)?.hp?.value;
  return {
    actors: s.actors.map((a) => a.id),
    lyraGmField: lyra?.fields.gmNote,
    lyraOwnerField: lyra?.fields.diary,
    lyraConditions: lyra?.conditions,
    lyraTimers: lyra?.conditionTimers.map((t) => t.id),
    ogreGmField: s.actors.find((a) => a.id === "ogre")?.fields["attr.con"],
    combatants: s.encounter?.combatants.map((c) => c.actorId),
    ogreHp: hp("ogre"),
    impHp: hp("imp"),
    turn: s.encounter?.currentId,
    unseen: s.encounter?.unseen,
    encounterMarks: s.encounter?.combatants.some((c) => c.keep || c.conditions.length > 0),
    notes: s.session?.notes,
    invites: s.access.invites.length,
    testDefs: s.testDefs.length,
    sum: call("t-sum"),
    pool: call("t-pool"),
    codex: v.codex.entries.map((e) => e.id),
    codexNotes: v.codex.entries.some((e) => e.gmNotes !== ""),
    packEntries: SAMPLE_PACK.entries.filter((e) => v.packVisibilities.includes(e.visibility ?? "gm")).map((e) => e.key),
    manifestGmField: v.manifest?.entities.find((e) => e.id === "character")?.fields.gmNote !== undefined,
    draft: s.myDraft?.actorId,
  };
}

const ctx = (seat: Ctx["seat"], userId: string | null = "u-someone"): Ctx => ({
  campaignId: "c1",
  userId,
  campaignOwnerId: "owner",
  tableMode: "gm",
  seat,
});
const member = (role: "gm" | "cogm" | "player", scopes: CogmScope[] = [], characterIds: string[] = []) =>
  ({ kind: "member", role, scopes, characterIds }) as const;

// Everything, as the GM sees it.
const ALL = {
  actors: ["lyra", "bran", "ogre", "wisp", "imp"],
  lyraGmField: "secretly royal",
  lyraOwnerField: "dear diary",
  lyraConditions: ["dazed", "marked"],
  lyraTimers: ["dazed", "marked"],
  ogreGmField: 18,
  combatants: ["wisp", "ogre", "imp"],
  ogreHp: 30,
  impHp: 12,
  turn: "c-wisp",
  unseen: undefined,
  encounterMarks: true,
  notes: "session notes",
  invites: 1,
  testDefs: 1,
  sum: { target: 17, modifier: 3, pool: null, shifts: null, secret: ["dc"] },
  pool: { target: 17, modifier: 1, pool: 5, shifts: 1, secret: ["dc"] },
  codex: ["secret", "open", "for-lyra"],
  codexNotes: true,
  packEntries: ["reedfolk", "wayfinder", "ember-wisp", "coil-rope"],
  manifestGmField: true,
  draft: undefined,
};
// A seat that holds nothing: the party by name and what it may know of it, the shared view of the fight.
const NOBODY = {
  actors: ["lyra", "bran"],
  lyraGmField: undefined,
  lyraOwnerField: undefined,
  lyraConditions: ["dazed"],
  lyraTimers: ["dazed"],
  ogreGmField: undefined,
  combatants: ["ogre", "imp"], // the hidden one is gone, and so is its turn
  ogreHp: 30, // `full`: the ruleset lets the table see Vigour
  impHp: undefined, // `bar`: a fraction, no numbers
  turn: null,
  unseen: true, // the hidden one holds the turn: said, never named (#68)
  encounterMarks: false,
  notes: "",
  invites: 0,
  testDefs: 0,
  sum: undefined, // calls name Lyra, so nobody else hears of them
  pool: undefined,
  codex: ["open"],
  codexNotes: false,
  packEntries: ["reedfolk", "wayfinder", "coil-rope"],
  manifestGmField: false,
  draft: undefined,
};
// What a seat holding Lyra adds.
const HOLDING_LYRA = {
  actors: ["lyra", "bran"],
  lyraOwnerField: "dear diary",
  sum: { target: null, modifier: 3, pool: null, shifts: null, secret: [] }, // the DC stays hidden, the modifier is theirs
  pool: { target: null, modifier: null, pool: null, shifts: null, secret: [] }, // no number to work the DC out from
  codex: ["open", "for-lyra"],
};

test("the GM and the owner see everything", () => {
  assert.deepEqual(digest(ctx(member("gm"), "u-gm")), ALL);
  assert.deepEqual(digest(ctx(member("gm"), "owner")), ALL);
});

test("an admin who opened the room without a seat sees everything", () => {
  assert.deepEqual(digest(ctx({ kind: "admin" }, "u-admin")), ALL);
});

test("an admin who holds a player seat sees by that seat", () => {
  assert.deepEqual(digest(ctx(member("player"), "u-admin")), NOBODY);
  assert.deepEqual(digest(ctx(member("player", [], ["lyra"]), "u-admin")), { ...NOBODY, ...HOLDING_LYRA });
});

test("a player sees their own character in full as far as the ruleset allows, and the shared view of the rest", () => {
  const lyra = digest(ctx(member("player", [], ["lyra"]), "u-lyra"));
  assert.deepEqual(lyra, { ...NOBODY, ...HOLDING_LYRA, draft: "lyra" });
  assert.deepEqual(digest(ctx(member("player", [], ["bran"]), "u-bran")), { ...NOBODY, lyraOwnerField: undefined });
});

test("a guest sees what a player holding the same character sees, without a draft", () => {
  assert.deepEqual(digest(ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null)), {
    ...NOBODY,
    ...HOLDING_LYRA,
  });
});

test("the Screen sees the shared view: that a Test is open, never who or what, and no draft", () => {
  const screen = digest(ctx({ kind: "token", role: "screen", characterIds: [] }, null));
  assert.deepEqual(screen, {
    ...NOBODY,
    sum: { target: undefined, modifier: undefined, pool: undefined, shifts: undefined, secret: [] },
    pool: { target: undefined, modifier: undefined, pool: undefined, shifts: undefined, secret: [] },
  });
});

test("a co-GM with no scope sees as a player who holds nothing", () => {
  assert.deepEqual(digest(ctx(member("cogm"), "u-co")), NOBODY);
});

test("codex opens every entry and its whole audience, never the notes on them", () => {
  assert.deepEqual(digest(ctx(member("cogm", ["codex"]), "u-co")), { ...NOBODY, codex: ALL.codex });
  const seen = seatView({ snapshot, compiled, ctx: ctx(member("cogm", ["codex"]), "u-co") }).codex.entries;
  assert.deepEqual(seen.find((e) => e.id === "for-lyra")?.audience, ["lyra", "kael"]);
  assert.ok(seen.every((e) => e.gmNotes === ""));
});

test("a link or a parent is kept only when the seat sees both ends; planned Tests are the GM side's", () => {
  const scene = entry("plan", {
    kind: "scene",
    parentId: "secret",
    links: ["secret", "open"],
    plannedTests: ["check"],
  });
  const planned = { ...snapshot, codex: { ...codex, entries: [...codex.entries, scene] } };
  const plan = (c: Ctx) => seatView({ snapshot: planned, compiled, ctx: c }).codex.entries.find((e) => e.id === "plan");
  for (const c of [ctx(member("player"), "u-x"), ctx({ kind: "token", role: "screen", characterIds: [] }, null)]) {
    assert.deepEqual([plan(c)?.links, plan(c)?.parentId, plan(c)?.plannedTests], [["open"], null, []]);
  }
  const gm = plan(ctx(member("gm"), "u-gm"));
  assert.deepEqual([gm?.links, gm?.parentId, gm?.plannedTests], [["secret", "open"], "secret", ["check"]]);
  const codexSide = plan(ctx(member("cogm", ["codex"]), "u-co"));
  assert.deepEqual(codexSide?.plannedTests, ["check"]);
});

test("a mention of an entry the seat cannot see becomes the hidden form; the GM and the stored body are untouched", () => {
  const body = "met @[Secret Name](secret), @[Open](open) and @[Gone](nope)";
  const mentioning = { ...snapshot, codex: { ...codex, entries: [...codex.entries, entry("m", { body })] } };
  const player = ctx(member("player"), "u-x");
  const bodyFor = (c: Ctx) =>
    seatView({ snapshot: mentioning, compiled, ctx: c }).codex.entries.find((e) => e.id === "m")?.body;
  assert.equal(bodyFor(player), "met @[…](hidden), @[Open](open) and @[…](hidden)");
  assert.ok(!JSON.stringify(seatView({ snapshot: mentioning, compiled, ctx: player })).includes("Secret Name"));
  assert.equal(bodyFor(ctx(member("gm"), "u-gm")), body);
});

test("a seat outside the codex side never receives the id of a picture not shown to the table", () => {
  const pictured = {
    ...snapshot,
    codex: {
      ...codex,
      entries: [
        entry("held", { imageId: "pic-held" }),
        entry("shown", { imageId: "pic-shown", imageRevealed: true }),
        entry("secret-shown", { visibility: "gm", imageId: "pic-secret", imageRevealed: true }),
      ],
    },
  };
  const pictures = (c: Ctx) =>
    seatView({ snapshot: pictured, compiled, ctx: c }).codex.entries.map((e) => [e.id, e.imageId, e.imageRevealed]);
  const player = ctx(member("player"), "u-x");
  assert.deepEqual(pictures(player), [
    ["held", null, false],
    ["shown", "pic-shown", true],
  ]);
  assert.ok(!JSON.stringify(seatView({ snapshot: pictured, compiled, ctx: player })).includes("pic-held"));
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["codex"]), "u-co")]) {
    assert.deepEqual(pictures(c), [
      ["held", "pic-held", false],
      ["shown", "pic-shown", true],
      ["secret-shown", "pic-secret", true],
    ]);
  }
});

test("every seat receives the recaps, whole", () => {
  for (const c of [ctx(member("player"), "u-x"), ctx(member("cogm"), "u-co"), ctx(member("gm"), "u-gm")])
    assert.deepEqual(seatView({ snapshot, compiled, ctx: c }).codex.recaps, codex.recaps);
});

test("a co-GM keeps their own characters", () => {
  assert.deepEqual(digest(ctx(member("cogm", [], ["lyra"]), "u-lyra")), { ...NOBODY, ...HOLDING_LYRA, draft: "lyra" });
});

test("combat opens hidden Combatants, Creatures and NPCs, the whole Encounter and gm pack entries", () => {
  assert.deepEqual(digest(ctx(member("cogm", ["combat"]), "u-co")), {
    ...NOBODY,
    actors: ALL.actors,
    ogreGmField: 18,
    combatants: ALL.combatants,
    impHp: 12,
    turn: "c-wisp",
    unseen: undefined,
    encounterMarks: true,
    packEntries: ALL.packEntries,
    manifestGmField: true, // ponytail: the manifest is read whole by the party and combat sides
  });
});

test("session opens hidden Test targets and inputs, the Test defs and the session notes", () => {
  assert.deepEqual(digest(ctx(member("cogm", ["session"]), "u-co")), {
    ...NOBODY,
    notes: "session notes",
    testDefs: 1,
    sum: ALL.sum,
    pool: ALL.pool,
  });
});

test("codex.secrets opens secret codex entries and their notes", () => {
  assert.deepEqual(digest(ctx(member("cogm", ["codex.secrets"]), "u-co")), {
    ...NOBODY,
    codex: ALL.codex,
    codexNotes: true,
  });
});

test("party opens the gm fields of Characters and the invites, not Creatures", () => {
  assert.deepEqual(digest(ctx(member("cogm", ["party"]), "u-co")), {
    ...NOBODY,
    lyraGmField: "secretly royal",
    lyraOwnerField: "dear diary",
    lyraConditions: ["dazed", "marked"],
    lyraTimers: ["dazed", "marked"],
    invites: 1,
    manifestGmField: true,
  });
});

test("scopes add up, and each adds only its own part", () => {
  const both = digest(ctx(member("cogm", ["combat", "codex.secrets"]), "u-co"));
  assert.deepEqual(both.codex, ALL.codex);
  assert.deepEqual(both.combatants, ALL.combatants);
  assert.equal(both.lyraGmField, undefined);
  assert.equal(both.notes, "");
  assert.deepEqual(both.sum, undefined);
});

test("a health number follows the ruleset's visibility of the actor, in the Encounter as on the sheet", () => {
  // A ruleset that keeps Vigour from the table: the Encounter drops it with the sheet value, for every seat below the
  // GM side of that actor.
  const hidden = structuredClone(SAMPLE_D20);
  const hp = hidden.resources?.find((r) => r.id === "hp");
  if (!hp) throw new Error("fixture has no hp");
  hp.visibility = "gm";
  const r = compileRuleset(hidden);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const view = (c: Ctx) => seatView({ snapshot, compiled: r.compiled, ctx: c });
  const player = view(ctx(member("player"), "u-p")).state;
  assert.equal(player.encounter?.combatants.find((c) => c.actorId === "ogre")?.hp, null);
  assert.equal(player.actors.find((a) => a.id === "lyra")?.resources.hp, undefined);
  const co = view(ctx(member("cogm", ["combat"]), "u-co")).state;
  assert.equal(co.encounter?.combatants.find((c) => c.actorId === "ogre")?.hp?.value, 30); // a Creature: combat covers it
  assert.equal(
    view(ctx(member("gm"), "u-gm")).state.encounter?.combatants.find((c) => c.actorId === "wisp")?.hp?.value,
    5,
  );
});

// House decision #66: a Combatant's health states and a mob's count reach the combat side always, anyone else at `bar`
// and `full`; a hidden one is gone with them, and `bar` carries no numbers.
test("states and a mob's count follow the Combatant's visibility; bar carries no numbers", () => {
  const states = [{ id: "fallen", label: "Fallen" }];
  const members = { value: 3, max: 12 };
  const withStates: Snapshot = {
    ...snapshot,
    state: {
      ...state,
      encounter: {
        ...state.encounter!,
        combatants: state.encounter!.combatants.map((c) => ({ ...c, states, members })),
      },
    },
  };
  const seen = (c: Ctx) =>
    seatView({ snapshot: withStates, compiled, ctx: c }).state.encounter?.combatants.map((x) => ({
      id: x.actorId,
      hp: x.hp?.value ?? null,
      states: x.states.length,
      members: x.members?.value ?? null,
    }));
  const all = [
    { id: "wisp", hp: 5, states: 1, members: 3 },
    { id: "ogre", hp: 30, states: 1, members: 3 },
    { id: "imp", hp: 12, states: 1, members: 3 },
  ];
  assert.deepEqual(seen(ctx(member("gm"), "u-gm")), all);
  assert.deepEqual(seen(ctx(member("cogm", ["combat"]), "u-co")), all);
  const below = [
    { id: "ogre", hp: 30, states: 1, members: 3 },
    { id: "imp", hp: null, states: 1, members: 3 },
  ];
  assert.deepEqual(seen(ctx(member("player"), "u-p")), below);
  assert.deepEqual(seen(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), below);
});

test("no ruleset pinned: no value reaches a seat below the GM side", () => {
  const v = seatView({ snapshot, compiled: null, ctx: ctx(member("player", [], ["lyra"]), "u-lyra") });
  assert.ok(v.state.actors.every((a) => Object.keys(a.fields).length + Object.keys(a.resources).length === 0));
  assert.equal(v.manifest, null);
});

// What the Encounter says of a Combatant's conditions follows the actor's values: a `gm` condition on a Character
// needs the party scope, in the Encounter as on the sheet.
test("a Combatant's conditions are the ones the seat sees on its actor", () => {
  const withLyra: Snapshot = {
    ...snapshot,
    state: {
      ...state,
      encounter: {
        ...state.encounter!,
        combatants: [
          combatant("lyra", "full", 9, {
            side: "party",
            conditions: [
              { id: "dazed", left: 2, expiresOn: "roundEnd" },
              { id: "marked", left: null, expiresOn: "manual" }, // `gm` in the ruleset
            ],
          }),
        ],
      },
    },
  };
  const conditions = (c: Ctx) =>
    seatView({ snapshot: withLyra, compiled, ctx: c }).state.encounter?.combatants[0]?.conditions.map((x) => x.id);
  assert.deepEqual(conditions(ctx(member("gm"), "u-gm")), ["dazed", "marked"]);
  assert.deepEqual(conditions(ctx(member("cogm", ["combat", "party"]), "u-co")), ["dazed", "marked"]);
  assert.deepEqual(conditions(ctx(member("cogm", ["combat"]), "u-co")), ["dazed"]);
  // Off the combat side too (house decision #67): the party scope reads a Character whole, a player what the table may.
  assert.deepEqual(conditions(ctx(member("cogm", ["party"]), "u-co")), ["dazed", "marked"]);
  assert.deepEqual(conditions(ctx(member("player", [], ["lyra"]), "u-lyra")), ["dazed"]);
  assert.deepEqual(conditions(ctx(member("player", [], ["bran"]), "u-bran")), ["dazed"]);
  assert.deepEqual(conditions(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), ["dazed"]);
});

// Two characters called, the target number and the outcome shown or the Test revealed.
describe("a Test Call as a player sees it", () => {
  const two = (over: Partial<TestCall> = {}): TestCall => ({
    ...sum,
    called: 2,
    reported: 1,
    targets: [sum.targets[0]!, { actorId: "bran", modifier: 1, target: 17, pool: null, report: null }],
    ...over,
  });
  const callFor = (call: TestCall, c: Ctx) =>
    seatView({ snapshot: { ...snapshot, state: { ...state, tests: [call] } }, compiled, ctx: c }).state.tests[0];
  const lyra = ctx(member("player", [], ["lyra"]), "u-lyra");
  const bran = ctx({ kind: "token", role: "player", characterIds: ["bran"] }, null);

  test("counts only the characters the seat holds", () => {
    const gm = callFor(two(), ctx(member("gm"), "u-gm"));
    assert.deepEqual([gm?.called, gm?.reported], [2, 1]);
    const l = callFor(two(), lyra);
    assert.deepEqual([l?.called, l?.reported], [1, 1]);
    const b = callFor(two(), bran);
    assert.deepEqual([b?.called, b?.reported], [1, 0]);
  });

  test("a shown target reaches the called player, with its input and the outcome", () => {
    const shown = two({ showTarget: true, showOutcome: true, secretInputs: [] });
    const l = callFor(shown, lyra);
    assert.equal(l?.targets[0]?.target, 17);
    assert.equal(l?.inputs.dc, 17);
    assert.equal(l?.targets[0]?.report?.outcome, "failure");
    assert.equal(callFor(shown, bran)?.targets[0]?.target, 17); // Bran is called too, and told his own
    assert.equal(callFor(shown, bran)?.targets.length, 1);
  });

  test("an outcome shown without the target does not show the target", () => {
    const t = callFor(two({ showOutcome: true }), lyra)?.targets[0];
    assert.deepEqual([t?.target, t?.report?.outcome, t?.report?.natural], [null, "failure", 12]);
  });

  test("a reveal shows the other characters' outcome and die, never their modifier or total", () => {
    const b = callFor(
      two({
        revealed: true,
        status: "closed",
        targets: [
          sum.targets[0]!,
          {
            actorId: "bran",
            modifier: 1,
            target: 17,
            pool: null,
            report: { natural: 20, total: 21, outcome: "critical", margin: null, shifts: null, flags: [] },
          },
        ],
      }),
      lyra,
    )?.targets.find((t) => t.actorId === "bran");
    assert.deepEqual(b, {
      actorId: "bran",
      modifier: null,
      target: null,
      pool: null,
      report: { natural: 20, total: null, outcome: "critical", margin: null, shifts: null, flags: [] },
    });
  });

  test("a Dice pool's margin and shifts are told once the number is shown or the Test is revealed", () => {
    const report = (c: TestCall) => callFor(c, lyra)?.targets[0]?.report;
    assert.deepEqual([report(pool)?.margin, report(pool)?.shifts], [null, null]);
    const shown = report({ ...pool, showTarget: true, showOutcome: true, secretInputs: [] });
    assert.deepEqual([shown?.margin, shown?.shifts], [2, 1]);
    const closed = { ...pool, revealed: true, status: "closed" } as const;
    assert.deepEqual([report(closed)?.margin, report(closed)?.shifts], [2, 1]);
    assert.equal(callFor(closed, lyra)?.targets[0]?.target, null);
  });
});

test("a codex reader is never told who else an entry was shown to", () => {
  const audience = (c: Ctx) =>
    seatView({ snapshot, compiled, ctx: c }).codex.entries.find((e) => e.id === "for-lyra")?.audience;
  assert.deepEqual(audience(ctx(member("player", [], ["lyra"]), "u-lyra")), ["lyra"]);
  assert.deepEqual(audience(ctx(member("cogm", ["codex.secrets"]), "u-co")), ["lyra", "kael"]);
  assert.deepEqual(audience(ctx(member("cogm", ["codex"]), "u-co")), ["lyra", "kael"]);
  assert.deepEqual(audience(ctx(member("gm"), "u-gm")), ["lyra", "kael"]);
});

test("clocks: the clock side sees every clock, anyone else the party ones, with no entry id they cannot read", () => {
  const clock = (id: string, visibility: "gm" | "party", entryId: string | null) =>
    ({ id, name: id, segments: 6, filled: 1, visibility, entryId, position: 1 }) as const;
  const clocks = [
    clock("a", "party", "open"),
    clock("b", "gm", null),
    clock("c", "party", "secret"),
    clock("d", "gm", "open"),
  ];
  const withClocks: Snapshot = { ...snapshot, state: { ...state, clocks } };
  const seen = (c: Ctx) =>
    seatView({ snapshot: withClocks, compiled, ctx: c }).state.clocks.map((k) => `${k.id}:${k.entryId}`);
  assert.deepEqual(seen(ctx(member("gm"), "u-gm")), ["a:open", "b:null", "c:secret", "d:open"]);
  assert.deepEqual(seen(ctx(member("cogm", ["combat"]), "u-co")), ["a:open", "b:null", "c:null", "d:open"]);
  assert.deepEqual(seen(ctx(member("cogm", ["party"]), "u-co")), ["a:open", "c:null"]);
  assert.deepEqual(seen(ctx(member("player", [], ["lyra"]), "u-lyra")), ["a:open", "c:null"]);
  assert.deepEqual(seen(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), ["a:open", "c:null"]);
});

test("requests: the answering side sees every pending request, a player their own, a screen none", () => {
  const request = (id: string, userId: string) =>
    ({
      id,
      userId,
      actorId: "lyra",
      resourceId: "luck",
      amount: 1,
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as const;
  const answer = (id: string, userId: string) =>
    ({ id, userId, actorId: "lyra", resourceId: "luck", amount: 1, status: "denied", reason: "no" }) as const;
  const withRequests: Snapshot = {
    ...snapshot,
    state: {
      ...state,
      requests: [request("a", "u-lyra"), request("b", "u-kael")],
      requestAnswers: [answer("x", "u-kael"), answer("y", "u-lyra")],
    },
  };
  const seen = (c: Ctx) => {
    const s = seatView({ snapshot: withRequests, compiled, ctx: c }).state;
    return [s.requests.map((q) => q.id).join(""), s.requestAnswers.map((r) => r.id).join("")];
  };
  assert.deepEqual(seen(ctx(member("gm"), "u-gm")), ["ab", "xy"]);
  assert.deepEqual(seen(ctx(member("cogm", ["session"]), "u-co")), ["ab", "xy"]);
  assert.deepEqual(seen(ctx(member("cogm", ["combat"]), "u-co")), ["", ""]);
  assert.deepEqual(seen(ctx(member("player", [], ["lyra"]), "u-lyra")), ["a", "y"]);
  assert.deepEqual(seen(ctx(member("player", [], ["kael"]), "u-kael")), ["b", "x"]);
  assert.deepEqual(seen(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), ["", ""]);
});

// Without a GM nobody is on the GM side (docs/adr/0009-table-modes.md): no seat receives a `gm` entry, a note for the
// GM, a `gm` pack entry, the session notes or a hidden Test target, whatever it may run. Asserted per kind of seat.
describe("a room without a GM", () => {
  const SEATS: [string, Ctx][] = [
    ["owner", ctx(member("player"), "owner")],
    ["owner still seated as gm (stale)", ctx(member("gm"), "owner")],
    ["stale gm", ctx(member("gm"), "u-gm")],
    [
      "stale co-GM with every scope",
      ctx(member("cogm", ["combat", "codex", "codex.secrets", "party", "session"]), "u-co"),
    ],
    ["player", ctx(member("player", [], ["lyra"]), "u-lyra")],
    ["player holding nothing", ctx(member("player"), "u-none")],
    ["guest", ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null)],
    ["screen", ctx({ kind: "token", role: "screen", characterIds: [] }, null)],
  ];
  for (const tableMode of ["gmless", "solo"] as const) {
    const room: Snapshot = { ...snapshot, state: { ...state, campaign: { ...state.campaign, tableMode } } };
    for (const [name, seat] of SEATS) {
      test(`${tableMode}: ${name} receives nothing for the GM`, () => {
        // The Ctx still carries the mode it was handed (gm): the snapshot's wins.
        const v = seatView({ snapshot: room, compiled, ctx: seat });
        assert.deepEqual(
          v.codex.entries.filter((e) => e.visibility === "gm" || e.gmNotes !== "" || e.plannedTests.length > 0),
          [],
        );
        assert.equal(v.packVisibilities.includes("gm"), false);
        assert.equal(v.state.session?.notes, "");
        assert.deepEqual(
          v.state.tests.filter(
            (t) => t.secretInputs.length > 0 || t.targets.some((x) => x.target !== null && !t.showTarget),
          ),
          [],
        );
        assert.deepEqual(
          v.state.clocks.filter((k) => k.visibility === "gm"),
          [],
        );
        assert.equal(v.manifest?.entities.find((e) => e.id === "character")?.fields.gmNote, undefined);
      });
    }
    test(`${tableMode}: a player running the table sees the whole fight and every call`, () => {
      const v = seatView({ snapshot: room, compiled, ctx: ctx(member("player", [], ["kael"]), "u-kael") });
      assert.deepEqual(v.state.encounter?.combatants.map((x) => x.actorId).sort(), ["imp", "ogre", "wisp"]);
      assert.ok(v.state.tests.length > 0);
      assert.equal(v.state.testDefs.length, 1);
    });
  }
});

describe("random tables (house decision #49)", () => {
  const roll = (id: string, visibility: "gm" | "party" | "owner") =>
    ({ id, tableId: "t", entryId: "e", label: id, value: 1, visibility, at: "2026-01-01T00:00:00.000Z" }) as const;
  const card = (actorId: string, visibility: "gm" | "party" | "owner") =>
    ({ tableId: "t", actorId, entryId: "e", label: actorId + visibility, visibility }) as const;
  const inMode = (tableMode: "gm" | "gmless"): Snapshot => ({
    ...snapshot,
    state: {
      ...state,
      campaign: { ...state.campaign, tableMode },
      rolls: [roll("gm-roll", "gm"), roll("party-roll", "party")],
      dealt: [card("lyra", "owner"), card("bran", "owner"), card("lyra", "party"), card("bran", "gm")],
    },
  });
  const seen = (mode: "gm" | "gmless", c: Ctx) => {
    const s = seatView({ snapshot: inMode(mode), compiled, ctx: c }).state;
    return [s.rolls.map((r) => r.id).join(","), s.dealt.map((d) => d.label).join(",")];
  };
  const screen: Ctx["seat"] = { kind: "token", role: "screen", characterIds: [] };

  test("with a GM: the side that runs the table sees every roll and card, a holder their own owner card", () => {
    const all = ["gm-roll,party-roll", "lyraowner,branowner,lyraparty,brangm"];
    assert.deepEqual(seen("gm", ctx(member("gm"), "u-gm")), all);
    assert.deepEqual(seen("gm", ctx(member("cogm", ["session"]), "u-co")), all);
    assert.deepEqual(seen("gm", ctx(member("cogm", ["combat"]), "u-co")), ["party-roll", "lyraparty"]);
    assert.deepEqual(seen("gm", ctx(member("player", [], ["lyra"]), "u-lyra")), ["party-roll", "lyraowner,lyraparty"]);
    assert.deepEqual(seen("gm", ctx(member("player", [], ["bran"]), "u-bran")), ["party-roll", "branowner,lyraparty"]);
    const guest = ctx({ kind: "token", role: "player", characterIds: ["bran"] }, null);
    assert.deepEqual(seen("gm", guest), ["party-roll", "branowner,lyraparty"]);
    assert.deepEqual(seen("gm", ctx(screen, null)), ["party-roll", "lyraparty"]);
    assert.deepEqual(seen("gm", ctx({ kind: "admin" }, null)), all);
  });

  test("a seat's manifest hides the entries of a secret table and still parses as a ruleset", () => {
    const r = compileRuleset(SAMPLE_HARVEST);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    const shown = (c: Ctx) => seatManifest({ ruleset: r.compiled.ruleset, ctx: c }).tables;
    const parses = (c: Ctx) => Ruleset.safeParse(seatManifest({ ruleset: r.compiled.ruleset, ctx: c })).success;
    const lyra = ctx(member("player", [], ["lyra"]), "u-lyra");
    assert.deepEqual(
      Object.entries(shown(lyra) ?? {}).map(([id, t]) => [id, t.entries.length]),
      [
        ["season", 3],
        ["omen", 0],
        ["role", 0],
      ],
    );
    assert.equal(parses(lyra), true);
    assert.equal(parses(ctx(member("gm"), "u-gm")), true);
    assert.equal(shown(ctx(member("gm"), "u-gm"))?.role?.entries.length, 3);
  });

  test("without a GM: nobody sees a gm roll or another's owner card, whatever the seat may run", () => {
    const lyra = ctx(member("player", [], ["lyra"]), "u-lyra");
    assert.deepEqual(seen("gmless", lyra), ["party-roll", "lyraowner,lyraparty"]);
    // The room's owner runs the table but holds no character: nothing of the GM side.
    assert.deepEqual(seen("gmless", ctx(member("player"), "owner")), ["party-roll", "lyraparty"]);
    assert.deepEqual(seen("gmless", ctx(screen, null)), ["party-roll", "lyraparty"]);
    // A GM seat left over from before the table changed mode reads as a player: the snapshot's mode wins.
    assert.deepEqual(seen("gmless", ctx(member("gm"), "u-gm")), ["party-roll", "lyraparty"]);
  });
});

// ---- shared pools (house decision #59) ----

const mkPool = (id: string, scope: PoolState["scope"], visibility: PoolState["visibility"]): PoolState => ({
  id,
  label: id,
  scope,
  value: 1,
  min: 0,
  max: 5,
  capped: true,
  visibility,
  editableBy: "gm",
});
const POOLS = [
  mkPool("pub", "party", "public"),
  mkPool("shared", "party", "party"),
  mkPool("mine", "party", "owner"),
  mkPool("secret", "party", "gm"),
  mkPool("hoard", "gm", "gm"),
  mkPool("gmOwn", "gm", "owner"),
  mkPool("camp", "campaign", "owner"),
  mkPool("campPub", "campaign", "public"),
];
const poolsFor = (c: Ctx, o: { mode?: "gm" | "gmless"; compiled?: boolean } = {}) => {
  const room: Snapshot = {
    ...snapshot,
    state: { ...state, pools: POOLS, campaign: { ...state.campaign, tableMode: o.mode ?? "gm" } },
  };
  return seatView({ snapshot: room, compiled: o.compiled === false ? null : compiled, ctx: c }).state.pools.map(
    (p) => p.id,
  );
};
const EVERY = POOLS.map((p) => p.id);
const PLAYER = ["pub", "shared", "campPub"];
const HOLDER = ["pub", "shared", "mine", "campPub"];

test("pools: the GM side receives every pool, in order", () => {
  assert.deepEqual(poolsFor(ctx(member("gm"), "u-gm")), EVERY);
  assert.deepEqual(poolsFor(ctx(member("gm"), "owner")), EVERY);
  assert.deepEqual(poolsFor(ctx({ kind: "admin" }, "u-admin")), EVERY);
  assert.deepEqual(poolsFor(ctx(member("cogm", ["session"]), "u-co")), EVERY);
});

test("pools: a player, a guest and the screen never receive a gm pool (rule 1)", () => {
  for (const c of [
    ctx(member("player", [], ["lyra"])),
    ctx(member("player")),
    ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
  ])
    assert.equal(
      poolsFor(c).some((id) => id === "secret" || id === "hoard"),
      false,
    );
});

test("pools: without a GM no seat receives a gm pool, the owner and an admin included (rule 2)", () => {
  for (const c of [
    ctx(member("player", [], ["lyra"]), "owner"),
    ctx(member("player"), "owner"),
    ctx({ kind: "admin" }, "u-admin"),
    ctx(member("player", [], ["lyra"])),
  ])
    assert.deepEqual(
      poolsFor(c, { mode: "gmless" }).filter((id) => ["secret", "hoard", "gmOwn", "camp"].includes(id)),
      [],
    );
  assert.deepEqual(poolsFor(ctx(member("player", [], ["lyra"]), "owner"), { mode: "gmless" }), HOLDER);
});

test("pools: the screen never receives an owner pool (rule 3)", () => {
  assert.deepEqual(poolsFor(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), PLAYER);
});

test("pools: a seat holding no character never receives an owner pool (rule 4)", () => {
  assert.deepEqual(poolsFor(ctx(member("player"))), PLAYER);
  assert.deepEqual(poolsFor(ctx(member("player", [], ["lyra"]))), HOLDER);
  assert.deepEqual(poolsFor(ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null)), HOLDER);
});

test("pools: a gm or campaign pool with owner visibility never leaves the GM side (rule 5)", () => {
  assert.equal(poolsFor(ctx(member("player", [], ["lyra"]))).includes("gmOwn"), false);
  assert.equal(poolsFor(ctx(member("player", [], ["lyra"]))).includes("camp"), false);
});

test("pools: a co-GM whose scopes do not put it on the GM side never receives a gm pool (rule 6)", () => {
  for (const scopes of [[], ["combat"], ["codex"], ["codex.secrets"], ["party"]] as CogmScope[][])
    assert.deepEqual(poolsFor(ctx(member("cogm", scopes), "u-co")), PLAYER, scopes.join());
});

test("pools: a seat with no ruleset in its view receives none", () => {
  assert.deepEqual(poolsFor(ctx(member("gm"), "u-gm"), { compiled: false }), []);
  assert.deepEqual(poolsFor(ctx(member("player", [], ["lyra"])), { compiled: false }), []);
});

test("a saved ledger build reaches the GM side and the seat holding the character, nobody else (house decisions #63, #64)", () => {
  const saved = {
    build: null,
    sheet: null,
    draft: { tier: 1, archetypeId: "lamplighter" },
    xpSpent: 3,
    xpAtAscension: 20,
    packageWaived: true,
  };
  const actors = state.actors.map((a) => (a.id === "lyra" ? { ...a, ledger: saved } : a));
  const withLedger: Snapshot = { ...snapshot, state: { ...state, actors } };
  const ledgerOf = (c: Ctx) =>
    seatView({ snapshot: withLedger, compiled, ctx: c }).state.actors.find((a) => a.id === "lyra")?.ledger;
  for (const c of [
    ctx(member("gm"), "u-gm"),
    ctx(member("player", [], ["lyra"]), "u-lyra"),
    ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null),
    ctx(member("cogm", ["party"]), "u-co"),
  ])
    assert.deepEqual(ledgerOf(c), saved, JSON.stringify(c.seat));
  // A player who does not hold the character does not receive it, nor does a co-GM off the party, nor the Screen.
  for (const c of [
    ctx(member("player", [], ["bran"]), "u-bran"),
    ctx(member("player"), "u-someone"),
    ctx(member("cogm", ["combat"]), "u-co"),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
  ])
    assert.equal(ledgerOf(c), null, JSON.stringify(c.seat));
});
