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
import { ScenePrep } from "../../../../packages/core-schema/src/index.ts";
import { compileRuleset } from "../../../../packages/rules-engine/src/index.ts";
// Made up for the engine's own tests (not exported from the package): a small ruleset and a pack for it.
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { Ruleset, type RulesetInput } from "../../../../packages/rules-engine/src/manifest.ts";
import { ownerStrikeProblems, seatManifest, seatView, type Snapshot } from "./view.ts";
import { CRAFTED_SEAT_CUTS, SAMPLE_RULESETS } from "./samples.ts";
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
  journal: [
    {
      id: "s",
      number: 1,
      title: "",
      startedAt: "",
      endedAt: null,
      recap: "",
      notes: "session notes",
      abandoned: false,
    },
  ],
  actors,
  clocks: [],
  requests: [],
  requestAnswers: [],
  rolls: [],
  dealt: [],
  pools: [],
  whispers: [
    {
      id: "w1",
      text: "psst",
      createdAt: "",
      readers: [
        { actorId: "lyra", reply: "mine", repliedAt: "", readAt: "" },
        { actorId: "bran", reply: "his", repliedAt: "", readAt: null },
      ],
    },
    {
      id: "w2",
      text: "only Bran",
      createdAt: "",
      readers: [{ actorId: "bran", reply: null, repliedAt: null, readAt: null }],
    },
  ],
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
  revealedAt: null,
  fields: {},
  layout: (over.kind ?? "handout") === "handout" ? "plain" : null,
  header: (over.kind ?? "handout") === "handout" ? "" : null,
  prep: null,
  source: null,
  ...over,
});
const codex: Codex = {
  entries: [
    entry("secret", { visibility: "gm" }),
    entry("open"),
    entry("for-lyra", { audienceMode: "listed", audience: ["lyra", "kael"] }),
  ],
  recaps: [{ sessionId: "s2", number: 2, title: "", endedAt: "2026-02-01T10:00:00.000Z", recap: "They crossed." }],
  latestBegin: { id: "b1", sceneId: "open", revealed: ["secret"] },
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
  // The Creature the GM shows in full reaches every seat, without its `gm` values (house decision #117); the `bar` one
  // does not.
  actors: ["lyra", "bran", "ogre"],
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
  actors: ["lyra", "bran", "ogre"],
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

test("a tree's hidden middle is never named: below it, a seat that can't read it gets a root", () => {
  const tree = [
    entry("top", { kind: "location" }),
    entry("mid", { kind: "location", visibility: "gm", parentId: "top" }),
    entry("leaf", { kind: "location", parentId: "mid" }),
    entry("twig", { kind: "location", parentId: "leaf" }),
  ];
  const nested = { ...snapshot, codex: { ...codex, entries: [...codex.entries, ...tree] } };
  const parents = (c: Ctx) =>
    seatView({ snapshot: nested, compiled, ctx: c })
      .codex.entries.filter((e) => e.kind === "location")
      .map((e) => [e.id, e.parentId]);
  for (const c of [ctx(member("player"), "u-x"), ctx({ kind: "token", role: "screen", characterIds: [] }, null)]) {
    assert.deepEqual(parents(c), [
      ["top", null],
      ["leaf", null],
      ["twig", "leaf"],
    ]);
    assert.ok(!JSON.stringify(seatView({ snapshot: nested, compiled, ctx: c })).includes('"mid"'));
  }
  assert.deepEqual(parents(ctx(member("gm"), "u-gm")), [
    ["top", null],
    ["mid", "top"],
    ["leaf", "mid"],
    ["twig", "leaf"],
  ]);
});

// House decision #71: an entry's declared fields reach a seat as the ruleset declares them.
test("a gm entry field reaches only the side that reads GM notes; the player and the table screen get the party ones", () => {
  const stored = { mood: "cold", disposition: -2, patron: "ember-wisp", gone: "x" };
  const npc = entry("npc", { kind: "npc", fields: stored });
  const faction = entry("band", { kind: "faction", fields: { standing: "rival" } });
  const fielded = { ...snapshot, codex: { ...codex, entries: [...codex.entries, npc, faction] } };
  const fieldsOf = (c: Ctx, id: string, rules: typeof compiled | null = compiled) =>
    seatView({ snapshot: fielded, compiled: rules, ctx: c }).codex.entries.find((e) => e.id === id)?.fields;
  const party = { mood: "cold", disposition: -2 };
  for (const c of [
    ctx(member("player"), "u-x"),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
    ctx(member("cogm", ["codex"]), "u-co"),
    ctx(member("cogm", ["combat"]), "u-co"),
  ]) {
    assert.deepEqual(fieldsOf(c, "npc"), party);
    assert.deepEqual(fieldsOf(c, "band"), {});
  }
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["codex.secrets"]), "u-co")]) {
    assert.deepEqual(fieldsOf(c, "npc"), { ...party, patron: "ember-wisp" });
    assert.deepEqual(fieldsOf(c, "band"), { standing: "rival" });
  }
  // A value that no longer fits, or a room without a ruleset, sends nothing; the snapshot keeps it.
  const stale = {
    ...fielded,
    codex: { ...codex, entries: [entry("npc", { kind: "npc", fields: { mood: "sulky" } })] },
  };
  assert.deepEqual(
    seatView({ snapshot: stale, compiled, ctx: ctx(member("gm"), "u-gm") }).codex.entries[0]?.fields,
    {},
  );
  assert.deepEqual(fieldsOf(ctx(member("gm"), "u-gm"), "npc", null), {});
  assert.deepEqual(npc.fields, stored);

  // The served manifest carries the definitions the seat may read, and no `gm` one off that side.
  const defs = (c: Ctx, kind: "npc" | "faction") =>
    Object.keys(seatManifest({ ruleset: compiled.ruleset, ctx: c }).codex?.kinds[kind]?.fields ?? {}).sort();
  assert.deepEqual(defs(ctx(member("player"), "u-x"), "npc"), ["disposition", "home", "mood"]);
  assert.deepEqual(defs(ctx({ kind: "token", role: "screen", characterIds: [] }, null), "faction"), []);
  assert.deepEqual(defs(ctx(member("cogm", ["combat"]), "u-co"), "npc"), ["disposition", "home", "mood"]);
  assert.deepEqual(defs(ctx(member("gm"), "u-gm"), "npc"), ["disposition", "home", "look", "mood", "patron"]);
});

