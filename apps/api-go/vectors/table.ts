// Writes what the TypeScript side answers for the table socket, for the Go tests to match (docs/adr/0008-go-api.md):
// the Seat view (reference/, the TypeScript view the Go one is held to) over synthetic snapshots and every kind of
// seat, and the core Action union and the book schemas on valid and broken input. Generated on every run and never committed. Every snapshot here is made up.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { seatView, type Snapshot } from "./reference/view.ts";
import {
  Action,
  BookAck,
  BookPage,
  BookServing,
  type Ctx,
  HandoutLayout,
  type Seat,
} from "../../../packages/core-schema/src/index.ts";
import { compileRuleset } from "../../../packages/rules-engine/src/compile.ts";
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";

const VIEW_OUT = join(import.meta.dirname, "../internal/coreschema/testdata/views.json");
const ACTION_OUT = join(import.meta.dirname, "../internal/coreschema/testdata/actions.json");

// ---- Seat views ----

const compiled = (() => {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error("SAMPLE_D20 does not compile");
  return r.compiled;
})();

const U = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const [PC1, PC2, PAL, NPC, GOB, GHOST] = [1, 2, 3, 4, 5, 6].map(U) as [string, string, string, string, string, string];
const [CB1, CB2, CB3, CB4, CB5] = [11, 12, 13, 14, 15].map(U) as [string, string, string, string, string];

const values = (over: Record<string, unknown> = {}) => ({
  entity: "character",
  fields: {
    name: "A",
    level: 3,
    "attr.str": 12,
    "attr.dex": 14,
    "attr.con": 10,
    diary: "mine",
    secret: "gm only",
    tags: ["x", "y"],
  },
  resources: { hp: 7, tempHp: 0, focus: 1, menace: 2 },
  derived: { maxHp: 20, baseHp: 6, initBonus: 2, defense: 12 },
  conditions: ["dazed", "marked", "unknownCondition"],
  conditionTimers: [
    { id: "dazed", expiresOn: "roundEnd", expiresAfter: 2 },
    { id: "marked", expiresOn: "manual", expiresAfter: null },
    { id: "unknownCondition", expiresOn: "manual", expiresAfter: null },
  ],
  ledger: null,
  ...over,
});

const actor = (id: string, kind: string, name: string, owner: string | null, over: Record<string, unknown> = {}) => ({
  id,
  kind,
  name,
  status: "active",
  ownerUserId: owner,
  ...values(over),
});

// A saved ledger build and sheet (house decision #63): the GM side and the seat holding the character read it.
const ledger = (archetypeId: string) => ({
  build: { tier: 1, archetypeId, gm: { approved: ["x/y"] } },
  sheet: { species: "Heron-kin", archetype: archetypeId, attributes: { MGT: 2 } },
  draft: null,
  // In play (house decision #64).
  xpSpent: 12,
  xpAtAscension: 40,
  packageWaived: true,
});
// An unfinished draft and no build yet: it reaches the same seats.
const draftOnly = (archetypeId: string) => ({
  build: null,
  sheet: null,
  draft: { tier: 1, archetypeId, gm: {} },
  xpSpent: 0,
  xpAtAscension: 0,
  packageWaived: false,
});
// A row that holds only an Ascension's bookkeeping: the documents are null, the figures set.
const playOnly = { build: null, sheet: null, draft: null, xpSpent: 0, xpAtAscension: 25, packageWaived: true };

const ACTORS = [
  actor(PC1, "pc", "One", "player1", { ledger: ledger("one") }),
  actor(PC2, "pc", "Two", null, { ledger: draftOnly("two") }),
  actor(PAL, "companion", "Pal", "player1", { conditions: ["staggered"], conditionTimers: [], ledger: playOnly }),
  actor(NPC, "npc", "Keeper", null, {
    entity: "creature",
    fields: { name: "K", level: 2, "attr.con": 12 },
    ledger: ledger("keeper"),
  }),
  actor(GOB, "creature", "Goblin", null, {
    entity: "creature",
    fields: { name: "G", level: 1, healthState: "ok" },
    resources: { hp: 4 },
    derived: { maxHp: 7 },
  }),
  actor(GHOST, "creature", "Ghost", null, { entity: "noSuchEntity" }),
];

const combatant = (id: string, actorId: string, visibility: string, over: Record<string, unknown> = {}) => ({
  id,
  actorId,
  name: actorId,
  side: "foe",
  ord: 0,
  initiative: 12,
  visibility,
  keep: true,
  hp: { value: 4, max: 7 },
  bar: 0.5,
  states: [{ id: "hurt", label: "Hurt" }],
  members: null,
  conditions: [
    { id: "dazed", left: 1, expiresOn: "roundEnd", stacks: 2 },
    { id: "marked", left: null, expiresOn: "manual" },
  ],
  ...over,
});

const report = (natural: number) => ({
  natural,
  total: natural + 2,
  outcome: "success",
  margin: 3,
  shifts: 1,
  flags: ["wrath"],
});

