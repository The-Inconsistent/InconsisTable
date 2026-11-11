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
import { seatView, type Snapshot } from "./view.ts";

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
    conditions: [{ id: "marked", left: null, expiresOn: "manual" }],
    ...over,
  }) satisfies Combatant;

const sum: TestCall = {
  id: "t-sum",
  testId: "check",
  dice: "1d20",
  advantage: true,
  pool: null,
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
  campaign: { id: "c1", name: "R", ownerUserId: "owner", archived: false, nextSessionAt: null, nextSessionPlace: "" },
  stateVersion: 1,
  session: { id: "s", number: 1, title: "", startedAt: "", endedAt: null, recap: "", notes: "session notes" },
  actors,
  myDraft: null,
  tests: [sum, pool],
  testDefs: [{ id: "check", dice: "1d20", advantage: true, pool: null, inputs: [] }],
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
  ...over,
});
const codex: Codex = {
  entries: [
    entry("secret", { visibility: "gm" }),
    entry("open"),
    entry("for-lyra", { audienceMode: "listed", audience: ["lyra", "kael"] }),
  ],
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
  assert.deepEqual(conditions(ctx(member("cogm", ["party"]), "u-co")), []); // the marks stay on the combat side
  assert.deepEqual(conditions(ctx(member("player", [], ["lyra"]), "u-lyra")), []);
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