// House decision #89: tags and rows follow their field's visibility, and a reminder goes where every field it reads goes.
test("a gm rows or tags field reaches nobody below the GM notes side; a party one does; a reminder never tells a gm value", () => {
  const rules = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(rules.ok);
  const danger = { id: "d1", values: { name: "Wisp", threat: 2, check: { testId: "check", inputs: { dc: 12 } } } };
  const log = [{ id: "l1", values: { day: "Day 1", what: "Ford" } }];
  const entries = [
    entry("place", { kind: "location", fields: { dangers: [danger] } }),
    entry("band", { kind: "faction", fields: { standing: "ally", marks: ["Outsider"] } }),
    entry("road", { kind: "quest", fields: { log } }),
  ];
  const withRows = (r: typeof compiled) => ({
    view: (c: Ctx) => seatView({ snapshot: { ...snapshot, codex: { ...codex, entries } }, compiled: r, ctx: c }),
  });
  const d20 = withRows(compiled);
  const skirmish = withRows(rules.compiled);
  const fieldsOf = (v: ReturnType<typeof seatView>, id: string) => v.codex.entries.find((e) => e.id === id)?.fields;
  for (const c of [ctx(member("player"), "u-x"), ctx({ kind: "token", role: "screen", characterIds: [] }, null)]) {
    const v = d20.view(c);
    assert.deepEqual(fieldsOf(v, "place"), {});
    assert.deepEqual(fieldsOf(v, "band"), {});
    // The faction's reminder reads its gm standing and marks: a player is not sent it, so a card can't hint at them.
    assert.deepEqual(v.manifest?.codex?.kinds.faction?.reminders, []);
    assert.equal(v.manifest?.codex?.kinds.location?.fields.dangers, undefined);
    assert.deepEqual(fieldsOf(skirmish.view(c), "road"), { log });
  }
  const gm = d20.view(ctx(member("gm"), "u-gm"));
  assert.deepEqual(fieldsOf(gm, "place"), { dangers: [danger] });
  assert.deepEqual(fieldsOf(gm, "band"), { standing: "ally", marks: ["Outsider"] });
  assert.equal(gm.manifest?.codex?.kinds.faction?.reminders?.length, 1);
});

