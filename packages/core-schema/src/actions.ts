import { z } from "zod";
import type { Permission } from "./permissions.ts";
import type { RefusalBody } from "./refusals.ts";
import { CogmScope, MemberRole, TableMode } from "./seat.ts";
import {
  ActorKind,
  ActorName,
  AudienceMode,
  BuilderDraftBody,
  CampaignName,
  CodexKind,
  EntryStatus,
  CodexText,
  CodexTitle,
  ClockName,
  ClockSegments,
  ClockVisibility,
  CodexFieldValue,
  CodexVisibility,
  EntrySource,
  FieldValue,
  HandoutHeader,
  HandoutLayout,
  LedgerBuildText,
  RequestText,
  TableId,
  TableResult,
  LookupInputs,
  InviteMode,
  WHISPER_TO_MAX,
  WhisperReplyText,
  WhisperText,
  SafetyKind,
  SafetyLine,
  SafetyList,
} from "./state.ts";
import { CombatVisibility, ENCOUNTER_ACTIONS, Marker } from "./encounter.ts";
import { ScenePrep, SpawnOptionIds } from "./prep.ts";
import { TestApplyOfferAction, TestCallAction, TestCloseAction, TestReportAction } from "./test-call.ts";

/**
 * The means a strike is made with (house decision #99): `source` the index of the strike's `means` it comes from, `ref`
 * the sheet line's index (a `ledger` source) or the pack entry's key (a `list` source).
 */
export const StrikeMeansPick = z.object({ source: z.int().min(0).max(3), ref: z.string().min(1).max(120) });
export type StrikeMeansPick = z.infer<typeof StrikeMeansPick>;
/** The total the table typed for a strike: the engine's bounds (rules-engine STRIKE_TOTAL_MIN, STRIKE_TOTAL_MAX). */
export const StrikeTotal = z.int().min(-1000).max(1000);

/**
 * One step's answer in a generator's run (house decision #98): a roll's lines (its table's, then each line's `next`), a
 * pick's key, or a value set by hand; the server reads the one its step's kind takes.
 */
export const GenerateStepValue = z.object({
  rows: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
  key: z.string().min(1).max(80).optional(),
  value: z.union([z.number(), z.string().max(200)]).optional(),
});
export const GenerateValues = z
  .record(z.string().min(1).max(64), GenerateStepValue)
  .refine((o) => Object.keys(o).length <= 20, "At most 20 steps");
export const MAX_GENERATED_ENTRIES = 60;

/** The numbers a spend's asker picks, by input name (house decision #84). */
export const SpendInputs = z.record(z.string().min(1).max(64), z.number().int().min(-1000).max(1000));
/** A line of a saved build an item is fitted to, `<card>/<name>` (house decision #102). */
export const LineRef = z.string().min(3).max(130);

// Every mutation goes through one socket event: "action" (CLAUDE.md, "The server decides"). These are the core
// actions; ruleset actions (res.adjust, turn.op, rule.op, test.*) are declared by the engine's primitives instead.

const id = z.uuid();
const userId = z.string().min(1).max(100);

export const NextSessionPlace = z.string().trim().max(200);
export const SessionTitle = z.string().trim().max(100);
// The two ways a group Ascends (house decision #64): everyone has earned the XP, or at the GM's word.
export const AscendKind = z.enum(["experience", "milestone"]);
export type AscendKind = z.infer<typeof AscendKind>;
// The creatures one actor.spawn places (house decision #75).
export const MAX_SPAWN = 50;

