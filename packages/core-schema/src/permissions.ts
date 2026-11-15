import { z } from "zod";
import { type CogmScope, type Ctx, type MemberRole, type SeatRole } from "./seat.ts";
import type { ActorKind } from "./state.ts";

// Permissions are data (docs/design.md §3.6). Every action declares the one it needs (ACTION_PERMS in actions.ts), and
// `authorize` asks `canInCampaign` before the action's own validator runs.
export const Permission = z.enum([
  "campaign:update",
  "campaign:archive",
  "campaign:delete",
  "campaign:transfer",
  "campaign:ruleset",
  "campaign:table_mode",
  "member:invite",
  "member:remove",
  "member:appoint",
  "member:seat",
  "seat:leave",
  "session:run",
  "encounter:run",
  "clock:run",
  "test:call",
  "test:report:own",
  "phase:done:own",
  "codex:read",
  "codex:write",
  "codex:read_secret",
  "codex:reveal",
  "character:create",
  "character:edit:any",
  "character:edit:own",
  "token:issue",
  "request:send",
  "request:resolve",
  "safety:signal",
]);
export type Permission = z.infer<typeof Permission>;

// Only the room owner (campaign.owner_user_id) or an admin who opened the room as admin.
export const OWNER_ONLY: ReadonlySet<Permission> = new Set([
  "campaign:delete",
  "campaign:transfer",
  "campaign:ruleset",
  "campaign:table_mode",
  "member:appoint",
]);

// Only an admin: giving a user a seat they weren't invited to.
export const ADMIN_ONLY: ReadonlySet<Permission> = new Set(["member:seat"]);

const GM_GRANTS: Permission[] = [
  "campaign:update",
  "campaign:archive",
  "member:invite",
  "member:remove",
  "seat:leave",
  "session:run",
  "encounter:run",
  "clock:run",
  "test:call",
  "codex:read",
  "codex:write",
  "codex:read_secret",
  "codex:reveal",
  "character:create",
  "character:edit:any",
  "token:issue",
  "request:resolve",
];

// What each seat may do anywhere in its room. `:own` permissions are in OWN_GRANTS: they need a target the seat holds.
export const SEAT_GRANTS: Record<SeatRole, ReadonlySet<Permission>> = {
  gm: new Set(GM_GRANTS),
  // A co-GM holds the GM's permissions that a scope covers (COGM_SCOPES_FOR), never campaign settings.
  cogm: new Set(GM_GRANTS.filter((p) => p !== "campaign:update" && p !== "campaign:archive")),
  player: new Set<Permission>(["codex:read", "request:send", "safety:signal", "seat:leave"]),
  screen: new Set<Permission>(["codex:read"]),
};

export const OWN_GRANTS: Record<SeatRole, ReadonlySet<Permission>> = {
  gm: new Set(),
  cogm: new Set(),
  player: new Set<Permission>(["character:edit:own", "test:report:own", "phase:done:own"]),
  screen: new Set(),
};

// The scopes that unlock a GM permission for a co-GM. Reading the revealed codex and leaving need none.
export const COGM_SCOPES_FOR: Partial<Record<Permission, readonly CogmScope[]>> = {
  "member:invite": ["party"],
  "member:remove": ["party"],
  "character:create": ["party"],
  "character:edit:any": ["party"],
  "token:issue": ["party"],
  "session:run": ["session"],
  "test:call": ["session"],
  "request:resolve": ["session"],
  "encounter:run": ["combat"],
  "clock:run": ["combat"],
  "codex:write": ["codex"],
  "codex:reveal": ["codex"],
  "codex:read_secret": ["codex.secrets"],
};

// Without a GM (docs/adr/0009-table-modes.md) every player seat runs the table together: sessions, fights, clocks, the
// codex's writing and revealing, and Tests called for characters. Never `codex:read_secret`: nothing is kept from anyone,
// so there is nothing to read. The seat's own steps it undoes itself (event.undo checks the step's author).
export const TABLE_RUN_GRANTS: ReadonlySet<Permission> = new Set<Permission>([
  "session:run",
  "encounter:run",
  "clock:run",
  "test:call",
  "codex:write",
  "codex:reveal",
]);