// House decision #90: the setup checklist is the GM's.
test("the checklist reaches the side that reads GM notes, never a player or the table screen", () => {
  const rules = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(rules.ok);
  const listed = (c: Ctx) => seatManifest({ ruleset: rules.compiled.ruleset, ctx: c }).checklist?.length ?? 0;
  assert.equal(listed(ctx(member("gm"), "u-gm")), 8);
  assert.equal(listed(ctx(member("player"), "u-x")), 0);
  assert.equal(listed(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), 0);
});

// Dropping the checklist leaves what a phone reads from its own manifest: the spends it offers and their ask limit
// (house decision #84), and the kinds of records an actor holds (#88).
test("a player's manifest without the checklist still carries spends, requests and held kinds", () => {
  const rules = compileRuleset(SAMPLE_SKIRMISH);
  const harm = compileRuleset(SAMPLE_HARM);
  assert.ok(rules.ok && harm.ok);
  const ruleset = { ...rules.compiled.ruleset, held: harm.compiled.ruleset.held };
  const shown = seatManifest({ ruleset, ctx: ctx(member("player"), "u-x") });
  assert.equal(shown.checklist, undefined);
  assert.deepEqual(shown.spends, ruleset.spends);
  assert.equal(shown.spends?.length, 4);
  assert.deepEqual(shown.requests, { max: 3 });
  assert.deepEqual(shown.held, ruleset.held);
  assert.ok(Object.keys(shown.held ?? {}).length > 0);
});

// House decision #101: whatever a seat is served compiles, so its phone can work its numbers out, and cutting what
// names a hidden definition never brings one back.
describe("the manifest a seat is served compiles", () => {
  const seats: [string, Ctx, boolean][] = [
    ["gm", ctx(member("gm"), "u-gm"), true],
    ["co-GM with combat", ctx(member("cogm", ["combat"]), "u-co"), true],
    ["player", ctx(member("player", [], ["lyra"]), "u-lyra"), false],
    ["guest", ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null), false],
    ["table screen", ctx({ kind: "token", role: "screen", characterIds: [] }, null), false],
    ["player without a GM", { ...ctx(member("player", [], ["lyra"]), "owner"), tableMode: "gmless" }, false],
  ];
  for (const [name, input] of Object.entries({ ...SAMPLE_RULESETS, ...CRAFTED_SEAT_CUTS })) {
    test(name, () => {
      const rules = compileRuleset(input);
      assert.ok(rules.ok);
      for (const [seat, c, gmSide] of seats) {
        const served = seatManifest({ ruleset: rules.compiled.ruleset, ctx: c });
        const compiled = compileRuleset(served);
        assert.ok(compiled.ok, `${seat}: ${JSON.stringify(compiled.ok ? [] : compiled.problems)}`);
        if (gmSide) continue;
        const gm = [
          ...served.entities.flatMap((e) => [...Object.values(e.fields), ...e.derived]),
          ...served.resources,
          ...served.conditions,
          ...Object.values(served.codex?.kinds ?? {}).flatMap((k) => Object.values(k.fields)),
        ].filter((d) => d.visibility === "gm");
        assert.deepEqual(gm, [], seat);
        assert.equal(served.checklist, undefined, seat);
      }
    });
  }
});

test("a player on the ledger sample keeps the hero's Guard and its build, without the parts naming hidden ones", () => {
  const rules = compileRuleset(SAMPLE_RULESETS.ledger);
  assert.ok(rules.ok);
  const served = seatManifest({ ruleset: rules.compiled.ruleset, ctx: ctx(member("player", [], ["lyra"]), "u-lyra") });
  assert.deepEqual(
    served.entities[0]?.derived.map((d) => d.id),
    ["guard"],
  );
  assert.equal(served.build?.sheet.wealth, undefined);
  assert.equal(served.build?.sheet.corruption, undefined);
  assert.deepEqual(served.build?.keep, { fields: ["armourRating"], resources: [] });
  assert.equal(served.items?.give, undefined);
  assert.equal(served.items?.kinds.length, 4);
});

