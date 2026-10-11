import { z } from "zod";

// Who someone is at one table (docs/design.md §3.6). A seat is per campaign, never per account: the same person can
// own room A, play in room B and co-GM room C.

// Roles a signed-in member holds. The room owner is `campaign.owner_user_id`, never a role, so there can't be two.
export const MemberRole = z.enum(["gm", "cogm", "player"]);
export type MemberRole = z.infer<typeof MemberRole>;

// Roles a token holds: a guest's character, or the table's TV. Neither is a membership (docs/design.md §3.6).
export const TokenRole = z.enum(["player", "screen"]);
export type TokenRole = z.infer<typeof TokenRole>;

// Every role a seat can resolve to.
export const SeatRole = z.enum(["gm", "cogm", "player", "screen"]);
export type SeatRole = z.infer<typeof SeatRole>;

// What the owner may hand a co-GM, as ticks in PARTY › CO-GM.
export const CogmScope = z.enum(["combat", "codex", "codex.secrets", "party", "session"]);
export type CogmScope = z.infer<typeof CogmScope>;

// Platform roles (decided 2026-10-11, keeps #178 of Auspex) are defined once, next to Clerk: `PlatformRole` in
// @inconsistable/auth.

export type Seat =
  | { kind: "member"; role: MemberRole; scopes: CogmScope[]; characterIds: string[] }
  | { kind: "token"; role: TokenRole; characterIds: string[] }
  // OPEN AS ADMIN: an admin at a table where they hold no seat. A seated admin gets their seat instead.
  | { kind: "admin" };

export type Ctx = {
  campaignId: string;
  userId: string | null; // null for token seats and the admin key
  campaignOwnerId: string | null; // null while an owner-less room waits for an admin (owner account deleted)
  seat: Seat;
};

// The role a seat acts as; an admin acts as a GM.
export const seatRole = (seat: Seat): SeatRole => (seat.kind === "admin" ? "gm" : seat.role);

// Rank for acting on other members: you only act on seats strictly below your own.
export const MEMBER_RANK: Record<MemberRole, number> = { gm: 3, cogm: 2, player: 1 };

// What /api/campaigns/:id/me answers: the caller's Ctx, parsed on the web server before it picks an app.
export const Me = z.object({
  campaignId: z.string(),
  userId: z.string().nullable(),
  campaignOwnerId: z.string().nullable(),
  seat: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("member"),
      role: MemberRole,
      scopes: z.array(CogmScope),
      characterIds: z.array(z.string()),
    }),
    z.object({ kind: z.literal("token"), role: TokenRole, characterIds: z.array(z.string()) }),
    z.object({ kind: z.literal("admin") }),
  ]),
}) satisfies z.ZodType<Ctx>;
export type Me = z.infer<typeof Me>;
