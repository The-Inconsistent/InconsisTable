import { z } from "zod";
import { Encounter, Game } from "./encounter.ts";
import { CogmScope, MemberRole, TableMode } from "./seat.ts";
import { TestCall, TestDef } from "./test-call.ts";

// The two snapshots every seat receives (docs/design.md §5.5): `state` (the live table) and `codex` (the world).
// Each seat gets its own filtered copy (the api Seat view module); a GM seat gets them whole.

export const CampaignName = z.string().trim().min(1).max(100);

// Every kind of thing with stats at a table (docs/design.md §5.4). `kind` decides who controls it and how long it
// lives; the ruleset's `entity_type` decides its fields.
export const ActorKind = z.enum(["pc", "companion", "npc", "creature", "group", "vehicle", "hazard"]);
export type ActorKind = z.infer<typeof ActorKind>;

export const ActorStatus = z.enum(["active", "retired", "dead", "dismissed"]);
export type ActorStatus = z.infer<typeof ActorStatus>;

export const ActorName = z.string().trim().min(1).max(100);

// How two actors relate: a familiar is `companionOf` its PC, a sailor `crewOf` the ship.
export const ActorLinkKind = z.enum(["companionOf", "crewOf", "summonedBy", "memberOf"]);
export type ActorLinkKind = z.infer<typeof ActorLinkKind>;

export const InviteMode = z.enum(["room", "character"]); // room: claim or start a character; character: one character
export type InviteMode = z.infer<typeof InviteMode>;

// A stored field value (docs/design.md §5.4): what the actor_field rows hold, or null for an unset field.
// The bounds repeat MAX_TEXT_CHARS, MAX_LIST_ITEMS and MAX_LIST_ITEM_CHARS in rules-engine/field-value.ts.
export const FieldValue = z.union([
  z.number().int().min(-2147483648).max(2147483647),
  z.string().max(10_000),
  z.boolean(),
  z.array(z.string().max(1_000)).max(500),
  z.null(),
]);
export type FieldValue = z.infer<typeof FieldValue>;

// An actor without its ruleset values: what an invite preview shows anyone holding the code.
export const ActorBrief = z.object({
  id: z.string(),
  kind: ActorKind,
  name: ActorName,
  status: ActorStatus,
  ownerUserId: z.string().nullable(), // who may export it to their library; editing goes by seat (permissions.ts)
});
export type ActorBrief = z.infer<typeof ActorBrief>;

// How long an active condition lasts: what is left of its count, for the expiries that count (null: no count).
export const ConditionTimer = z.object({
  id: z.string(), // the condition id
  expiresOn: z.string(),
  expiresAfter: z.number().int().nullable(),
});
export type ConditionTimer = z.infer<typeof ConditionTimer>;

// A character bought with the ledger builder (house decision #63): its build, the builder's input document, as JSON text.
// Text, so the api reads the keys in the order they were written (the builder reads them in order, and a socket payload
// reaches the api as a map). The server parses and resolves it before it writes anything.
export const MAX_BUILD_BYTES = 64 * 1024;
export const LedgerBuildText = z
  .string()
  .refine((s) => new TextEncoder().encode(s).length <= MAX_BUILD_BYTES, "The build is over 64 KB");

// The stored build and the sheet it resolved to, and an unfinished draft the GM can open, as saved (keys in the order
// the builder wrote them). A draft may come before any build; a ready save clears it. The ledger, the pending choices and
// the problems are not stored: the builder resolves them again from the build. In play (house decision #64): `xpSpent`
// is what the saved build's advancement spends, `xpAtAscension` the XP the character had when the group last Ascended
// (or the Tier was raised), `packageWaived` whether that Ascension waived its package. A row may hold only these.
const LedgerDocument = z.record(z.string(), z.unknown()).nullable();
export const ActorLedger = z.object({
  build: LedgerDocument,
  sheet: LedgerDocument,
  draft: LedgerDocument,
  xpSpent: z.int(),
  xpAtAscension: z.int(),
  packageWaived: z.boolean(),
});
export type ActorLedger = z.infer<typeof ActorLedger>;