test("a strike, a generator and a codex kind's prefill are cut where they read what the seat may not", () => {
  const served = (input: RulesetInput, c: Ctx) => {
    const rules = compileRuleset(input);
    assert.ok(rules.ok);
    return seatManifest({ ruleset: rules.compiled.ruleset, ctx: c });
  };
  const player = served(CRAFTED_SEAT_CUTS.duelCuts!, ctx(member("player", [], ["lyra"]), "u-lyra"));
  assert.deepEqual(
    player.strikes?.map((s) => s.id),
    ["lunge"],
  );
  const lunge = player.strikes![0]!;
  assert.deepEqual(lunge.means, [{ from: "list", field: "blades", entry: "blade" }]);
  assert.deepEqual(lunge.shows, []);
  assert.deepEqual(
    lunge.notes?.map((n) => n.text),
    ["A clean line"],
  );
  const secrets = served(CRAFTED_SEAT_CUTS.d20Cuts!, ctx(member("cogm", ["codex", "codex.secrets"]), "u-co"));
  assert.deepEqual(secrets.generators, []);
  assert.deepEqual(secrets.codex?.kinds.location?.from, [{ entity: "site", values: {}, children: "within" }]);
});

test("a second phone's copy carries no gm panel line or figure, and no panel guarded by a gm value (#114)", () => {
  const rules = compileRuleset(CRAFTED_SEAT_CUTS.harmPanelCuts!);
  assert.ok(rules.ok);
  const gm = seatManifest({ ruleset: rules.compiled.ruleset, ctx: ctx(member("gm"), "u-gm") });
  assert.equal(gm.panels?.length, 6);
  const phone = seatManifest({ ruleset: rules.compiled.ruleset, ctx: ctx(member("player", [], ["bran"]), "u-bran") });
  assert.ok(compileRuleset(phone).ok);
  assert.deepEqual(
    phone.panels?.map((p) => p.id),
    ["incoming", "hit", "fallen", "stances"],
  );
  const incoming = phone.panels![0]!;
  assert.deepEqual(
    incoming.lines?.map((l) => l.text),
    ["Say how you meet the blow before the dice land", "Resolve left: you may try again"],
  );
  assert.deepEqual(
    incoming.figures?.map((f) => f.label),
    ["Grit", "Wounds before you fall"],
  );
  assert.ok(!JSON.stringify(phone).includes("doom") && !JSON.stringify(phone).includes("dread"));
  assert.deepEqual(
    phone.layout.hero?.phoneTurn?.flatMap((r) => (typeof r === "string" ? [] : [r.variant])),
    ["incoming", "hit", "fallen", "stances", "sweep"],
  );
  // The importer refuses each such panel, as it does an owner's strike (house decisions #113, #114); the samples pass.
  assert.deepEqual(
    ownerStrikeProblems(rules.compiled.ruleset).map((p) => p.path),
    ["panels[0]", "panels[4]", "panels[5]"],
  );
  for (const sample of [SAMPLE_RULESETS.harm, SAMPLE_RULESETS.skirmish, SAMPLE_RULESETS.duel]) {
    const c = compileRuleset(sample!);
    assert.ok(c.ok);
    assert.deepEqual(ownerStrikeProblems(c.compiled.ruleset), []);
  }
});