export const Action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("campaign.update"),
    name: CampaignName.optional(),
    nextSessionAt: z.iso.datetime({ offset: true }).nullable().optional(),
    nextSessionPlace: NextSessionPlace.optional(),
  }),
  z.object({ type: z.literal("campaign.archive") }),
  z.object({ type: z.literal("campaign.unarchive") }),
  // Only an archived room, and only after typing its name (kept from Auspex, #178).
  z.object({ type: z.literal("campaign.delete"), name: z.string().max(100) }),
  // The owner offers the room; the recipient must accept (docs/design.md §3.6).
  z.object({ type: z.literal("campaign.transfer"), toUserId: userId }),
  z.object({ type: z.literal("campaign.transferCancel") }),
  z.object({ type: z.literal("campaign.transferAccept") }),
  // The room's ruleset and packs: versions the owner imported (docs/design.md §4.6). Never taken from the client's word
  // for who owns them; the handler looks them up as the caller's.
  z.object({ type: z.literal("campaign.setRuleset"), rulesetVersionId: id }),
  z.object({ type: z.literal("campaign.unpinRuleset") }),
  // How the room sits: owner only, between sessions, among the modes the ruleset allows (docs/adr/0009-table-modes.md).
  z.object({ type: z.literal("campaign.setTableMode"), mode: TableMode }),
  // A campaign field of the pinned ruleset (house decision #58); the api checks the value against its definition.
  z.object({
    type: z.literal("campaign.setField"),
    fieldId: z.string().min(1).max(64),
    value: z.union([z.number().int().min(-2147483648).max(2147483647), z.string().max(100), z.boolean()]),
  }),
  z.object({ type: z.literal("campaign.attachPack"), packVersionId: id }),
  z.object({ type: z.literal("campaign.detachPack"), packVersionId: id }),
  // The room's World (house decision #65): a version the caller imported, pinned in a room they run. Independent of the
  // ruleset (design D4), so it changes at any time, mid-session too.
  z.object({ type: z.literal("campaign.setWorld"), worldVersionId: id }),
  z.object({ type: z.literal("campaign.unsetWorld") }),

  z.object({ type: z.literal("session.start"), title: SessionTitle.default("") }),
  // `award`: XP to every player character the ledger builder builds, when the ruleset gives it (house decision #64).
  z.object({
    type: z.literal("session.end"),
    recap: z.string().max(10_000).default(""),
    award: z.int().min(0).max(1000).default(0),
  }),
  z.object({
    type: z.literal("session.edit"),
    sessionId: id,
    title: SessionTitle.optional(),
    recap: z.string().max(10_000).optional(),
    notes: z.string().max(10_000).optional(),
  }),
  // Ends the running session with no award step: one never played, or left open (house decision #85).
  z.object({ type: z.literal("session.abandon"), recap: z.string().max(10_000).default("") }),
  // Deletes the room's latest session once it has ended; what it awarded stays with the characters (house decision #85).
  z.object({ type: z.literal("session.delete"), sessionId: id }),

  // `entityType` is an entity of the pinned ruleset (docs/design.md §5.4); the api refuses an unknown one.
  z.object({
    type: z.literal("actor.create"),
    kind: ActorKind.default("pc"),
    name: ActorName,
    entityType: z.string().min(1).max(64).optional(),
  }),
  // The builder's answers by creation step id; the server runs the ruleset's `creation` again before it writes.
  z.object({ type: z.literal("actor.build"), actorId: id, answers: z.record(z.string().max(120), z.unknown()) }),
  // A character bought with the ledger builder (house decision #63): the server resolves the build, then writes the
  // sheet's numbers as the actor's fields and stores the build and the sheet.
  // `draft: true` stores the build unresolved, for the GM to open; nothing of the actor changes (house decision #63).
  // `keepSheet`: the GM side saves a ready build over a sheet made by hand, keeping what `build.keep` marks (#96).
  z.object({
    type: z.literal("build.save"),
    actorId: id,
    build: LedgerBuildText,
    draft: z.boolean().default(false),
    keepSheet: z.boolean().default(false),
  }),
  // The group Ascends one Tier together (house decision #64): `experience` once every character has earned the XP in
  // this Tier, `milestone` at the GM's word, awarding it. `waivePackage` waives this Ascension's package.
  z.object({
    type: z.literal("build.ascend"),
    kind: AscendKind,
    waivePackage: z.boolean().default(false),
  }),
  // N creatures from one attached pack entry, numbered after the ones already at the table. With `mob` (and a count
  // of 1), one actor standing for that many members, named "<entry> ×N" (house decision #66). `name` stands in for the
  // entry's own; `visibility` is how the table sees them when a fight is running (house decision #75).
  z.object({
    type: z.literal("actor.spawn"),
    packVersionId: id,
    key: z.string().min(1).max(80),
    count: z.int().min(1).max(MAX_SPAWN),
    temporary: z.boolean().default(false),
    mob: z.int().min(2).max(500).optional(),
    visibility: CombatVisibility.default("hidden"),
    name: z.string().trim().min(1).max(80).optional(),
    // House decision #92: the ruleset's spawn options it takes, each once, and its marker when it joins a fight.
    options: SpawnOptionIds.default([]),
    marker: Marker.optional(),
  }),
  // The signed-in user's builder draft in this room (one per user and room).
  z.object({ type: z.literal("draft.save"), body: BuilderDraftBody }),
  z.object({ type: z.literal("draft.discard") }),
  z.object({ type: z.literal("actor.rename"), id, name: ActorName }),
  z.object({ type: z.literal("actor.delete"), id }),

  // Ruleset actions (docs/design.md §5.3). `rule.op` runs one op of a primitive the engine registers: the op declares
  // its permission, targets and what it touches, so a new ruleset never adds a case to the dispatch. The others write
  // an actor's typed value rows. Every one lands in the session log and can be undone.
  z.object({
    type: z.literal("rule.op"),
    primitive: z.string().min(1).max(64),
    op: z.string().min(1).max(64),
    input: z.record(z.string().max(64), z.unknown()).default({}),
  }),
  z.object({ type: z.literal("field.set"), actorId: id, field: z.string().min(1).max(120), value: FieldValue }),
  z.object({
    type: z.literal("condition.add"),
    actorId: id,
    condition: z.string().min(1).max(64),
    source: z.string().max(100).default(""),
    expiresAfter: z.int().min(1).max(1000).optional(), // turns or rounds, for the expiries that count
  }),
  z.object({ type: z.literal("condition.remove"), actorId: id, condition: z.string().min(1).max(64) }),
  // The ruleset's `resetOn` for one rest or boundary event, on one actor or on all of them. `event` is the engine's
  // ResetEvent; core-schema can't import the engine, so the api parses it.
  z.object({ type: z.literal("actor.rest"), event: z.string().min(1).max(40), actorId: id.optional() }),
  // Undoes a logged action of the running session: the one named (undo by line, house decision #131), else the newest
  // one that is not undone yet.
  z.object({ type: z.literal("event.undo"), actionId: id.optional() }),
  // Takes back the undo of a logged action of the running session, so the action stands again (house decision #132).
  z.object({ type: z.literal("event.redo"), actionId: id }),
  // Undoes the running fight's last turn step: every action back to and including the newest one that changed who acts
  // or the round (house decision #82). The step is not redone whole; each action it took back is, by line.
  z.object({ type: z.literal("event.turnBack") }),

  // A Test the GM calls, the physical roll a player or the GM reports, and the close (docs/design.md §6.3). The api
  // resolves a report with the engine's `dice.sumVsTarget`, so a hidden target number never leaves it.
  ...ENCOUNTER_ACTIONS,
  TestCallAction,
  TestReportAction,
  TestCloseAction,
  TestApplyOfferAction,

  z.object({
    type: z.literal("invite.create"),
    mode: InviteMode,
    role: MemberRole.default("player"),
    actorId: id.optional(),
    allowGuests: z.boolean().default(true),
    hours: z.number().int().min(1).max(720).default(12),
  }),
  z.object({ type: z.literal("invite.revoke"), id }),
  z.object({ type: z.literal("member.remove"), userId }),
  // The owner appoints a GM or co-GM, or demotes one; a co-GM's scopes are ticks in PARTY › CO-GM.
  z.object({
    type: z.literal("member.appoint"),
    userId,
    role: MemberRole,
    scopes: z.array(CogmScope).max(CogmScope.options.length).default([]),
  }),
  // Admin only: seats a known user as a GM of this room.
  z.object({ type: z.literal("member.seat"), userId }),
  z.object({ type: z.literal("seat.leave") }),
  z.object({ type: z.literal("token.issue"), actorId: id }),
  z.object({ type: z.literal("token.revoke"), actorId: id }),
  z.object({ type: z.literal("screen.issue") }),
  z.object({ type: z.literal("screen.revoke") }),

  // Codex writes are patches: only the fields sent are written, so a co-GM without `codex.secrets` never blanks
  // the GM notes they were not shown (docs/design.md §3.6).
  z.object({
    type: z.literal("codex.save"),
    id: id.optional(),
    kind: CodexKind,
    title: CodexTitle.optional(),
    body: CodexText.optional(),
    gmNotes: CodexText.optional(),
    status: EntryStatus.optional(), // a quest's or a scene's, of that kind's set
    plannedTests: z.array(z.string().min(1).max(100)).max(10).optional(), // a scene only: ruleset Test ids
    imageId: id.nullable().optional(), // a picture uploaded to this room; null removes it (house decision #70)
    // The ruleset's declared fields of this kind (house decision #71): a value sets one, null clears it, absent leaves it.
    fields: z
      .record(z.string().min(1).max(64), CodexFieldValue)
      .refine((o) => Object.keys(o).length <= 20, "At most 20 fields")
      .optional(),
    layout: HandoutLayout.optional(), // a handout only
    header: HandoutHeader.optional(), // a handout only
    prep: ScenePrep.nullable().optional(), // a scene only: the whole document replaces the stored one, null clears it
    // The pack entry it was made from (house decision #97): served to this room as one of its kind's `from` types; null forgets it.
    source: EntrySource.nullable().optional(),
  }),
  // Makes an entry of `kind` from a served pack entry (house decision #97), with the entries inside it and, for a scene,
  // its prepared lines, as one logged action; `parentId` puts it under an entry of the room. Answers the new ids, root first.
  z.object({
    type: z.literal("codex.fromPack"),
    kind: CodexKind,
    entity: z.string().min(1).max(64),
    key: z.string().min(1).max(80),
    parentId: id.optional(),
  }),
  // A generator's run the GM confirmed (house decision #98): each step's answer by id, and one set per round of `each`;
  // the server checks it against the declaration and makes its entries as one logged action. Answers the ids, root first.
  z.object({
    type: z.literal("codex.generate"),
    generatorId: z.string().min(1).max(64),
    values: GenerateValues,
    each: z.array(GenerateValues).max(MAX_GENERATED_ENTRIES).default([]),
    parentId: id.optional(),
  }),
  // Who reads an entry, and whether the table sees its picture: either may be sent alone.
  z.object({
    type: z.literal("codex.reveal"),
    id,
    visibility: CodexVisibility.optional(),
    audienceMode: AudienceMode.default("all"),
    audience: z.array(id).max(50).default([]),
    imageRevealed: z.boolean().optional(),
  }),
  // `withScenes`: an adventure goes with its scenes; without it, one that has scenes is refused (house decision #86).
  z.object({ type: z.literal("codex.delete"), id, withScenes: z.boolean().optional() }),
  // SHOW TO TABLE (#2, house decision #139): one entry full-screen on the phones (everyone, or listed characters) and,
  // for everyone, on the TV. Showing reveals it for good; a new SHOW replaces the last; CLEAR takes it down, unrevealing
  // nothing.
  z.object({ type: z.literal("spotlight.show"), entryId: id, audience: z.array(id).max(50).default([]) }),
  z.object({ type: z.literal("spotlight.clear") }),
  // A scene begun: the one being played goes to done, this one is active, its prepared reveals are sent (house decision
  // #86). The answer's id is the begin's, which scene.undoBegin takes back while it is the room's latest.
  z.object({ type: z.literal("scene.begin"), sceneId: id }),
  z.object({ type: z.literal("scene.undoBegin"), beginId: id }),
  // Reorders or reparents; `position` only says where to insert: the server renumbers the siblings 0..n-1.
  z.object({
    type: z.literal("codex.move"),
    id,
    parentId: id.nullable(),
    position: z.number().int().min(0).max(10_000),
  }),
  z.object({ type: z.literal("codex.link"), id, targetId: id }),
  z.object({ type: z.literal("codex.unlink"), id, targetId: id }),

  // Clocks (docs/p2-plan.md group C). A tick is a delta the server clamps into 0..segments, and it logs for undo.
  z.object({
    type: z.literal("clock.create"),
    name: ClockName,
    segments: ClockSegments.default(4),
    visibility: ClockVisibility.default("gm"),
    entryId: id.optional(),
  }),
  z.object({ type: z.literal("clock.tick"), id, delta: z.number().int().min(-12).max(12) }),
  z.object({
    type: z.literal("clock.update"),
    id,
    name: ClockName.optional(),
    segments: ClockSegments.optional(),
    visibility: ClockVisibility.optional(),
    entryId: id.nullable().optional(),
  }),
  z.object({ type: z.literal("clock.delete"), id }),

  // Spend requests (house decision #43): a player asks, the GM side answers. Approval spends through the resource delta
  // path, so it is clamped and logged for undo. A request names a resource and an amount, or a spend of the ruleset
  // and its inputs (house decision #84); the api refuses one with both or neither.
  z.object({
    type: z.literal("request.send"),
    actorId: id.optional(),
    resourceId: z.string().min(1).max(64).optional(),
    amount: z.number().int().min(1).max(99).optional(),
    spendId: z.string().min(1).max(64).optional(),
    inputs: SpendInputs.optional(),
    note: RequestText.optional(),
    // Acquiring a served pack entry by a Test (house decision #102), fitted at once to an item or a build line.
    acquire: z
      .object({
        type: z.string().min(1).max(64),
        entry: z.string().min(1).max(80),
        to: id.optional(),
        line: LineRef.optional(),
      })
      .optional(),
  }),
  // A spend done at once by the side that runs the table (house decision #84): its costs and ops as one action.
  z.object({
    type: z.literal("spend.do"),
    spendId: z.string().min(1).max(64),
    actorId: id,
    inputs: SpendInputs.optional(),
  }),
  z.object({ type: z.literal("request.cancel"), id }),
  z.object({ type: z.literal("request.approve"), id }),
  z.object({ type: z.literal("request.deny"), id, reason: RequestText.optional() }),
  // Session Zero (docs/p2-plan.md group E): the table's lines and veils, and the anonymous X-Card.
  z.object({ type: z.literal("campaign.setSafety"), lines: SafetyList, veils: SafetyList, xCard: z.boolean() }),
  z.object({ type: z.literal("safety.suggest"), kind: SafetyKind, text: SafetyLine }),
  z.object({ type: z.literal("safety.xcard") }),

  // Random tables (house decision #49): the server rolls, or deals without replacement; a deal is never undone. A typed
  // `result` is the GM's own roll (I ROLLED), and a lookup reads it with its inputs and target (house decision #87).
  z.object({
    type: z.literal("table.roll"),
    tableId: TableId,
    result: TableResult.optional(),
    actorId: id.optional(),
    inputs: LookupInputs.optional(),
  }),
  z.object({
    type: z.literal("table.apply"),
    tableId: TableId,
    result: TableResult,
    actorId: id,
    inputs: LookupInputs.default({}),
  }),
  // A strike (house decision #99): the attacker, the means it picked (by where it comes from and its line or key), the
  // target, the inputs and the total the table typed. The server works out what the total does and applies its hit.
  z.object({
    type: z.literal("strike.apply"),
    strikeId: TableId,
    attackerId: id,
    means: StrikeMeansPick.optional(),
    targetId: id,
    inputs: LookupInputs.default({}),
    total: StrikeTotal,
  }),
  // A record an actor holds, taken away by the GM side (house decision #88): logged, and Undo gives it back.
  z.object({
    type: z.literal("held.remove"),
    actorId: id,
    held: z.string().min(1).max(64),
    entry: z.string().min(1).max(80),
  }),
  // Items an actor holds (house decision #95). GIVE: the GM hands a codex item to a character, no Test; TAKE BACK undoes
  // it, its fitted items coming loose.
  z.object({ type: z.literal("item.give"), entryId: id, actorId: id }),
  z.object({ type: z.literal("item.take"), entryId: id }),
  // ADD BY HAND: a pack entry (`entry`, its key) or a hand-written name, of a kind the ruleset declares; a counted kind
  // takes a quantity and adds to the row it already has.
  z.object({
    type: z.literal("item.add"),
    actorId: id,
    kind: z.string().min(1).max(64),
    entry: z.string().min(1).max(80).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    note: z.string().max(200).default(""),
    quantity: z.int().min(1).max(999).default(1),
  }),
  // EDIT CARRIED: rewrite a line's note (and a hand-written one's name), or remove it; refused when `rev` is not the
  // line's revision now (the screen read an older one).
  z.object({
    type: z.literal("item.edit"),
    itemId: id,
    rev: z.int().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    note: z.string().max(200).optional(),
    remove: z.boolean().default(false),
  }),
  // Fit an item to another the same actor holds, or take it off (`to: null`).
  z.object({ type: z.literal("item.fit"), itemId: id, to: id.nullable(), line: LineRef.optional() }),
  // A counted item's quantity by a delta: the holder spends (a negative one), the GM sets either way; at 0 it is gone.
  z.object({
    type: z.literal("item.adjust"),
    itemId: id,
    by: z
      .int()
      .min(-999)
      .max(999)
      .refine((n) => n !== 0, "a change of 0 changes nothing"),
  }),
  z.object({
    type: z.literal("table.deal"),
    tableId: TableId,
    actorIds: z
      .array(id)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "a character is listed twice"),
  }),
  z.object({ type: z.literal("table.reshuffle"), tableId: TableId }),

  // Whispers (house decision #93): the GM's line to chosen characters; a reader's one reply, which a new one replaces;
  // a reader's read mark; the GM takes one back. Only in a room with a GM.
  z.object({
    type: z.literal("whisper.send"),
    to: z
      .array(id)
      .min(1)
      .max(WHISPER_TO_MAX)
      .refine((ids) => new Set(ids).size === ids.length, "a character is listed twice"),
    text: WhisperText,
  }),
  z.object({ type: z.literal("whisper.reply"), whisperId: id, actorId: id, text: WhisperReplyText }),
  z.object({ type: z.literal("whisper.read"), whisperId: id, actorId: id }),
  z.object({ type: z.literal("whisper.delete"), id }),
]);
export type Action = z.infer<typeof Action>;
export type ActionInput = z.input<typeof Action>; // what clients send: defaulted fields optional
export type ActionType = Action["type"];