const call = (id: string, over: Record<string, unknown>) => ({
  id,
  testId: "check",
  dice: "1d20",
  advantage: true,
  pool: null,
  outcomes: null,
  status: "open",
  createdAt: "2026-11-01T10:00:00.000Z",
  inputs: { ability: "dex", dc: 15 },
  secretInputs: ["dc"],
  showTarget: false,
  showModifier: true,
  showOutcome: false,
  revealed: false,
  called: 2,
  reported: 1,
  targets: [
    {
      actorId: PC1,
      modifier: 2,
      target: 15,
      pool: null,
      report: report(11),
      // The GM side's only (house decision #80): no seat below it, nor the screen, receives them.
      offers: [
        { id: "shaken", label: "Shaken", changes: [{ pool: "menace", label: "Menace", by: 1 }], applied: false },
        { id: "strain", label: "Strain", changes: [{ resource: "tempHp", label: "Spare", by: 4 }], applied: true },
      ],
    },
    { actorId: PC2, modifier: 1, target: 15, pool: 3, report: null },
  ],
  ...over,
});

const STATE = {
  campaign: {
    id: U(100),
    name: "Room",
    ownerUserId: "owner",
    archived: false,
    nextSessionAt: null,
    nextSessionPlace: "",
    tableMode: "gm",
    safety: { lines: ["Line one"], veils: ["Veil one"], xCard: true },
    fields: { danger: 2, edge: "open", dark: false },
    worldVersionId: U(990),
  },
  stateVersion: 9,
  session: {
    id: U(101),
    number: 2,
    title: "Two",
    startedAt: "2026-11-01T09:00:00.000Z",
    endedAt: null,
    recap: "",
    notes: "GM notes",
  },
  actors: ACTORS,
  clocks: [
    { id: U(700), name: "Ritual", segments: 6, filled: 2, visibility: "party", entryId: U(501), position: 1 },
    { id: U(701), name: "Reinforcements", segments: 4, filled: 4, visibility: "gm", entryId: null, position: 2 },
    { id: U(702), name: "Cult", segments: 8, filled: 0, visibility: "party", entryId: U(500), position: 3 },
    { id: U(703), name: "Heist", segments: 12, filled: 7, visibility: "gm", entryId: U(503), position: 4 },
    { id: U(704), name: "Storm", segments: 2, filled: 1, visibility: "party", entryId: U(503), position: 5 },
  ],
  requests: [
    {
      id: U(800),
      userId: "player1",
      actorId: PC1,
      resourceId: "luck",
      amount: 2,
      note: "for the jump",
      createdAt: "2026-11-01T09:05:00.000Z",
    },
    {
      id: U(801),
      userId: "player2",
      actorId: PC2,
      resourceId: "luck",
      amount: 1,
      note: "",
      createdAt: "2026-11-01T09:06:00.000Z",
    },
    {
      id: U(802),
      userId: "owner",
      actorId: null,
      resourceId: "doom",
      amount: 3,
      note: "",
      createdAt: "2026-11-01T09:07:00.000Z",
    },
  ],
  requestAnswers: [
    { id: U(810), userId: "player1", actorId: PC1, resourceId: "luck", amount: 1, status: "denied", reason: "not now" },
    { id: U(811), userId: "player2", actorId: PC2, resourceId: "luck", amount: 1, status: "approved", reason: "" },
  ],
  rolls: [
    {
      id: U(820),
      tableId: "season",
      entryId: "frost",
      label: "Frost",
      value: 5,
      visibility: "party",
      at: "2026-11-01T09:10:00.000Z",
    },
    {
      id: U(821),
      tableId: "omen",
      entryId: "dread",
      label: "Dread",
      value: 2,
      visibility: "gm",
      at: "2026-11-01T09:11:00.000Z",
    },
  ],
  dealt: [
    { tableId: "role", actorId: PC1, entryId: "mole", label: "Mole", visibility: "owner" },
    { tableId: "role", actorId: PC2, entryId: "host", label: "Host", visibility: "owner" },
    { tableId: "scenario", actorId: PC1, entryId: "famine", label: "Famine", visibility: "party" },
    { tableId: "fate", actorId: PAL, entryId: "doom", label: "Doom", visibility: "gm" },
  ],
  myDraft: null,
  tests: [
    call(U(200), {}),
    call(U(201), { showTarget: true, secretInputs: [], showOutcome: true }),
    call(U(202), { status: "closed", revealed: true, showModifier: false }),
    call(U(203), { targets: [{ actorId: PC2, modifier: 1, target: 9, pool: null, report: report(4) }], called: 1 }),
    call(U(204), { status: "closed", targets: [] }),
  ],
  testDefs: [
    {
      id: "check",
      dice: "1d20",
      advantage: true,
      pool: null,
      outcomes: null,
      entities: ["character"],
      inputs: [
        { id: "ability", type: "text", options: ["str", "dex"] },
        { id: "dc", type: "int" },
      ],
      label: "Check",
      inputLabels: { ability: "Ability" },
      inputOptionLabels: { ability: { str: "Strength" } },
    },
  ],
  encounter: {
    id: U(300),
    round: 2,
    currentId: CB3,
    firstId: CB1,
    phaseId: null,
    phases: [],
    done: [CB1, CB3],
    firstPlayer: null,
    paused: false,
    health: { resource: "hp", temp: "tempHp", deathSaves: true },
    conditionDefs: [{ id: "dazed", label: "Dazed", duration: "roundEnd" }],
    endMet: [],
    scoring: null,
    combatants: [
      combatant(CB1, PC1, "full", { side: "party", ord: 0 }),
      combatant(CB2, GOB, "full", { ord: 1 }),
      combatant(CB3, GOB, "hidden", { ord: 2 }),
      combatant(CB4, NPC, "bar", { ord: 3, hp: null, bar: 0.25, members: { value: 3, max: 12 } }),
      combatant(CB5, GHOST, "full", { ord: 4 }),
    ],
    // A line naming the hidden combatant's actor: the combat side's only (house decision #81).
    reminders: [{ at: "roundEnd", source: "reminder", id: "heldLost", text: "Held", cite: null, actorIds: [GOB] }],
    // TURN BACK's step, naming whoever's turn it was: the combat side's only (house decision #82).
    turnBack: { kind: "turnStart", name: "Goblin", round: 2, later: 3 },
  },
  games: [],
  access: {
    members: [{ userId: "player1", name: "P", role: "player", scopes: [], characterIds: [PC1, PAL] }],
    invites: [
      {
        id: U(400),
        mode: "room",
        role: "player",
        actorId: null,
        allowGuests: true,
        expiresAt: "2026-11-02T00:00:00.000Z",
        uses: 0,
        maxUses: null,
      },
    ],
    guests: [{ actorId: PC2 }],
    screens: 1,
    transfer: null,
  },
  pools: [
    {
      id: "pub",
      label: "pub",
      scope: "party",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "public",
      editableBy: "gm",
    },
    {
      id: "shared",
      label: "shared",
      scope: "party",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "party",
      editableBy: "gm",
    },
    {
      id: "mine",
      label: "mine",
      scope: "party",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "owner",
      editableBy: "gm",
    },
    {
      id: "secret",
      label: "secret",
      scope: "party",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "gm",
      editableBy: "gm",
    },
    {
      id: "hoard",
      label: "hoard",
      scope: "gm",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "gm",
      editableBy: "gm",
    },
    {
      id: "gmOwner",
      label: "gmOwner",
      scope: "gm",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "owner",
      editableBy: "gm",
    },
    {
      id: "camp",
      label: "camp",
      scope: "campaign",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "owner",
      editableBy: "gm",
    },
    {
      id: "campPub",
      label: "campPub",
      scope: "campaign",
      value: 2,
      min: 0,
      max: 6,
      capped: true,
      visibility: "public",
      editableBy: "gm",
    },
    {
      id: "free",
      label: "free",
      scope: "party",
      value: 9,
      min: 0,
      max: null,
      capped: false,
      visibility: "party",
      editableBy: "owner",
    },
  ],
};

