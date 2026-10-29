import { z } from "zod";
import type { Permission } from "./permissions.ts";
import type { RefusalBody } from "./refusals.ts";
import { CogmScope, MemberRole } from "./seat.ts";
import {
  ActorKind,
  ActorName,
  AudienceMode,
  BuilderDraftBody,
  CampaignName,
  CodexKind,
  CodexText,
  CodexTitle,
  CodexVisibility,
  FieldValue,
  InviteMode,
} from "./state.ts";
import { ENCOUNTER_ACTIONS } from "./encounter.ts";
import { TestCallAction, TestCloseAction, TestReportAction } from "./test-call.ts";

// Every mutation goes through one socket event: "action" (CLAUDE.md, "The server decides"). These are the core
// actions; ruleset actions (res.adjust, turn.op, rule.op, test.*) are declared by the engine's primitives instead.

const id = z.uuid();
const userId = z.string().min(1).max(100);

export const NextSessionPlace = z.string().trim().max(200);
export const SessionTitle = z.string().trim().max(100);

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
  z.object({ type: z.literal("campaign.attachPack"), packVersionId: id }),
  z.object({ type: z.literal("campaign.detachPack"), packVersionId: id }),

  z.object({ type: z.literal("session.start"), title: SessionTitle.default("") }),
  z.object({ type: z.literal("session.end"), recap: z.string().max(10_000).default("") }),
  z.object({
    type: z.literal("session.edit"),
    sessionId: id,
    title: SessionTitle.optional(),
    recap: z.string().max(10_000).optional(),
    notes: z.string().max(10_000).optional(),
  }),

  // `entityType` is an entity of the pinned ruleset (docs/design.md §5.4); the api refuses an unknown one.
  z.object({
    type: z.literal("actor.create"),
    kind: ActorKind.default("pc"),
    name: ActorName,
    entityType: z.string().min(1).max(64).optional(),
  }),
  // The builder's answers by creation step id; the server runs the ruleset's `creation` again before it writes.
  z.object({ type: z.literal("actor.build"), actorId: id, answers: z.record(z.string().max(120), z.unknown()) }),
  // N creatures from one attached pack entry, numbered after the ones already at the table.
  z.object({
    type: z.literal("actor.spawn"),
    packVersionId: id,
    key: z.string().min(1).max(80),
    count: z.int().min(1).max(20),
    temporary: z.boolean().default(false),
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
  // Undoes the newest logged action of the running session that is not undone yet. There is no redo.
  z.object({ type: z.literal("event.undo") }),

  // A Test the GM calls, the physical roll a player or the GM reports, and the close (docs/design.md §6.3). The api
  // resolves a report with the engine's `dice.sumVsTarget`, so a hidden target number never leaves it.
  ...ENCOUNTER_ACTIONS,
  TestCallAction,
  TestReportAction,
  TestCloseAction,

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
  }),
  z.object({
    type: z.literal("codex.reveal"),
    id,
    visibility: CodexVisibility,
    audienceMode: AudienceMode.default("all"),
    audience: z.array(id).max(50).default([]),
  }),
  z.object({ type: z.literal("codex.delete"), id }),
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
  "campaign.attachPack": "campaign:ruleset",
  "campaign.detachPack": "campaign:ruleset",
  "session.start": "session:run",
  "session.end": "session:run",
  "session.edit": "session:run",
  "actor.create": "character:create",
  "actor.build": "character:edit:own", // a player on a held character; the GM side through OWN_FALLBACK
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
  "encounter.start": "encounter:run",
  "encounter.end": "encounter:run",
  "encounter.add": "encounter:run",
  "encounter.remove": "encounter:run",
  "encounter.setInitiative": "encounter:run",
  "encounter.move": "encounter:run",
  "encounter.setVisibility": "encounter:run",
  "encounter.keep": "encounter:run",
  "turn.next": "encounter:run",
  "turn.prev": "encounter:run",
  "turn.first": "encounter:run",
  "test.call": "test:call",
  "test.report": "test:report:own", // the player of that character; the GM side through OWN_FALLBACK
  "test.close": "test:call",
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
  "codex.reveal": "codex:reveal",
  "codex.delete": "codex:write",
};

// `:own` permissions that a GM-side permission also satisfies: a GM renames any character.
export const OWN_FALLBACK: Partial<Record<Permission, Permission>> = {
  "character:edit:own": "character:edit:any",
  "test:report:own": "test:call",
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
] as const satisfies readonly ActionType[]);
export type AdminAction = z.infer<typeof AdminAction>;
export const ADMIN_ACTIONS: ReadonlySet<ActionType> = new Set(AdminAction.options);

// What an admin_event row records: that housekeeping, an admin opening a room without a seat.
export const AdminEventAction = z.enum([
  ...AdminAction.options,
  "room.open",
  "pack.disable", // notice-and-takedown: the pack stops being served at once (docs/design.md §4.6)
  "pack.enable",
  "campaign.create", // the admin-key script made a room (actor "admin-key")
  "key.action", // the admin-key script sent a socket action; detail names it
]);
export type AdminEventAction = z.infer<typeof AdminEventAction>;

// A refusal carries its code, English message and params (refusals.ts). `error` repeats the message for older web builds
// and is what the screen shows: the web puts the translation there when it has one for the code.
export type Refused = { ok: false; error: string } & Partial<RefusalBody>;
export type ActionResult = { ok: true; id?: string; token?: string } | Refused;