// House decision #76: a link to another entry reaches a seat only when the seat may read the entry it names.
test("an entry link reaches the GM notes side while its target exists, anyone else only when they read the target", () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const [shown, hidden, gone, band] = [id(1), id(2), id(3), id(4)];
  const linked = {
    ...snapshot,
    codex: {
      ...codex,
      entries: [
        entry(shown, { kind: "location" }),
        entry(hidden, { kind: "location", visibility: "gm" }),
        entry("npc-a", { kind: "npc", fields: { home: shown } }),
        entry("npc-b", { kind: "npc", fields: { home: hidden, mood: "warm" } }),
        entry("npc-c", { kind: "npc", fields: { home: gone } }),
        // Another kind than the field's, and the faction's gm seat.
        entry("npc-d", { kind: "npc", fields: { home: band } }),
        entry(band, { kind: "faction", fields: { seat: shown } }),
        entry("band-b", { kind: "faction", visibility: "gm", fields: { seat: hidden } }),
      ],
    },
  };
  const fieldsOf = (c: Ctx) =>
    Object.fromEntries(
      seatView({ snapshot: linked, compiled, ctx: c }).codex.entries.map((e) => [e.id, e.fields] as const),
    );
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["codex.secrets"]), "u-co")]) {
    const f = fieldsOf(c);
    assert.deepEqual(f["npc-a"], { home: shown });
    assert.deepEqual(f["npc-b"], { home: hidden, mood: "warm" });
    assert.deepEqual(f["npc-c"], {});
    assert.deepEqual(f["npc-d"], {});
    assert.deepEqual(f[band], { seat: shown });
    assert.deepEqual(f["band-b"], { seat: hidden });
  }
  // A co-GM with the codex but not its secrets reads every entry, and so every party link; never a gm one.
  const co = fieldsOf(ctx(member("cogm", ["codex"]), "u-co"));
  assert.deepEqual(co["npc-b"], { home: hidden, mood: "warm" });
  assert.deepEqual(co[band], {});
  for (const c of [
    ctx(member("player"), "u-x"),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
    ctx(member("cogm", ["combat"]), "u-co"),
  ]) {
    const f = fieldsOf(c);
    assert.deepEqual(f["npc-a"], { home: shown });
    // The party link to a hidden place is not sent at all; the rest of the entry is.
    assert.deepEqual(f["npc-b"], { mood: "warm" });
    assert.deepEqual(f["npc-c"], {});
    assert.deepEqual(f[band], {});
    assert.equal(f["band-b"], undefined);
    assert.ok(!JSON.stringify(seatView({ snapshot: linked, compiled, ctx: c }).codex).includes(hidden));
  }
});

test("a scene's prepared lines and status reach the codex and secrets sides only (house decision #73)", () => {
  const prep = ScenePrep.parse({
    roster: [{ id: "r1", pack: "sample", key: "ember-wisp", count: 2 }],
    tests: [{ id: "t1", testId: "check", inputs: { dc: 12 }, outcomes: [{ label: "Pass", text: "The door opens." }] }],
    pools: [{ id: "p1", pool: "menace", amount: -1 }],
    exits: [{ id: "e1", label: "Down the well", sceneId: "00000000-0000-4000-8000-000000000001" }],
    reveals: [{ id: "v1", entryId: "00000000-0000-4000-8000-000000000002" }],
  });
  const scene = entry("plan", { kind: "scene", status: "active", prep });
  const quest = entry("quest", { kind: "quest", status: "open" });
  const prepared = { ...snapshot, codex: { ...codex, entries: [...codex.entries, scene, quest] } };
  const seen = (c: Ctx) => seatView({ snapshot: prepared, compiled, ctx: c }).codex.entries;
  for (const c of [
    ctx(member("player", [], ["lyra"]), "u-lyra"),
    ctx({ kind: "token", role: "player", characterIds: ["lyra"] }, null),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
    ctx(member("cogm", ["combat"]), "u-co"),
  ]) {
    const plan = seen(c).find((e) => e.id === "plan");
    assert.deepEqual([plan?.prep, plan?.status], [null, null]);
    assert.equal(seen(c).find((e) => e.id === "quest")?.status, "open"); // a quest's status is the party's to see
  }
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["codex"]), "u-co")]) {
    const plan = seen(c).find((e) => e.id === "plan");
    assert.deepEqual([plan?.prep, plan?.status], [prep, "active"]);
  }
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

test("a player and the table screen receive a handout's layout and header with the entry (house decision #72)", () => {
  const notice = entry("notice", { layout: "proclamation", header: "By order of the harbour" });
  const posted = { ...snapshot, codex: { ...codex, entries: [...codex.entries, notice] } };
  for (const c of [ctx(member("player"), "u-x"), ctx({ kind: "token", role: "screen", characterIds: [] }, null)]) {
    const seen = seatView({ snapshot: posted, compiled, ctx: c }).codex.entries.find((e) => e.id === "notice");
    assert.deepEqual([seen?.layout, seen?.header], ["proclamation", "By order of the harbour"]);
  }
});

