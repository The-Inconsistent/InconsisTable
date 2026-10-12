import { z } from "zod";
import { CogmScope, MemberRole } from "./seat.ts";

// The two snapshots every seat receives (docs/design.md §5.5): `state` (the live table) and `codex` (the world).
// Each seat gets its own filtered copy (view.ts); the GM room gets them whole.

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
export const FieldValue = z.union([z.number(), z.string(), z.boolean(), z.array(z.string()), z.null()]);
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

export const Actor = ActorBrief.extend({
  // The ruleset's values. The api filters them per seat with the rules engine's `toViewerView` (a GM seat gets them
  // whole); empty until a ruleset is pinned and the actor has an entity type.
  entity: z.string(), // the ruleset's entity type id
  fields: z.record(z.string(), FieldValue),
  resources: z.record(z.string(), z.number()),
  derived: z.record(z.string(), z.number()),
  conditions: z.array(z.string()), // active condition ids
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
  notes: z.string(), // GM only (view.ts)
});
export type Session = z.infer<typeof Session>;

export const LiveState = z.object({
  campaign: z.object({
    id: z.string(),
    name: CampaignName,
    ownerUserId: z.string().nullable(),
    archived: z.boolean(),
    nextSessionAt: z.string().nullable(),
    nextSessionPlace: z.string(),
  }),
  // Increments inside every action's transaction; a client drops a snapshot older than the one it holds, since two
  // api nodes may deliver broadcasts out of order (docs/design.md §5.6).
  stateVersion: z.number().int(),
  session: Session.nullable(),
  actors: z.array(Actor),
  access: z.object({
    members: z.array(Member),
    invites: z.array(Invite), // GM seats only
    guests: z.array(z.object({ actorId: z.string() })), // characters with a live guest token
    screens: z.number().int(), // live screen tokens
    // A transfer waiting for its recipient to accept.
    transfer: z.object({ toUserId: z.string(), expiresAt: z.string() }).nullable(),
  }),
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

export const CodexEntry = z.object({
  id: z.string(),
  kind: CodexKind,
  title: CodexTitle,
  body: CodexText, // what the table sees once revealed
  gmNotes: CodexText, // GM seats only
  visibility: CodexVisibility,
  audienceMode: AudienceMode,
  audience: z.array(z.string()), // actor ids, when audienceMode is "listed"
});
export type CodexEntry = z.infer<typeof CodexEntry>;

export const Codex = z.object({ entries: z.array(CodexEntry) });
export type Codex = z.infer<typeof Codex>;