const entry = (
  id: string,
  visibility: string,
  audienceMode: string,
  audience: string[],
  over: Record<string, unknown> = {},
) => ({
  id,
  kind: "handout",
  title: id,
  body: "text",
  gmNotes: "notes",
  visibility,
  audienceMode,
  audience,
  status: null,
  parentId: null,
  position: 0,
  links: [] as string[],
  plannedTests: [] as string[],
  imageId: null as string | null,
  imageRevealed: false,
  fields: {} as Record<string, unknown>,
  // A handout's layout and header (house decision #72); null on every other kind.
  layout: (over.kind ?? "handout") === "handout" ? "tablet" : null,
  header: (over.kind ?? "handout") === "handout" ? "Read aloud" : null,
  prep: null as unknown,
  ...over,
});

const CODEX = {
  entries: [
    entry(U(500), "gm", "all", []),
    entry(U(501), "party", "all", []),
    entry(U(502), "public", "listed", [PC1, PC2], { layout: "transcript", header: "" }),
    entry(U(503), "party", "listed", [PC2], { layout: "proclamation" }),
    entry(U(504), "gm", "listed", [PC1]),
    // A hidden adventure with a shown scene, a shown adventure, and a quest: a link or a parent to a hidden entry must
    // not reach a seat that can't see it, and planned Tests never reach one without the GM side.
    entry(U(505), "gm", "all", [], { kind: "adventure" }),
    entry(U(506), "party", "all", [], { kind: "adventure", position: 1 }),
    entry(U(507), "party", "all", [], {
      kind: "scene",
      parentId: U(505),
      links: [U(500), U(501), U(502), U(504)],
      plannedTests: ["check", "gone"],
      // Prepared lines and the active status reach the codex and secrets sides only (house decision #73).
      status: "active",
      prep: {
        roster: [{ id: "r", pack: "sample", key: "ember-wisp", count: 2, visibility: "hidden", temporary: true }],
        tests: [],
        pools: [{ id: "p", pool: "menace", amount: 2, text: "" }],
        exits: [{ id: "x", label: "On", sceneId: U(508) }],
        reveals: [{ id: "v", entryId: U(500) }],
      },
    }),
    // Mentions in a body: a hidden entry's title never reaches a seat that can't see it, nor does a deleted id's.
    entry(U(508), "party", "all", [], {
      kind: "scene",
      status: "planned",
      parentId: U(506),
      position: 1,
      links: [U(501)],
      body: `see @[Hidden one](${U(500)}), @[Shown](${U(501)}) and @[Gone](${U(999)})`,
    }),
    entry(U(509), "party", "all", [], { kind: "quest", status: "done" }),
    // A tree of places with its middle hidden (house decision #69): below it, a seat that can't read it gets a root.
    entry(U(510), "party", "all", [], { kind: "location" }),
    entry(U(511), "gm", "all", [], { kind: "location", parentId: U(510) }),
    entry(U(512), "party", "all", [], { kind: "location", parentId: U(511) }),
    entry(U(513), "party", "listed", [PC1], { kind: "location", parentId: U(512), position: 1 }),
    // Pictures (house decision #70): held back, shown, shown on a hidden entry, shown to a listed reader.
    entry(U(520), "party", "all", [], { kind: "npc", imageId: U(700) }),
    entry(U(521), "party", "all", [], { kind: "location", imageId: U(701), imageRevealed: true }),
    entry(U(522), "gm", "all", [], { kind: "npc", imageId: U(702), imageRevealed: true }),
    entry(U(523), "party", "listed", [PC1], { imageId: U(703), imageRevealed: true }),
    entry(U(524), "party", "all", [], { imageRevealed: true }),
    // Declared fields (house decision #71): a `gm` one reaches only the side that reads GM notes; one the ruleset does
    // not declare for the kind, or that no longer fits, reaches nobody.
    entry(U(530), "party", "all", [], {
      kind: "npc",
      fields: { mood: "cold", disposition: -2, patron: "ember-wisp", gone: "x", standing: "ally", home: U(510) },
    }),
    entry(U(531), "gm", "all", [], { kind: "npc", fields: { mood: "sulky", disposition: 9, patron: "" } }),
    entry(U(532), "party", "listed", [PC1], { kind: "faction", fields: { standing: "rival", seat: U(510) } }),
    // Links between entries (house decision #76): a party link to a hidden place, to a place only one reader reads, to
    // an entry deleted, and to an entry of another kind; only a link to an entry the seat receives reaches it.
    entry(U(533), "party", "all", [], { kind: "npc", fields: { home: U(511), mood: "warm" } }),
    entry(U(534), "party", "all", [], { kind: "npc", fields: { home: U(513) } }),
    entry(U(535), "party", "all", [], { kind: "npc", fields: { home: U(999) } }),
    entry(U(536), "gm", "all", [], { kind: "npc", fields: { home: U(532) } }),
    entry(U(537), "gm", "all", [], { kind: "faction", fields: { seat: U(511) } }),
  ],
  recaps: [
    { sessionId: U(600), number: 2, title: "The bridge", endedAt: "2026-02-01T10:00:00.000Z", recap: "They crossed." },
    { sessionId: U(601), number: 1, title: "", endedAt: "2026-01-01T10:00:00.000Z", recap: "They met." },
  ],
};