test("every seat receives the recaps, whole", () => {
  for (const c of [ctx(member("player"), "u-x"), ctx(member("cogm"), "u-co"), ctx(member("gm"), "u-gm")])
    assert.deepEqual(seatView({ snapshot, compiled, ctx: c }).codex.recaps, codex.recaps);
});

test("the latest scene begin reaches the codex and secrets sides; a player, a bare co-GM and the screen get null (#105)", () => {
  const begin = (c: Ctx) => seatView({ snapshot, compiled, ctx: c }).codex.latestBegin;
  const blind = [ctx(member("player"), "u-x"), ctx(member("cogm"), "u-co")];
  for (const c of [...blind, ctx({ kind: "token", role: "screen", characterIds: [] }, null)])
    assert.equal(begin(c), null);
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["codex"]), "u-co")])
    assert.deepEqual(begin(c), codex.latestBegin);
});

test("a whisper reaches the GM side whole, its reader's seat with only that reader, nobody else", () => {
  const whispersOf = (c: Ctx) => seatView({ snapshot, compiled, ctx: c }).state.whispers;
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["session"]), "u-co")])
    assert.deepEqual(whispersOf(c), state.whispers);
  // Lyra's seat sees w1 with Lyra's reply only: never Bran's reply, name or existence, and never w2.
  assert.deepEqual(whispersOf(ctx(member("player", [], ["lyra"]), "u-lyra")), [
    { ...state.whispers[0]!, readers: [state.whispers[0]!.readers[0]!] },
  ]);
  assert.deepEqual(
    whispersOf(ctx({ kind: "token", role: "player", characterIds: ["bran"] })).map((w) =>
      w.readers.map((r) => r.actorId),
    ),
    [["bran"], ["bran"]],
  );
  for (const c of [
    ctx(member("player"), "u-x"),
    ctx(member("cogm"), "u-co"),
    ctx({ kind: "token", role: "screen", characterIds: [] }),
  ])
    assert.deepEqual(whispersOf(c), []);
});

test("the journal reaches the seats that run the room, the notes the session side; a player gets neither", () => {
  const journalOf = (c: Ctx) => seatView({ snapshot, compiled, ctx: c }).state.journal;
  for (const c of [ctx(member("gm"), "u-gm"), ctx(member("cogm", ["session"]), "u-co")])
    assert.deepEqual(journalOf(c), state.journal);
  for (const c of [
    ctx(member("player"), "u-x"),
    ctx(member("cogm"), "u-co"),
    ctx({ kind: "token", role: "screen", characterIds: [] }),
  ])
    assert.deepEqual(journalOf(c), []);
  // Without a GM every player runs the room: the list, with no notes in it (house decision #85).
  const gmless = { ...ctx(member("player"), "u-x"), tableMode: "gmless" as const };
  const ran = seatView({
    snapshot: { ...snapshot, state: { ...state, campaign: { ...state.campaign, tableMode: "gmless" } } },
    compiled,
    ctx: gmless,
  }).state.journal;
  assert.deepEqual(
    ran,
    state.journal.map((s) => ({ ...s, notes: "" })),
  );
});

