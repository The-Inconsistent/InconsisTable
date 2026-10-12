import { eq, sql } from "drizzle-orm";
import {
  ACTION_PERMS,
  ARCHIVED_OPEN,
  AdminAction,
  type Action,
  type ActionResult,
  type Ctx,
} from "@inconsistable/core-schema";
import { applyActorAction } from "../actor/actor.actions.ts";
import { adminEvent } from "../admin/admin.schema.ts";
import { applyAccessAction } from "../auth/access.actions.ts";
import { applyCampaignAction } from "../campaign/campaign.actions.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { applyEventAction } from "../campaign/event.actions.ts";
import { applyRulesAction } from "../campaign/rules.actions.ts";
import { applyCodexAction } from "../codex/codex.actions.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { applyRuleAction, primitiveOp } from "../ruleset/ruleset.actions.ts";
import { requirePerm } from "./table.authorize.ts";

// Which snapshot an action changes, so the gateway only rebroadcasts what moved.
export function touches(a: Action): { state: boolean; codex: boolean } {
  // A deleted game has nothing left to broadcast; the gateway kicks the room instead (kicks).
  if (a.type === "campaign.delete") return { state: false, codex: false };
  if (a.type.startsWith("codex.")) return { state: false, codex: true };
  // A deleted character can empty a private handout's audience (actor.actions hides it).
  if (a.type === "actor.delete") return { state: true, codex: true };
  // A ruleset op says itself what it changes (docs/design.md §5.3); the rest of the ruleset actions change actors.
  if (a.type === "rule.op") {
    const t = primitiveOp(a.primitive, a.op)?.touches ?? "state";
    return { state: t !== "codex", codex: t !== "state" };
  }
  return { state: true, codex: false };
}

// Sockets to disconnect after this action, so they reconnect with their new (or no) seat: a removed or re-appointed
// member, the guests of a revoked or deleted character, every screen, everyone at a deleted game, or every socket of a
// seat that left (a member's other tabs, the other phones on a guest's characters).
export type Kick = { userId: string } | { actorId: string; tokensOnly: boolean } | { screens: true } | { all: true };
export function kicks({ ctx, action: a }: { ctx: Ctx; action: Action }): Kick[] {
  if (a.type === "member.remove" || a.type === "member.appoint" || a.type === "member.seat")
    return [{ userId: a.userId }];
  if (a.type === "token.revoke") return [{ actorId: a.actorId, tokensOnly: true }]; // members keep their seat
  if (a.type === "actor.delete") return [{ actorId: a.id, tokensOnly: false }];
  if (a.type === "screen.revoke") return [{ screens: true }];
  // A new owner: every seat resolves again, so the old owner loses the owner's powers and the new one gains them.
  if (a.type === "campaign.delete" || a.type === "campaign.transferAccept") return [{ all: true }];
  // ponytail: ops declare no kicks yet (PrimitiveOp has none); a rule.op, field.set and the rest kick nobody
  if (a.type === "seat.leave") {
    if (ctx.seat.kind === "member" && ctx.userId) return [{ userId: ctx.userId }];
    if (ctx.seat.kind === "token") return ctx.seat.characterIds.map((actorId) => ({ actorId, tokensOnly: true }));
  }
  return [];
}

// Kicks that reach the sender wait a moment, so the ack gets there first.
export const kicksSender = (a: Action) =>
  a.type === "campaign.delete" || a.type === "campaign.transferAccept" || a.type === "seat.leave";

// The `:own` target an action names, if any.
const targetOf = (a: Action) =>
  a.type === "actor.rename" ? { actorId: a.id } : a.type === "field.set" ? { actorId: a.actorId } : undefined;

// The permission the action declares. The pipeline (docs/design.md §5.3) is the state guard (archived, in
// applyAction, which reads the campaign row first), then this, then the action's own rules in its handler.
export function authorize(ctx: Ctx, a: Action) {
  const perm = ACTION_PERMS[a.type];
  if (perm === null) return; // the action checks its caller itself (campaign.transferAccept)
  requirePerm({ ctx, perm, target: targetOf(a) });
}

export async function applyAction(
  tx: Tx,
  { ctx: seated, action }: { ctx: Ctx; action: Action },
): Promise<ActionResult> {
  // Every action bumps the state version in its own transaction (docs/design.md §5.6), and an archived game is
  // read-only except for the way out of it. The name goes to the admin log, copied since campaign.delete removes it.
  const [c] = await tx
    .update(campaign)
    .set({ stateVersion: sql`${campaign.stateVersion} + 1` })
    .where(eq(campaign.id, seated.campaignId))
    .returning({ name: campaign.name, archivedAt: campaign.archivedAt, ownerUserId: campaign.ownerUserId });
  if (!c) fail("Game not found");
  // The owner comes from this row, not the handshake: a socket opened before a transfer must not keep its powers.
  const ctx: Ctx = { ...seated, campaignOwnerId: c.ownerUserId };
  // A refusal throws and rolls back the version bump.
  if (c.archivedAt && !ARCHIVED_OPEN.has(action.type)) fail("This game is archived");
  authorize(ctx, action);
  const result = await dispatch(tx, { ctx, action });
  // Only the housekeeping is logged: an admin running a table would otherwise bury it under every tap.
  const logged = AdminAction.safeParse(action.type);
  if (ctx.seat.kind === "admin" && ctx.userId && result.ok && logged.success)
    await tx.insert(adminEvent).values({
      actorUserId: ctx.userId,
      action: logged.data,
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

    case "campaign.setRuleset":
    case "campaign.attachPack":
    case "campaign.detachPack":
      return applyRulesAction(tx, { ctx, action });

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

    case "rule.op":
    case "field.set":
    case "condition.add":
    case "condition.remove":
    case "actor.rest":
      return applyRuleAction(tx, { ctx, action });

    case "event.undo":
      return applyEventAction(tx, { ctx, action });

    case "codex.save":
    case "codex.reveal":
    case "codex.delete":
      return applyCodexAction(tx, { ctx, action });
  }
}