const DRAFTS = { player1: { actorId: PC1, answers: { name: "One" } }, owner: { actorId: PC2, answers: {} } };

const member = (role: "gm" | "cogm" | "player", scopes: string[], characterIds: string[]): Seat =>
  ({ kind: "member", role, scopes, characterIds }) as Seat;
const SEATS: { name: string; userId: string | null; seat: Seat }[] = [
  { name: "owner as player", userId: "owner", seat: member("player", [], []) },
  { name: "gm", userId: "gm1", seat: member("gm", [], []) },
  { name: "cogm none", userId: "c0", seat: member("cogm", [], []) },
  { name: "cogm combat", userId: "c1", seat: member("cogm", ["combat"], []) },
  { name: "cogm codex", userId: "c2", seat: member("cogm", ["codex"], []) },
  { name: "cogm secrets", userId: "c3", seat: member("cogm", ["codex.secrets"], []) },
  { name: "cogm party", userId: "c4", seat: member("cogm", ["party"], []) },
  { name: "cogm session", userId: "c5", seat: member("cogm", ["session"], []) },
  { name: "cogm combat party", userId: "c6", seat: member("cogm", ["combat", "party"], [PC2]) },
  { name: "player with characters", userId: "player1", seat: member("player", [], [PC1, PAL]) },
  { name: "player without", userId: "player2", seat: member("player", [], []) },
  { name: "guest", userId: null, seat: { kind: "token", role: "player", characterIds: [PC2] } },
  { name: "screen", userId: null, seat: { kind: "token", role: "screen", characterIds: [] } },
  { name: "admin", userId: null, seat: { kind: "admin" } },
];