// What the owner keeps without a GM seat to hold it: the room's settings, who sits at it, a character for themselves.
export const OWNER_TABLE_GRANTS: ReadonlySet<Permission> = new Set<Permission>([
  "campaign:update",
  "campaign:archive",
  "member:invite",
  "member:remove",
  "token:issue",
  "character:create",
]);

// The role a seat acts as in this room. Without a GM there are no GM or co-GM seats: one left over from before the table
// changed mode (a socket opened earlier) acts as a player until it reconnects.
export function roleOf(ctx: Ctx): SeatRole {
  if (ctx.seat.kind === "admin") return "gm";
  if (ctx.tableMode !== "gm" && (ctx.seat.role === "gm" || ctx.seat.role === "cogm")) return "player";
  return ctx.seat.role;
}

export type Target = { actorId?: string };

// The seat's permission in its own room. Pure, so the web hides buttons with it; only the api's answer counts.
export function canInCampaign({ ctx, perm, target }: { ctx: Ctx; perm: Permission; target?: Target }): boolean {
  if (ctx.seat.kind === "admin") return true; // OPEN AS ADMIN; logged as admin_event
  if (ADMIN_ONLY.has(perm)) return false;
  const isOwner = ctx.userId !== null && ctx.userId === ctx.campaignOwnerId;
  if (OWNER_ONLY.has(perm)) return isOwner;
  const role = roleOf(ctx);
  if (ctx.tableMode !== "gm" && role === "player" && !perm.endsWith(":own")) {
    if (TABLE_RUN_GRANTS.has(perm) || (isOwner && OWNER_TABLE_GRANTS.has(perm))) return true;
  }
  if (perm.endsWith(":own")) {
    // "Mine" means a character this seat holds, never a match on userId: a guest has none, and someone who left the
    // room still owns the retired character but has no seat (docs/design.md §3.6).
    const actorId = target?.actorId;
    return actorId !== undefined && OWN_GRANTS[role].has(perm) && ctx.seat.characterIds.includes(actorId);
  }
  if (!SEAT_GRANTS[role].has(perm)) return false;
  if (ctx.seat.kind !== "member" || role !== "cogm") return true;
  const scopes = COGM_SCOPES_FOR[perm];
  if (!scopes) return true;
  const held = ctx.seat.scopes;
  return scopes.some((s) => held.includes(s));
}

// Whether the seat may act on another member's seat (remove them, change their role or scopes). A GM or co-GM acts on
// players only; only the owner acts on a GM or co-GM, and nobody on the owner, who hands the room on instead
// (docs/design.md §3.6).
export function canActOnMember({ ctx, target }: { ctx: Ctx; target: { userId: string; role: MemberRole } }): boolean {
  if (target.userId === ctx.campaignOwnerId) return false;
  if (ctx.seat.kind === "admin") return true;
  if (ctx.userId === ctx.campaignOwnerId && ctx.userId !== null) return true; // the owner acts on every other seat
  if (ctx.seat.kind !== "member") return false;
  return roleOf(ctx) !== "player" && target.role === "player";
}

// Whether the seat may hand out `role` (an invite, an appointment). Players only, unless you own the room.
export function canGrantRole({ ctx, role }: { ctx: Ctx; role: MemberRole }): boolean {
  if (ctx.seat.kind === "admin") return true;
  if (ctx.tableMode !== "gm" && role !== "player") return false; // no GM seats without a GM
  if (ctx.userId !== null && ctx.userId === ctx.campaignOwnerId) return true;
  return role === "player" && canInCampaign({ ctx, perm: "member:invite" });
}

// Actors every seat sees by name: the party. NPCs, creatures and the rest stay on the GM side until a seat holds one.
export const PARTY_KINDS: ReadonlySet<ActorKind> = new Set(["pc", "companion"]);

// The permission that puts a seat on the GM side of one actor: the `party` scope for the party's characters, `combat`
// for every other kind (house decision #31). The web asks it to show a sheet whole; the api asks it before a write.
export const gmPermOf = (kind: ActorKind): Permission =>
  PARTY_KINDS.has(kind) ? "character:edit:any" : "encounter:run";