test("an entry's reveal time goes with the entry, to the seats that read it (house decision #86)", () => {
  const stamped = {
    ...snapshot,
    codex: { ...codex, entries: codex.entries.map((e) => ({ ...e, revealedAt: `2026-03-01T10:00:00.000Z#${e.id}` })) },
  };
  const timesOf = (c: Ctx) =>
    seatView({ snapshot: stamped, compiled, ctx: c }).codex.entries.map((e) => [e.id, e.revealedAt]);
  assert.deepEqual(timesOf(ctx(member("player"), "u-x")), [["open", "2026-03-01T10:00:00.000Z#open"]]);
  assert.deepEqual(timesOf(ctx(member("player", [], ["lyra"]), "u-lyra")), [
    ["open", "2026-03-01T10:00:00.000Z#open"],
    ["for-lyra", "2026-03-01T10:00:00.000Z#for-lyra"],
  ]);
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

  // House decision #80: what a result offers is the GM side's, even for the character a seat holds or once revealed.
  test("a result's offers reach the GM side only", () => {
    const offers = [{ id: "o", label: "O", changes: [{ pool: "menace", label: "Menace", by: 1 }], applied: false }];
    const offered = two({ revealed: true, targets: [{ ...sum.targets[0]!, offers }] });
    assert.deepEqual(callFor(offered, ctx(member("gm"), "u-gm"))?.targets[0]?.offers, offers);
    const screen = ctx({ kind: "token", role: "screen", characterIds: [] }, null);
    for (const c of [lyra, bran, screen]) {
      assert.equal(
        (callFor(offered, c)?.targets ?? []).some((t) => t.offers !== undefined),
        false,
      );
    }
  });

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

test("the step TURN BACK would take reaches the combat side only (house decision #82)", () => {
  const turnBack = { kind: "turnStart" as const, name: "Wisp", round: 1, later: 2 };
  const withStep: Snapshot = { ...snapshot, state: { ...state, encounter: { ...state.encounter!, turnBack } } };
  const seen = (c: Ctx) => seatView({ snapshot: withStep, compiled, ctx: c }).state.encounter?.turnBack;
  assert.deepEqual(seen(ctx(member("gm"), "u-gm")), turnBack);
  assert.deepEqual(seen(ctx(member("cogm", ["combat"]), "u-co")), turnBack);
  assert.equal(seen(ctx(member("cogm", ["party"]), "u-co")), undefined);
  assert.equal(seen(ctx(member("player", [], ["lyra"]), "u-lyra")), undefined);
  assert.equal(seen(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), undefined);
});

test("requests: the answering side sees every pending request, a player their own, a screen none", () => {
  const request = (id: string, userId: string) =>
    ({
      id,
      userId,
      actorId: "lyra",
      resourceId: "luck",
      amount: 1,
      spendId: null,
      inputs: null,
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as const;
  const answer = (id: string, userId: string) =>
    ({
      id,
      userId,
      actorId: "lyra",
      resourceId: "luck",
      amount: 1,
      spendId: null,
      status: "denied",
      reason: "no",
    }) as const;
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

test("a spend-ask reaches every seat that receives each pool it costs, and one on no pool only its asker (#84)", () => {
  const spendCompiled = (() => {
    const cost = (over: object) => ({ amount: "1", ...over });
    const r = compileRuleset({
      ...SAMPLE_D20,
      spends: [
        { id: "onParty", label: "P", cite: "p.1", cost: [cost({ pool: "luck" })] },
        { id: "onGm", label: "G", cite: "p.1", cost: [cost({ pool: "menace" })] },
        { id: "onMe", label: "M", cite: "p.1", cost: [cost({ resource: "focus" })] },
      ],
    });
    assert.ok(r.ok);
    return r.compiled;
  })();
  const pool = (id: string, scope: "party" | "gm", visibility: "party" | "gm") =>
    ({ id, label: id, scope, value: 2, min: 0, max: 6, capped: true, visibility, editableBy: "gm" }) as const;
  const ask = (id: string, spendId: string) =>
    ({
      id,
      userId: "u-lyra",
      actorId: "lyra",
      resourceId: null,
      amount: null,
      spendId,
      inputs: null,
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as const;
  const asked: Snapshot = {
    ...snapshot,
    state: {
      ...state,
      pools: [pool("luck", "party", "party"), pool("menace", "gm", "gm")],
      requests: [ask("p", "onParty"), ask("g", "onGm"), ask("m", "onMe"), ask("x", "gone")],
    },
  };
  const seen = (c: Ctx) =>
    seatView({ snapshot: asked, compiled: spendCompiled, ctx: c })
      .state.requests.map((q) => q.id)
      .join("");
  assert.equal(seen(ctx(member("gm"), "u-gm")), "pgmx");
  assert.equal(seen(ctx(member("player", [], ["lyra"]), "u-lyra")), "pgmx");
  assert.equal(seen(ctx(member("player", [], ["kael"]), "u-kael")), "p");
  assert.equal(seen(ctx({ kind: "token", role: "screen", characterIds: [] }, null)), "p");
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
          v.codex.entries.filter(
            (e) => e.visibility === "gm" || e.gmNotes !== "" || e.plannedTests.length > 0 || e.prep !== null,
          ),
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

// A record a character holds under a kind with an unseen word (house decision #88): the holder and the GM side read its
// name, key and cite; another player and the table screen read the word and the same effects, and nothing else of it.
test("a held record's name, key and cite reach only the holder and the GM side", () => {
  const [character, ...rest] = SAMPLE_D20.entities ?? [];
  const made = compileRuleset({
    ...SAMPLE_D20,
    entities: [
      { ...character!, fields: { ...character!.fields, marks: { type: "list", label: "Marks", visibility: "owner" } } },
      ...rest,
      { id: "mark", label: "Mark", base: "ability", fields: {} },
    ],
    held: {
      mark: { label: "Marks", entry: "mark", field: "marks", entities: ["character"], unseen: "Unseen", cite: "S p.1" },
    },
  });
  assert.ok(made.ok);
  const effects = [{ path: "derived.defense", mode: "add", value: "1", phase: "derived" }];
  const record = { kind: "mark", key: "third-eye", name: "Third Eye", cite: "Sample p.31", effects };
  const marked: Snapshot = {
    ...snapshot,
    state: { ...state, actors: state.actors.map((a) => (a.id === "lyra" ? { ...a, held: [record] } : a)) },
  };
  const heldOn = (c: Ctx) =>
    seatView({ snapshot: marked, compiled: made.compiled, ctx: c }).state.actors.find((a) => a.id === "lyra")?.held;
  assert.deepEqual(heldOn(ctx(member("gm"), "u-gm")), [record]);
  assert.deepEqual(heldOn(ctx(member("player", [], ["lyra"]), "u-lyra")), [record]);
  for (const c of [
    ctx(member("player", [], ["bran"]), "u-bran"),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
  ]) {
    assert.deepEqual(heldOn(c), [{ kind: "mark", key: null, name: "Unseen", cite: null, effects }]);
    const sent = JSON.stringify(seatView({ snapshot: marked, compiled: made.compiled, ctx: c }));
    for (const secret of ["Third Eye", "third-eye", "Sample p.31"]) assert.ok(!sent.includes(secret), secret);
  }
});

test("a creature shown in full reaches a phone and the TV without its gm traits, values or conditions (#117)", () => {
  const made = compileRuleset({
    ...SAMPLE_D20,
    entities: [
      ...(SAMPLE_D20.entities ?? []).map((e) =>
        e.id === "creature" ? { ...e, fields: { ...e.fields, traits: { type: "list" as const, label: "Traits" } } } : e,
      ),
      { id: "trait", label: "Trait", base: "ability", fields: {} },
    ],
    held: { trait: { label: "Traits", entry: "trait", field: "traits", entities: ["creature"], cite: "S p.1" } },
  });
  assert.ok(made.ok);
  const effects = [{ path: "derived.maxHp", mode: "add", value: "1", phase: "derived" }];
  const record = { kind: "trait", key: "venom", name: "Venom", cite: "Sample p.31", effects };
  const shown: Snapshot = {
    ...snapshot,
    state: {
      ...state,
      actors: state.actors.map((a) =>
        a.id === "ogre"
          ? {
              ...a,
              fields: { ...a.fields, traits: ["venom"] },
              derived: { maxHp: 30 },
              conditions: ["marked"],
              held: [record],
            }
          : a,
      ),
    },
  };
  const ogreOn = (c: Ctx) =>
    seatView({ snapshot: shown, compiled: made.compiled, ctx: c }).state.actors.find((a) => a.id === "ogre");
  assert.deepEqual(ogreOn(ctx(member("gm"), "u-gm"))?.held, [record]);
  for (const c of [
    ctx(member("player", [], ["bran"]), "u-bran"),
    ctx({ kind: "token", role: "screen", characterIds: [] }, null),
  ]) {
    const ogre = ogreOn(c);
    assert.ok(ogre, "the shown Ogre is sent");
    assert.deepEqual(ogre.held, []);
    assert.equal(ogre.fields.traits, undefined);
    assert.equal(ogre.fields["attr.con"], undefined);
    assert.equal(ogre.derived.maxHp, undefined);
    assert.ok(!ogre.conditions.includes("marked"));
    assert.ok(!JSON.stringify(ogre).includes("Venom"));
  }
});