const BASE_SNAPSHOTS: {
  name: string;
  state: unknown;
  codex: unknown;
  drafts: Record<string, unknown>;
  ruleset: boolean;
}[] = [
  { name: "full", state: STATE, codex: CODEX, drafts: DRAFTS, ruleset: true },
  { name: "no ruleset", state: STATE, codex: CODEX, drafts: DRAFTS, ruleset: false },
  {
    name: "quiet",
    state: {
      ...STATE,
      campaign: { ...STATE.campaign, worldVersionId: null },
      session: null,
      encounter: null,
      tests: [],
      actors: [],
    },
    codex: { entries: [], recaps: [] },
    drafts: {},
    ruleset: true,
  },
  {
    name: "no health track",
    state: { ...STATE, encounter: { ...STATE.encounter, health: null, currentId: CB1, firstId: CB3 } },
    codex: CODEX,
    drafts: {},
    ruleset: true,
  },
  {
    // A sides order (house decision #60) with a hidden combatant: the side ids are public and the flags travel with the
    // combatant, so a seat that may not see the hidden one is told nothing of it.
    name: "sides fight",
    state: {
      ...STATE,
      encounter: {
        ...STATE.encounter,
        currentId: CB3,
        done: [CB1],
        combatants: STATE.encounter.combatants.map((c, i) => ({
          ...c,
          side: i < 2 ? "wardens" : "raiders",
          held: i === 1,
          barred: i === 2,
          unable: i === 3,
        })),
        begun: true,
        lastSide: "wardens",
        outOfTurnSide: null,
        sideUp: "raiders",
      },
    },
    codex: CODEX,
    drafts: {},
    ruleset: true,
  },
  {
    // A sides fight that has not begun, with nobody up yet.
    name: "sides fight not begun",
    state: {
      ...STATE,
      encounter: {
        ...STATE.encounter,
        currentId: null,
        done: [],
        combatants: STATE.encounter.combatants.map((c) => ({
          ...c,
          side: "wardens",
          held: false,
          barred: true,
          unable: false,
        })),
        begun: false,
        lastSide: null,
        outOfTurnSide: "wardens",
        sideUp: null,
      },
    },
    codex: CODEX,
    drafts: {},
    ruleset: true,
  },
  {
    // An ended game beside a scored, phased fight, and an open Dice pool Test whose number stays hidden.
    name: "ended game",
    state: {
      ...STATE,
      tests: [
        call(U(205), {
          dice: "d6 pool",
          advantage: false,
          pool: { die: 6, bands: [{ id: "hit", from: 4, to: 6, worth: 1 }], special: null, shift: null },
          targets: [{ actorId: PC1, modifier: 1, target: 3, pool: 5, report: null }],
          called: 1,
          reported: 0,
        }),
      ],
      encounter: {
        ...STATE.encounter,
        phaseId: "plan",
        phases: [
          { id: "plan", label: "Plan", mode: "simultaneous" },
          { id: "act", label: "Act", mode: "turns" },
        ],
        endMet: [0],
        scoring: { mode: "compete" },
      },
      games: [
        {
          encounterId: U(301),
          endedAt: "2026-11-01T11:00:00.000Z",
          endedEarly: false,
          mode: "compete",
          rows: [
            { resultId: U(600), actorId: PC1, name: "One", score: 9, tiebreaks: [2], place: 1, outcome: null },
            { resultId: U(601), actorId: null, name: "Gone", score: 4, tiebreaks: [1], place: 2, outcome: null },
          ],
        },
        {
          encounterId: U(302),
          endedAt: "2026-11-01T10:30:00.000Z",
          endedEarly: true,
          mode: "coop",
          rows: [
            { resultId: U(602), actorId: PC2, name: "Two", score: 0, tiebreaks: [], place: null, outcome: "lose" },
          ],
        },
      ],
    },
    codex: CODEX,
    drafts: {},
    ruleset: true,
  },
];

// Each snapshot once per table mode: the mode is the campaign row's, so it rides in the snapshot
// (docs/adr/0009-table-modes.md).
const MODES = ["gm", "gmless", "solo"] as const;
const SNAPSHOTS = BASE_SNAPSHOTS.flatMap((s) =>
  MODES.map((mode) => ({
    ...s,
    name: mode === "gm" ? s.name : `${s.name} (${mode})`,
    state: { ...(s.state as typeof STATE), campaign: { ...(s.state as typeof STATE).campaign, tableMode: mode } },
  })),
);

// Every seat reads every snapshot. A room not run by a GM is also read through a Ctx still holding the mode it was
// handed before the table changed: the snapshot's mode wins, so the view comes out the same.
const views = SNAPSHOTS.flatMap((snap) =>
  SEATS.flatMap(({ name, userId, seat }) =>
    (snap.state.campaign.tableMode === "gm" ? ["fresh"] : ["fresh", "stale"]).map((handed) => {
      const tableMode = handed === "fresh" ? snap.state.campaign.tableMode : "gm";
      const ctx: Ctx = { campaignId: U(100), userId, campaignOwnerId: "owner", tableMode, seat };
      const snapshot = {
        state: snap.state,
        codex: snap.codex,
        drafts: new Map(Object.entries(snap.drafts)),
      } as unknown as Snapshot;
      const v = seatView({ snapshot, compiled: snap.ruleset ? compiled : null, ctx });
      return {
        snapshot: snap.name,
        seatName: handed === "fresh" ? name : `${name} (stale ctx)`,
        ctx,
        packVisibilities: v.packVisibilities,
        state: v.state,
        codex: v.codex,
        manifest: v.manifest,
      };
    }),
  ),
);

mkdirSync(dirname(VIEW_OUT), { recursive: true });
writeFileSync(
  VIEW_OUT,
  JSON.stringify({
    manifest: SAMPLE_D20,
    snapshots: Object.fromEntries(SNAPSHOTS.map((s) => [s.name, s])),
    views,
  }),
);

// ---- Actions and book schemas ----