export const Actor = ActorBrief.extend({
  // The ruleset's values. The api filters them per seat with the rules engine's `toViewerView` (a GM seat gets them
  // whole); empty until a ruleset is pinned and the actor has an entity type.
  entity: z.string(), // the ruleset's entity type id
  fields: z.record(z.string(), FieldValue),
  resources: z.record(z.string(), z.number()),
  derived: z.record(z.string(), z.number()),
  conditions: z.array(z.string()), // active condition ids
  // Their durations, for the conditions this viewer sees (the same visibility as the condition itself).
  conditionTimers: z.array(ConditionTimer),
  // The saved ledger build, sheet and draft, for the GM side and a seat holding this character; null for everyone else,
  // and for an actor not built with the ledger builder.
  ledger: ActorLedger.nullable(),
});
export type Actor = z.infer<typeof Actor>;

export const Member = z.object({
  userId: z.string(),
  name: z.string(),
  role: MemberRole,
  scopes: z.array(CogmScope),
  characterIds: z.array(z.string()),
});
export type Member = z.infer<typeof Member>;

export const Invite = z.object({
  id: z.string(),
  mode: InviteMode,
  role: MemberRole, // the most an invite grants; capped by the inviter (canGrantRole)
  actorId: z.string().nullable(),
  allowGuests: z.boolean(),
  expiresAt: z.string(),
  uses: z.number().int(),
  maxUses: z.number().int().nullable(),
});
export type Invite = z.infer<typeof Invite>;

export const Session = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  recap: z.string(),
  notes: z.string(), // the session side only (the api's Seat view module)
});
export type Session = z.infer<typeof Session>;

// A builder draft is one JSON document read and written whole (docs/p1-plan.md decision 4): the character being built
// and the answers so far, by creation step id. Capped at 64 KB serialized.
export const MAX_DRAFT_BYTES = 64 * 1024;
export const BuilderDraftBody = z
  .object({ actorId: z.uuid(), answers: z.record(z.string().max(120), z.unknown()) })
  .refine((b) => new TextEncoder().encode(JSON.stringify(b)).length <= MAX_DRAFT_BYTES, "The draft is over 64 KB");
export type BuilderDraftBody = z.infer<typeof BuilderDraftBody>;

// A progress clock the GM runs (docs/p2-plan.md group C): `filled` of `segments`, clamped by the server. A `gm` clock is
// the clock side's only; `entryId` is the codex entry it is about, null for a seat that cannot read that entry.
export const ClockName = z.string().trim().min(1).max(80);
export const ClockVisibility = z.enum(["gm", "party"]);
export type ClockVisibility = z.infer<typeof ClockVisibility>;
export const MAX_CLOCKS = 30;
export const ClockSegments = z.number().int().min(2).max(12);
export const Clock = z.object({
  id: z.string(),
  name: ClockName,
  segments: ClockSegments,
  filled: z.number().int().min(0).max(12),
  visibility: ClockVisibility,
  entryId: z.string().nullable(),
  position: z.number().int(),
});
export type Clock = z.infer<typeof Clock>;

// A player's ask to spend from a resource (house decision #43). `note` is "" when none; `actorId` is null for a shared pool.
export const RequestText = z.string().trim().max(140);

