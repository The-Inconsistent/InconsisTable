import { eq, sql } from "drizzle-orm";
import {
  ACTION_PERMS,
  ADMIN_ACTIONS,
  ARCHIVED_OPEN,
  OWN_FALLBACK,
  canInCampaign,
  type Action,
  type ActionResult,
  type Ctx,
} from "@inconsistable/core-schema";
import { applyActorAction } from "../actor/actor.actions.ts";
import { adminEvent } from "../admin/admin.schema.ts";
import { applyAccessAction } from "../auth/access.actions.ts";
import { applyCampaignAction } from "../campaign/campaign.actions.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { applyCodexAction } from "../codex/codex.actions.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";

// Which snapshot an action changes, so the gateway only rebroadcasts what moved.
export function touches(a: Action): { state: boolean; codex: boolean } {
  // A deleted game has nothing left to broadcast; the gateway kicks the room instead (kicks).
  if (a.type === "campaign.delete") return { state: false, codex: false };
  if (a.type.startsWith("codex.")) return { state: false, codex: true };
  // A deleted character can empty a private handout's audience (actor.actions hides it).
  if (a.type === "actor.delete") return { state: true, codex: true };
  return { state: true, codex: false };
}

// Sockets to disconnect after this action, so they reconnect with their new (or no) seat: a removed or re-appointed
// member, the guests of a revoked or deleted character, every screen, or everyone at a deleted game.
export type Kick = { userId: string } | { actorId: string; tokensOnly: boolean } | { screens: true } | { all: true };
export function kicks(a: Action): Kick | null {
  if (a.type === "member.remove" || a.type === "member.appoint" || a.type === "member.seat")
    return { userId: a.userId };
  if (a.type === "token.revoke") return { actorId: a.actorId, tokensOnly: true }; // members keep their seat
  if (a.type === "actor.delete") return { actorId: a.id, tokensOnly: false };
  if (a.type === "screen.revoke") return { screens: true };
  if (a.type === "campaign.delete") return { all: true };
  return null;
}

// The `:own` target an action names, if any.
const targetOf = (a: Action) => (a.type === "actor.rename" ? { actorId: a.id } : undefined);

// authorize = state guard, then the permission the action declares, then the action's own rules (docs/design.md §5.3).
// The state guard (archived) needs the campaign row, so it runs in applyAction.
export function authorize(ctx: Ctx, a: Action) {
  const perm = ACTION_PERMS[a.type];
  if (perm === null) return; // the action checks its caller itself (campaign.transferAccept)
  const target = targetOf(a);
  const fallback = OWN_FALLBACK[perm];
  if (canInCampaign({ ctx, perm, target })) return;
  if (fallback && canInCampaign({ ctx, perm: fallback, target })) return;
  if (ctx.seat.kind === "token" && ctx.seat.role === "screen") fail("The table screen is read-only");
  fail(perm.endsWith(":own") ? "Not your character" : "You don't have permission to do that");
}

export async function applyAction(tx: Tx, { ctx, action }: { ctx: Ctx; action: Action }): Promise<ActionResult> {
  authorize(ctx, action);
  // Every action bumps the state version in its own transaction (docs/design.md §5.6), and an archived game is
  // read-only except for the way out of it. The name goes to the admin log, copied since campaign.delete removes it.
  const [c] = await tx
    .update(campaign)
    .set({ stateVersion: sql`${campaign.stateVersion} + 1` })
    .where(eq(campaign.id, ctx.campaignId))
    .returning({ name: campaign.name, archivedAt: campaign.archivedAt });
  if (!c) fail("Game not found");
  if (c.archivedAt && !ARCHIVED_OPEN.has(action.type)) fail("This game is archived");
  const result = await dispatch(tx, { ctx, action });
  // Only the housekeeping is logged: an admin running a table would otherwise bury it under every tap.
  if (ctx.seat.kind === "admin" && ctx.userId && result.ok && ADMIN_ACTIONS.has(action.type))
    await tx.insert(adminEvent).values({
      actorUserId: ctx.userId,
      action: action.type,
      campaignId: ctx.campaignId,
      campaignName: c.name,
      targetUserId: "userId" in action ? action.userId : "toUserId" in action ? action.toUserId : null,
    });
  return result;
}

function dispatch(tx: Tx, { ctx, action }: { ctx: Ctx; action: Action }): Promise<ActionResult> {
  switch (action.type) {
    case "campaign.update":
    case "campaign.archive":
    case "campaign.unarchive":
    case "campaign.delete":
    case "session.start":
    case "session.end":
    case "session.edit":
      return applyCampaignAction(tx, { ctx, action });

    case "actor.create":
    case "actor.rename":
    case "actor.delete":
      return applyActorAction(tx, { ctx, action });

    case "invite.create":
    case "invite.revoke":
    case "member.remove":
    case "member.appoint":
    case "member.seat":
    case "seat.leave":
    case "token.issue":
    case "token.revoke":
    case "screen.issue":
    case "screen.revoke":
    case "campaign.transfer":
    case "campaign.transferCancel":
    case "campaign.transferAccept":
      return applyAccessAction(tx, { ctx, action });

    case "codex.save":
    case "codex.reveal":
    case "codex.delete":
      return applyCodexAction(tx, { ctx, action });
  }
}