const ID = U(900);
const VALID: Record<string, Record<string, unknown>> = {
  "campaign.update": { name: " Room ", nextSessionAt: "2026-11-20T19:00:00+07:00", nextSessionPlace: " Here " },
  "campaign.archive": {},
  "campaign.unarchive": {},
  "campaign.delete": { name: "Room" },
  "campaign.transfer": { toUserId: "u2" },
  "campaign.transferCancel": {},
  "campaign.transferAccept": {},
  "campaign.setRuleset": { rulesetVersionId: ID },
  "campaign.unpinRuleset": {},
  "campaign.setTableMode": { mode: "gmless" },
  "campaign.setField": { fieldId: "danger", value: 3 },
  "campaign.attachPack": { packVersionId: ID },
  "campaign.detachPack": { packVersionId: ID },
  "campaign.setWorld": { worldVersionId: ID },
  "campaign.unsetWorld": {},
  "session.start": { title: " Night " },
  "session.end": { recap: "done", award: 20 },
  "session.edit": { sessionId: ID, title: "t", recap: "r", notes: "n" },
  "actor.create": { kind: "npc", name: " Keeper ", entityType: "creature" },
  "actor.build": { actorId: ID, answers: { name: "x", n: 1 } },
  "build.save": { actorId: ID, build: '{"tier":1,"archetypeId":"a"}', draft: true },
  "build.ascend": { kind: "milestone", waivePackage: true },
  "actor.spawn": { packVersionId: ID, key: "goblin", count: 3, temporary: true, visibility: "bar", name: " Wisps " },
  "draft.save": { body: { actorId: ID, answers: { a: [1, 2] } } },
  "draft.discard": {},
  "actor.rename": { id: ID, name: "New" },
  "actor.delete": { id: ID },
  "rule.op": { primitive: "resource.capped", op: "adjust", input: { delta: -1 } },
  "field.set": { actorId: ID, field: "level", value: 3 },
  "condition.add": { actorId: ID, condition: "dazed", source: "x", expiresAfter: 2 },
  "condition.remove": { actorId: ID, condition: "dazed" },
  "actor.rest": { event: "longRest", actorId: ID },
  "event.undo": {},
  "event.turnBack": {},
  "encounter.start": {},
  "encounter.end": {},
  "encounter.add": { actorIds: [ID], side: "foe", visibility: "hidden" },
  "encounter.remove": { combatantId: ID },
  "encounter.setInitiative": { combatantId: ID, score: 12 },
  "encounter.move": { combatantId: ID, direction: "up" },
  "encounter.setVisibility": { combatantId: ID, visibility: "full" },
  "encounter.keep": { combatantId: ID, keep: true },
  "turn.next": {},
  "turn.prev": {},
  "turn.first": { combatantId: ID },
  "phase.done": { actorId: ID },
  "game.end": {},
  "result.set": { resultId: ID, score: -5 },
  "test.call": { testId: "check", actorIds: [ID], inputs: { dc: 15, ability: "dex", flag: true }, hideTarget: true },
  "test.report": { callId: ID, actorId: ID, advantage: "advantage", roll: { faces: [12, 4] } },
  "test.close": { callId: ID, reveal: true },
  "test.applyOffer": { callId: ID, actorId: ID, offerId: "shaken" },
  "invite.create": { mode: "character", role: "cogm", actorId: ID, allowGuests: false, hours: 24 },
  "invite.revoke": { id: ID },
  "member.remove": { userId: "u2" },
  "member.appoint": { userId: "u2", role: "cogm", scopes: ["combat", "codex.secrets"] },
  "member.seat": { userId: "u2" },
  "seat.leave": {},
  "token.issue": { actorId: ID },
  "token.revoke": { actorId: ID },
  "screen.issue": {},
  "screen.revoke": {},
  "codex.save": {
    id: ID,
    kind: "npc",
    title: " T ",
    body: "b",
    gmNotes: "g",
    status: "failed",
    plannedTests: ["check", "x".repeat(100)],
    imageId: ID,
    fields: { mood: "cold", disposition: -2, patron: null, flag: true },
    layout: "proclamation",
    header: " Notice ",
    prep: { exits: [{ id: "e", label: " On ", sceneId: ID }] },
  },
  "codex.move": { id: ID, parentId: null, position: 2 },
  "codex.link": { id: ID, targetId: ID },
  "codex.unlink": { id: ID, targetId: ID },
  "codex.reveal": { id: ID, visibility: "party", audienceMode: "listed", audience: [ID], imageRevealed: true },
  "codex.delete": { id: ID },
  "clock.create": { name: " Ritual ", segments: 6, visibility: "party", entryId: ID },
  "clock.tick": { id: ID, delta: -3 },
  "clock.update": { id: ID, name: " Cult ", segments: 8, visibility: "gm", entryId: ID },
  "clock.delete": { id: ID },
  "request.send": { actorId: ID, resourceId: "luck", amount: 3, note: " please " },
  "request.cancel": { id: ID },
  "request.approve": { id: ID },
  "request.deny": { id: ID, reason: " not now " },
  "campaign.setSafety": { lines: [" Line one ", "Line two"], veils: [], xCard: false },
  "safety.suggest": { kind: "veil", text: " Veil one " },
  "safety.xcard": {},
  "table.roll": { tableId: "season" },
  "table.deal": { tableId: "role", actorIds: [ID] },
  "table.reshuffle": { tableId: "role" },
};

const LONG_KEYS = new Set(["recap", "notes", "body", "gmNotes", "value"]);
const lengths = (key: string) => [
  0,
  1,
  ...[20, 40, 60, 64, 80, 100, 120, 200, 1000].flatMap((n) => [n, n + 1]),
  ...(LONG_KEYS.has(key) ? [10_000, 10_001, 20_000, 20_001] : []),
];
const NUMBERS = [
  -2147483649, -1000001, -1001, -1, 0, 1, 1.5, 12, 20, 21, 50, 720, 721, 1000, 1001, 5001, 2147483648, 1e300,
];
const JUNK: unknown[] = [null, true, 0, "", "not-a-uuid", [], {}, ["x"], { k: 1 }];