// The table's Session Zero: lines (never at this table), veils (happen off the page), the X-Card's switch. A small
// document read and written whole (`campaign.safety`); suggestions carry no author.
export const MAX_SAFETY_ITEMS = 30;
export const SAFETY_LINE_MAX = 80;
export const SafetyLine = z.string().trim().min(1).max(SAFETY_LINE_MAX);
export const SafetyList = z.array(SafetyLine).max(MAX_SAFETY_ITEMS);
export const SafetyKind = z.enum(["line", "veil"]);
export type SafetyKind = z.infer<typeof SafetyKind>;
export const Safety = z.object({ lines: SafetyList, veils: SafetyList, xCard: z.boolean() });
export type Safety = z.infer<typeof Safety>;
export const SpendRequest = z.object({
  id: z.string(),
  userId: z.string(),
  actorId: z.string().nullable(),
  resourceId: z.string(),
  amount: z.number().int().min(1).max(99),
  note: z.string(),
  createdAt: z.string(),
});
export type SpendRequest = z.infer<typeof SpendRequest>;
// The GM side's answer to a request, sent to the player who asked so the phone can say so.
export const RequestAnswer = z.object({
  id: z.string(),
  userId: z.string(),
  actorId: z.string().nullable(),
  resourceId: z.string(),
  amount: z.number().int(),
  status: z.enum(["approved", "denied"]),
  reason: z.string(),
});
export type RequestAnswer = z.infer<typeof RequestAnswer>;

// A roll on a random table and a card dealt from one (house decision #49). Both carry the table's `visibility` so the
// Seat view can cut them without the ruleset: gm → the GM side, party → every seat, owner → the card's holder (a roll
// is never `owner`). `label` is the entry's own short name.
export const TableId = z.string().min(1).max(64);
export const RollRow = z.object({
  id: z.string(),
  tableId: z.string(),
  entryId: z.string(),
  label: z.string(),
  value: z.number().int(),
  visibility: z.enum(["gm", "party", "owner"]),
  at: z.string(),
});
export type RollRow = z.infer<typeof RollRow>;
// A shared pool as one seat sees it (house decision #59). Self-describing, so no screen needs the manifest: `max` is the
// declared maximum (null when none) and `capped` says whether the value stops there.
export const PoolState = z.object({
  id: z.string(),
  label: z.string(),
  scope: z.enum(["party", "gm", "campaign"]),
  value: z.number(),
  min: z.number(),
  max: z.number().nullable(),
  capped: z.boolean(),
  visibility: z.enum(["public", "party", "owner", "gm"]),
  editableBy: z.string(),
});
export type PoolState = z.infer<typeof PoolState>;

export const DealtRow = z.object({
  tableId: z.string(),
  actorId: z.string(),
  entryId: z.string(),
  label: z.string(),
  visibility: z.enum(["gm", "party", "owner"]),
});
export type DealtRow = z.infer<typeof DealtRow>;

export const LiveState = z.object({
  campaign: z.object({
    id: z.string(),
    name: CampaignName,
    ownerUserId: z.string().nullable(),
    archived: z.boolean(),
    nextSessionAt: z.string().nullable(),
    nextSessionPlace: z.string(),
    // How the table sits; the seat view reads it from here, never from the client.
    tableMode: TableMode,
    // Session Zero: every seat, the screen included, reads it (docs/p2-plan.md group E).
    safety: Safety,
    // Each campaign field of the pinned ruleset at its value in play (house decision #58); {} without a ruleset or fields.
    fields: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    // The pinned World version (house decision #65), or null. Every seat gets it, so a client reads the room's rules
    // again when it changes; the World itself is served by GET /api/campaigns/:id/rules.
    worldVersionId: z.string().nullable(),
  }),
  // Increments inside every action's transaction; a client drops a snapshot older than the one it holds, since two
  // api nodes may deliver broadcasts out of order (docs/design.md §5.6).
  stateVersion: z.number().int(),
  session: Session.nullable(),
  actors: z.array(Actor),
  // The receiving user's own builder draft, under the ruleset this room has pinned; null for every other seat.
  myDraft: BuilderDraftBody.nullable(),
  // Tests called and still open, or closed in this session; each seat gets its own filter (the api's Seat view module).
  tests: z.array(TestCall),
  // The pinned ruleset's Tests, so the GM can call one. GM seats only.
  testDefs: z.array(TestDef),
  // The room's clocks by position; a seat off the clock side gets the `party` ones (the api's Seat view module).
  clocks: z.array(Clock),
  // Pending spend requests, oldest first: the GM side sees all, a player their own, a screen none. `requestAnswers` are
  // the asker's own recent answers (approved or denied), newest first.
  requests: z.array(SpendRequest),
  requestAnswers: z.array(RequestAnswer),
  // The last 10 rolls on random tables, newest first, and the cards dealt and not yet returned; each seat gets the ones
  // its sight reads (the api's Seat view module).
  rolls: z.array(RollRow),
  dealt: z.array(DealtRow),
  // The combat tracker: the active encounter, if any. Each seat gets its own filter (encounter.ts).
  encounter: Encounter.nullable(),
  // The campaign's 20 most recent ended games, newest first; every seat gets all of them (house decision #40).
  games: z.array(Game),
  access: z.object({
    members: z.array(Member),
    invites: z.array(Invite), // GM seats only
    guests: z.array(z.object({ actorId: z.string() })), // characters with a live guest token
    screens: z.number().int(), // live screen tokens
    // A transfer waiting for its recipient to accept.
    transfer: z.object({ toUserId: z.string(), expiresAt: z.string() }).nullable(),
  }),
  // The shared pools in manifest order; each seat gets the ones it may see (the api's Seat view module).
  pools: z.array(PoolState),
});
export type LiveState = z.infer<typeof LiveState>;

