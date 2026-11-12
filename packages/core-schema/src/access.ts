import { z } from "zod";
import { MemberRole, TableMode } from "./seat.ts";
import { ActorBrief, CampaignName, InviteMode } from "./state.ts";

// REST shapes for signed-in users outside a table: the lobby, creating a game, and invite links.

export const LobbyGame = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(), // the owner's display name
  players: z.number().int(),
  session: z.number().int().nullable(), // number of the session in progress
  role: MemberRole.nullable(), // the caller's seat there; null when they hold none
  isOwner: z.boolean(),
  nextSessionAt: z.string().nullable(), // members only
  tableMode: TableMode,
  plays: z.string().nullable(), // what it plays: the game block's title, else the ruleset's name; null before a ruleset
});
export type LobbyGame = z.infer<typeof LobbyGame>;

// A character a seat of the caller holds, in any of their rooms ("My characters", docs/design.md §3.2).
export const LobbyCharacter = ActorBrief.pick({ id: true, kind: true, name: true, status: true }).extend({
  campaignId: z.string(),
  campaignName: z.string(),
});
export type LobbyCharacter = z.infer<typeof LobbyCharacter>;

export const Lobby = z.object({
  canCreate: z.boolean(),
  name: z.string(), // the caller's display name
  mine: z.array(LobbyGame), // rooms the caller owns
  seated: z.array(LobbyGame), // rooms where the caller holds another seat
  archived: z.array(LobbyGame),
  characters: z.array(LobbyCharacter),
});
export type Lobby = z.infer<typeof Lobby>;

// NEW CAMPAIGN asks for a name and, optionally, one of the owner's imported ruleset versions; the World step arrives in
// P2 (docs/design.md §3.3).
export const CreateGame = z.object({
  name: CampaignName,
  rulesetVersionId: z.uuid().optional(),
  // How the table sits; one of the pinned ruleset's modes (default: with a GM).
  tableMode: TableMode.optional(),
});
export type CreateGame = z.infer<typeof CreateGame>;

// What /invite/<code> shows before accepting.
export const InvitePreview = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  mode: InviteMode,
  role: MemberRole,
  actor: ActorBrief.nullable(), // the invited character (mode "character")
  openActors: z.array(ActorBrief), // unclaimed characters to pick from (mode "room")
  allowGuests: z.boolean(),
  signedIn: z.boolean(),
  member: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

// Accept: claim an open character, or start a new one by name (room invites); asGuest joins without an account.
export const AcceptInvite = z.object({
  actorId: z.uuid().optional(),
  newCharacterName: z.string().trim().min(1).max(100).optional(),
  asGuest: z.boolean().default(false),
});
export type AcceptInvite = z.input<typeof AcceptInvite>;

// PATCH /api/me: the name a device's user goes by at every table.
export const DISPLAY_NAME_MAX = 40;
export const Rename = z.object({ name: z.string().trim().min(1).max(DISPLAY_NAME_MAX) });
export type Rename = z.infer<typeof Rename>;

// PATCH /api/account: a signed-in account's name at the identity provider. It is also the name tables see, so it keeps
// the same bound.
export const RenameAccount = z.object({ displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX) });
export type RenameAccount = z.infer<typeof RenameAccount>;