const mutations = (key: string, sample: unknown): unknown[] => {
  const out: unknown[] = [...JUNK];
  if (typeof sample === "string") out.push(...lengths(key).map((n) => "x".repeat(n)), " ", ID.toUpperCase());
  if (typeof sample === "number") out.push(...NUMBERS);
  if (Array.isArray(sample)) {
    out.push(
      Array.from({ length: 51 }, () => sample[0]),
      Array.from({ length: 6 }, () => sample[0]),
      [1],
      [null],
    );
  }
  if (sample !== null && typeof sample === "object" && !Array.isArray(sample)) {
    out.push({ ["k".repeat(121)]: 1 }, { ["k".repeat(64)]: "x".repeat(101) }, { k: [1, "a", true, null] });
  }
  return out;
};

const ACTION_SCHEMAS: Record<string, z.ZodType> = { Action, BookPage, BookServing, BookAck };
const actions: unknown[] = [];
const record = (schema: string, input: unknown) => {
  const r = (ACTION_SCHEMAS[schema] as z.ZodType).safeParse(input);
  actions.push({ schema, input, ok: r.success, ...(r.success ? { output: r.data } : {}) });
};

for (const [type, sample] of Object.entries(VALID)) {
  record("Action", { type, ...sample });
  record("Action", { type });
  record("Action", { type, ...sample, extra: 1 });
  for (const [key, value] of Object.entries(sample)) {
    const { [key]: _gone, ...rest } = sample;
    record("Action", { type, ...rest });
    for (const m of mutations(key, value)) record("Action", { type, ...sample, [key]: m });
  }
}
for (const junk of [null, 1, "x", [], {}, { type: "nope" }, { type: 1 }]) record("Action", junk);
// The lines and veils stop at 30 items of 1 to 80 characters.
for (const n of [29, 30, 31]) {
  record("Action", { type: "campaign.setSafety", lines: Array.from({ length: n }, () => "a"), veils: [], xCard: true });
}
for (const text of ["", " ", "a".repeat(80), "a".repeat(81), ` ${"a".repeat(80)} `]) {
  record("Action", { type: "safety.suggest", kind: "line", text });
  record("Action", { type: "campaign.setSafety", lines: [text], veils: [text], xCard: true });
}
record("Action", { type: "safety.suggest", kind: "other", text: "a" });
// An entry's declared fields (house decision #71): at most 20 keys of 1 to 64 characters, each a field value or null.
for (const fields of [
  Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, i])),
  Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, i])),
  { "": 1 },
  { ["x".repeat(64)]: 1 },
  { ["x".repeat(65)]: 1 },
  { a: 1.5 },
  { a: 2 ** 31 },
  { a: "x".repeat(10_001) },
  { a: ["x"] },
  { a: { b: 1 } },
  [],
  "x",
]) {
  record("Action", { type: "codex.save", kind: "npc", fields });
}
// Every handout layout the platform draws, and one it does not (house decision #72).
for (const layout of [...HandoutLayout.options, "scroll", "PLAIN"]) {
  record("Action", { type: "codex.save", kind: "handout", title: "H", layout });
}
// A reported Test's report carries an outcome id and no dice (house decision #41).
const reportBase = { type: "test.report", callId: ID, actorId: ID };
for (const extra of [
  { outcome: "clean" },
  { outcome: "" },
  { outcome: "x".repeat(64) },
  { outcome: "x".repeat(65) },
  { outcome: 1 },
  { outcome: "clean", roll: { faces: [1] } },
  { outcome: "clean", advantage: "none" },
  { roll: { faces: [1] } },
  { roll: { faces: [1] }, advantage: "advantage" },
  {},
]) {
  record("Action", { ...reportBase, ...extra });
}
// A scene's prepared lines (house decision #73): every kind, every limit, the size cap, an unknown kind, null.
const LINES: Record<string, Record<string, unknown>> = {
  roster: { id: "r", pack: "sample", key: "ember-wisp", count: 3, mob: 12, visibility: "bar", temporary: false },
  tests: {
    id: "t",
    testId: "check",
    inputs: { dc: 12, ability: "dex", flag: true },
    takers: "listed",
    actorIds: [ID],
    hideTarget: true,
    outcomes: [{ label: "Pass", text: "It opens." }],
  },
  pools: { id: "p", pool: "menace", amount: -3, text: "Spend" },
  exits: { id: "e", label: "Down", sceneId: ID },
  reveals: { id: "v", entryId: ID },
};
const prepSave = (prep: unknown) => record("Action", { type: "codex.save", id: ID, kind: "scene", prep });
for (const prep of [null, {}, { roster: [] }, { hazards: [] }, { roster: [], extra: 1 }, [], "x", 1]) prepSave(prep);
for (const [kind, sample] of Object.entries(LINES)) {
  prepSave({ [kind]: [sample] });
  prepSave({ [kind]: [{ id: "only" }] });
  prepSave({ [kind]: [{ ...sample, label: "l".repeat(80), note: "n".repeat(500) }] });
  prepSave({ [kind]: [{ ...sample, label: "l".repeat(81) }] });
  prepSave({ [kind]: [{ ...sample, note: "n".repeat(501) }] });
  prepSave({ [kind]: [{ ...sample, unknown: 1 }] });
  for (const n of [40, 41]) prepSave({ [kind]: Array.from({ length: n }, (_, i) => ({ ...sample, id: `l${i}` })) });
  prepSave({ [kind]: [sample, sample] }); // two lines, one id
  for (const [key, value] of Object.entries(sample)) {
    const { [key]: _gone, ...rest } = sample;
    prepSave({ [kind]: [rest] });
    for (const m of mutations(key, value)) prepSave({ [kind]: [{ ...sample, [key]: m }] });
  }
}
for (const count of [0, 1, 50, 51]) prepSave({ roster: [{ ...LINES.roster, count }] });
// A Test line's taker picked when it is sent (house decision #75).
for (const takers of ["party", "listed", "pick", "each", ""]) prepSave({ tests: [{ ...LINES.tests, takers }] });
// actor.spawn (house decision #75): up to 50, every view and hidden when none is said, a name of 1 to 80 trimmed.
const spawn = { type: "actor.spawn", packVersionId: ID, key: "goblin" };
for (const count of [1, 20, 21, 49, 50, 51]) record("Action", { ...spawn, count });
for (const visibility of ["hidden", "bar", "full", "stats", undefined])
  record("Action", { ...spawn, count: 1, visibility });