// The permission each action needs (CLAUDE.md, "Adding a core action"). A missing entry is a type error. `null` means
// the action checks its caller itself (the transfer's recipient holds no permission yet; `rule.op` takes its op's).
export const ACTION_PERMS: Record<ActionType, Permission | null> = {
  "campaign.update": "campaign:update",
  "campaign.archive": "campaign:archive",
  "campaign.unarchive": "campaign:archive",
  "campaign.delete": "campaign:delete",
  "campaign.transfer": "campaign:transfer",
  "campaign.transferCancel": "campaign:transfer",
  "campaign.transferAccept": null,
  "campaign.setRuleset": "campaign:ruleset",
  "campaign.unpinRuleset": "campaign:ruleset",
  "campaign.setTableMode": "campaign:table_mode",
  "campaign.setField": "campaign:update",
  "campaign.attachPack": "campaign:ruleset",
  "campaign.detachPack": "campaign:ruleset",
  "campaign.setWorld": "campaign:ruleset",
  "campaign.unsetWorld": "campaign:ruleset",
  "session.start": "session:run",
  "session.end": "session:run",
  "session.edit": "session:run",
  "session.abandon": "session:run",
  "session.delete": "session:run",
  "actor.create": "character:create",
  "actor.build": "character:edit:own", // a player on a held character; the GM side through OWN_FALLBACK
  "build.save": "character:edit:own", // the same; the GM's part of the build is the GM side's (house decision #63)
  "build.ascend": "campaign:update", // as campaign.setField, which changes the same Tier (house decision #64)
  "actor.spawn": "encounter:run",
  "draft.save": null, // a signed-in member's own draft; the handler checks the caller
  "draft.discard": null,
  "actor.rename": "character:edit:own",
  "actor.delete": "character:edit:any",
  "rule.op": null, // the op declares it (a primitive's `perm`); the ruleset pipeline checks it
  "field.set": "character:edit:own", // then the field's `editableBy`
  "condition.add": "encounter:run",
  "condition.remove": "encounter:run",
  "actor.rest": "session:run",
  "event.undo": "encounter:run", // the GM, and a co-GM with the combat scope
  "event.redo": "encounter:run", // as Undo (house decision #132)
  "event.turnBack": "encounter:run",
  "encounter.start": "encounter:run",
  "encounter.end": "encounter:run",
  "encounter.add": "encounter:run",
  "encounter.remove": "encounter:run",
  "encounter.setInitiative": "encounter:run",
  "encounter.move": "encounter:run",
  "encounter.setVisibility": "encounter:run",
  "encounter.keep": "encounter:run",
  "encounter.mark": "encounter:run",
  "turn.next": "encounter:run",
  "turn.prev": "encounter:run",
  "turn.first": "encounter:run",
  "phase.done": "phase:done:own", // the player of that character; the GM side through OWN_FALLBACK
  "game.end": "encounter:run",
  "result.set": "encounter:run",
  "test.call": "test:call",
  "test.report": "test:report:own", // the player of that character; the GM side through OWN_FALLBACK
  "test.close": "test:call",
  "test.applyOffer": "test:call",
  "invite.create": "member:invite",
  "invite.revoke": "member:invite",
  "member.remove": "member:remove",
  "member.appoint": "member:appoint",
  "member.seat": "member:seat",
  "seat.leave": "seat:leave",
  "token.issue": "token:issue",
  "token.revoke": "token:issue",
  "screen.issue": "token:issue",
  "screen.revoke": "token:issue",
  "codex.save": "codex:write",
  "codex.fromPack": "codex:write", // and the pack entry read as the seat reads it (house decision #97)
  "codex.generate": "codex:write", // and each pick read as the seat reads it (house decision #98)
  "codex.reveal": "codex:reveal",
  "codex.delete": "codex:write",
  "spotlight.show": "codex:reveal",
  "spotlight.clear": "codex:reveal",
  "scene.begin": "codex:write", // as making a scene active with codex.save; each reveal then asks codex:reveal
  "scene.undoBegin": "codex:write",
  "codex.move": "codex:write",
  "codex.link": "codex:write",
  "codex.unlink": "codex:write",
  "clock.create": "clock:run",
  "clock.tick": "clock:run",
  "clock.update": "clock:run",
  "clock.delete": "clock:run",
  "request.send": "request:send",
  "spend.do": "request:resolve", // and each op it runs asks its own permission
  "request.cancel": "request:send",
  "request.approve": "request:resolve",
  "request.deny": "request:resolve",
  "campaign.setSafety": "session:run", // the GM side; without a GM every player seat holds it (TABLE_RUN_GRANTS)
  "safety.suggest": "safety:signal",
  "safety.xcard": "safety:signal",
  "table.roll": "session:run",
  "table.apply": "encounter:run", // a lookup changes its target as the fight's own writes do (house decision #87)
  // The handler asks encounter:run, or for a strike the owner may send, character:edit:own of the attacker on its own
  // turn at a target shown in full (house decisions #99, #113).
  "strike.apply": null,
  "held.remove": "character:edit:any",
  "item.give": "character:edit:any",
  "item.take": "character:edit:any",
  "item.add": "character:edit:any",
  "item.edit": "character:edit:any",
  // The holder's seat or the GM side: the handler asks character:edit:own of the item's holder (house decision #95).
  "item.fit": null,
  "item.adjust": null,
  "table.deal": "session:run",
  "table.reshuffle": "session:run",
  "whisper.send": "session:run", // the side that runs the session; without a GM the handler refuses (whispersNeedGm)
  "whisper.delete": "session:run",
  "whisper.reply": "whisper:receive:own", // the seat holding that reader, never the GM side
  "whisper.read": "whisper:receive:own",
};

