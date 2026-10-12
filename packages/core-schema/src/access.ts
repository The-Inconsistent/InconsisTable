import { z } from "zod";
import { MemberRole } from "./seat.ts";
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
});
export type LobbyGame = z.infer<typeof LobbyGame>;

export const Lobby = z.object({
  canCreate: z.boolean(),
  admin: z.boolean(),
  mine: z.array(LobbyGame), // rooms the caller owns
  seated: z.array(LobbyGame), // rooms where the caller holds another seat
  archived: z.array(LobbyGame),
});
export type Lobby = z.infer<typeof Lobby>;

// NEW CAMPAIGN in P0 asks only for a name; the ruleset and World steps arrive in P2 (docs/design.md §3.3).
export const CreateGame = z.object({ name: CampaignName });
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