// Codex entries (docs/design.md §1.3). P0 carries the shared shell; each kind's own fields arrive with its screens.
export const CodexKind = z.enum([
  "adventure",
  "scene",
  "npc",
  "location",
  "faction",
  "item",
  "handout",
  "quest",
  "lore",
]);
export type CodexKind = z.infer<typeof CodexKind>;

// Who sees an entry: GM only, every seat (revealed), or also a public stream. `listed` audiences reach only the
// characters in `audience`; when the last one is deleted the entry falls back to `gm`, never to everyone.
export const CodexVisibility = z.enum(["gm", "party", "public"]);
export type CodexVisibility = z.infer<typeof CodexVisibility>;
export const AudienceMode = z.enum(["all", "listed"]);
export type AudienceMode = z.infer<typeof AudienceMode>;

export const CodexTitle = z.string().trim().min(1).max(200);
export const CodexText = z.string().max(20_000);

export const QuestStatus = z.enum(["open", "done", "failed"]);
export type QuestStatus = z.infer<typeof QuestStatus>;

export const MAX_PLANNED_TESTS = 10;

export const CodexEntry = z.object({
  id: z.string(),
  kind: CodexKind,
  title: CodexTitle,
  body: CodexText, // what the table sees once revealed
  gmNotes: CodexText, // GM seats only
  visibility: CodexVisibility,
  audienceMode: AudienceMode,
  audience: z.array(z.string()), // actor ids, when audienceMode is "listed"
  status: QuestStatus.nullable(), // a quest's; null on every other kind. Seen by whoever sees the entry
  parentId: z.string().nullable(), // a scene's adventure; null for a seat that can't see the adventure
  position: z.number().int(), // order among siblings (an adventure's scenes, the adventures)
  links: z.array(z.string()), // entries a scene points at, only those the seat can also see
  plannedTests: z.array(z.string()), // a scene's planned ruleset Test ids; GM side only
  // The entry's picture; another seat than the codex side gets it only once it is shown to the table (house decision #70).
  imageId: z.string().nullable(),
  imageRevealed: z.boolean(),
});
export type CodexEntry = z.infer<typeof CodexEntry>;

// An ended session's recap, for "Last time..." and the notebook. Newest first, at most 50, empty recaps left out; the
// session's `notes` never come here.
export const MAX_RECAPS = 50;
export const SessionRecap = z.object({
  sessionId: z.string(),
  number: z.number().int(),
  title: z.string(),
  endedAt: z.string(),
  recap: z.string(),
});
export type SessionRecap = z.infer<typeof SessionRecap>;

export const Codex = z.object({ entries: z.array(CodexEntry), recaps: z.array(SessionRecap) });
export type Codex = z.infer<typeof Codex>;