// `:own` permissions that a GM-side permission also satisfies: a GM renames any character.
export const OWN_FALLBACK: Partial<Record<Permission, Permission>> = {
  "character:edit:own": "character:edit:any",
  "test:report:own": "test:call",
  "phase:done:own": "encounter:run",
};

// Actions an archived room still takes: unarchive, delete, leaving, and revoking access (kept from Auspex).
export const ARCHIVED_OPEN: ReadonlySet<ActionType> = new Set([
  "campaign.unarchive",
  "campaign.delete",
  "seat.leave",
  "token.revoke",
  "invite.revoke",
  "screen.revoke",
  "member.remove",
]);

// Housekeeping an admin may send from /admin without a seat, logged in admin_event (kept from Auspex).
export const AdminAction = z.enum([
  "member.seat",
  "member.remove",
  "campaign.archive",
  "campaign.unarchive",
  "campaign.delete",
  "campaign.transfer",
  // The running session ended with no award, the last ended one deleted (house decision #94).
  "session.abandon",
  "session.delete",
] as const satisfies readonly ActionType[]);
export type AdminAction = z.infer<typeof AdminAction>;
export const ADMIN_ACTIONS: ReadonlySet<ActionType> = new Set(AdminAction.options);

// What an admin_event row records: that housekeeping, an admin opening a room without a seat.
export const AdminEventAction = z.enum([
  ...AdminAction.options,
  "room.open",
  "pack.disable", // notice-and-takedown: the pack stops being served at once (docs/design.md §4.6)
  "pack.enable",
  "world.disable", // the same for a World (house decision #65)
  "world.enable",
  "campaign.create", // the admin-key script made a room (actor "admin-key")
  "key.action", // the admin-key script sent a socket action; detail names it
  "user.list", // the console read the users list (house decision #94)
  "user.unseat", // the console removed a user from one room; target_user_id names them, detail what was refused
]);
export type AdminEventAction = z.infer<typeof AdminEventAction>;