for (const name of ["", " ", " a ", "x".repeat(80), "x".repeat(81), ` ${"x".repeat(80)} `])
  record("Action", { ...spawn, count: 1, name });
for (const mob of [1, 2, 500, 501]) prepSave({ roster: [{ ...LINES.roster, mob }] });
for (const amount of [-1001, -1000, -1, 0, 1, 1000, 1001, 1.5]) prepSave({ pools: [{ ...LINES.pools, amount }] });
for (const n of [6, 7]) {
  const outcomes = Array.from({ length: n }, () => ({ label: "x".repeat(40), text: "y".repeat(500) }));
  prepSave({ tests: [{ ...LINES.tests, outcomes }] });
}
for (const label of ["", "x".repeat(40), "x".repeat(41)])
  prepSave({ tests: [{ ...LINES.tests, outcomes: [{ label, text: "" }] }] });
for (const label of ["", " ", " a ", "x".repeat(80), "x".repeat(81)]) prepSave({ exits: [{ ...LINES.exits, label }] });
for (const id of ["", "x".repeat(40), "x".repeat(41)]) prepSave({ reveals: [{ ...LINES.reveals, id }] });
prepSave({ roster: [{ ...LINES.roster, id: "same" }], reveals: [{ ...LINES.reveals, id: "same" }] });
// Just under and just over 32 KB, serialized: forty pool lines of a long text, with a note that tips it.
for (const n of [370, 380, 383, 384, 385, 386, 390, 400]) {
  prepSave({ pools: Array.from({ length: 40 }, (_, i) => ({ ...LINES.pools, id: `p${i}`, text: "é".repeat(n) })) });
}
// Every status codex.save takes; the api decides which a kind may hold.
for (const status of ["open", "done", "failed", "planned", "active", "skipped", "nope", null]) {
  record("Action", { type: "codex.save", id: ID, kind: "scene", status });
}
// A draft just under and just over 64 KB, serialized.
const pad = (n: number) => ({ type: "draft.save", body: { actorId: ID, answers: { p: "é".repeat(n) } } });
for (const n of [32_700, 32_730, 32_740, 32_760, 32_800, 40_000]) record("Action", pad(n));
// A ledger build's text just under and just over 64 KB in UTF-8 (text that is not JSON is the handler's to refuse).
for (const n of [32_767, 32_768, 32_769, 65_536])
  record("Action", { type: "build.save", actorId: ID, build: "é".repeat(n) });
for (const n of [65_535, 65_536, 65_537]) record("Action", { type: "build.save", actorId: ID, build: "x".repeat(n) });
// `draft` is a boolean, false when it is left out.
for (const draft of [false, "yes", 1, null]) record("Action", { type: "build.save", actorId: ID, build: "{}", draft });
record("Action", { type: "build.save", actorId: ID, build: "{}" });
for (const nextSessionAt of [
  "2026-11-20T19:00:00Z",
  "2026-11-20T19:00Z",
  "2026-11-20T19:00:00.123+07:00",
  "2026-02-29T00:00:00Z",
  "2024-02-29T00:00:00Z",
  "2026-11-20 19:00:00Z",
  null,
]) {
  record("Action", { type: "campaign.update", nextSessionAt });
}

for (const source of ["sample", "a-b-9", "-a", "A", "", "x".repeat(60), "x".repeat(61), 1, null]) {
  for (const page of [1, 0, 5000, 5001, 1.5, "1", null]) record("BookPage", { source, page });
  record("BookServing", { sources: [source] });
}
record("BookServing", { sources: [] });
record("BookServing", { sources: Array.from({ length: 101 }, () => "a") });
record("BookServing", {});
for (const error of ["no", "x".repeat(250), 1]) {
  for (const code of [undefined, "bookNoReply", "notAKey", 3]) {
    for (const params of [undefined, { a: "b", n: 2 }, { a: "x".repeat(201) }, "bad"]) {
      record("BookAck", {
        ok: false,
        error,
        ...(code === undefined ? {} : { code }),
        ...(params === undefined ? {} : { params }),
      });
    }
  }
}
record("BookAck", { ok: "maybe" });
record("BookAck", null);

mkdirSync(dirname(ACTION_OUT), { recursive: true });
writeFileSync(ACTION_OUT, JSON.stringify({ actions }));
console.log(`table vectors: ${views.length} seat views, ${actions.length} action inputs`);