// A refusal carries its code, English message and params (refusals.ts). `error` repeats the message for older web builds
// and is what the screen shows: the web puts the translation there when it has one for the code.
export type Refused = { ok: false; error: string } & Partial<RefusalBody>;

/**
 * What an accepted action's answer may tell the seat that sent it (house decision #79), and no one else: the platform's
 * own lines by code, which the screen words, and a ruleset's line (`rule`) with its words, the actor's name filled in,
 * in `text`. They are neither state nor log.
 */
export const NoticeCode = z.enum([
  "poolFull",
  "restSkipped",
  "rule",
  "sessionDeleted",
  "sceneBegun",
  "revealSkipped",
  "conditionSkipped",
  "shockSkipped",
  "advanced",
]);
export type NoticeCode = z.infer<typeof NoticeCode>;
/** The params each code carries, which its words may name. */
export const NOTICE_PARAMS = {
  poolFull: ["pool", "lost"], // the pool's label and how much of the change it could not take
  restSkipped: ["names", "count"], // who a rest of everyone left out, in name order joined with ", ", and how many
  rule: ["rule", "name"], // the rule's id and the actor's name
  sessionDeleted: ["number"], // the deleted session's number; what it awarded stays (house decision #85)
  sceneBegun: ["title", "revealed"], // the scene begun and how many of its reveal lines went out (house decision #86)
  revealSkipped: ["line", "reason"], // a scene's reveal line the begin skipped: its label or id, and the refusal code
  conditionSkipped: ["name", "condition"], // a lookup left out a condition its target is immune to (house decision #87)
  shockSkipped: ["name", "shock"], // a lookup left out the shock of a hit its target never takes (house decision #163)
  // the advance field raised by hand counts as that many advances, from and to (house decision #96)
  advanced: ["field", "from", "to", "steps"],
} as const satisfies Record<NoticeCode, readonly string[]>;
export const Notice = z.object({
  code: NoticeCode,
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  text: z.string().max(200).optional(),
});
export type Notice = z.infer<typeof Notice>;

/** What `table.roll` drew or read and `table.apply` applied (house decision #87): the line, the dice, and the total. */
export type RollAnswer = { entryId: string; value: number; total: number };
// `ids`: every entry codex.fromPack or codex.generate made, root first (house decisions #97, #98).
export type ActionResult =
  { ok: true; id?: string; ids?: string[]; token?: string; notices?: Notice[]; roll?: RollAnswer } | Refused;
