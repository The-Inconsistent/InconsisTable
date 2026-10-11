import { and, eq, gt, isNull } from "drizzle-orm";
import { canActOnMember, canGrantRole, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import { ownActor } from "../actor/actor.actions.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { accessToken, appUser, invite, membership, ownershipTransfer } from "./auth.schema.ts";
import { hash, issueScreenToken, issueToken, newSecret } from "./auth.service.ts";

export type AccessAction = Extract<
  Action,
  {
    type:
      | "invite.create"
      | "invite.revoke"
      | "member.remove"
      | "member.appoint"
      | "member.seat"
      | "seat.leave"
      | "token.issue"
      | "token.revoke"
      | "screen.issue"
      | "screen.revoke"
      | "campaign.transfer"
      | "campaign.transferCancel"
      | "campaign.transferAccept";
  }
>;

// An offer to take over a room lasts a week, like a character invite.
const TRANSFER_HOURS = 168;

const memberOf = async (tx: Tx, { campaignId, userId }: { campaignId: string; userId: string }) =>
  (
    await tx
      .select({ id: membership.id, role: membership.role })
      .from(membership)
      .where(and(eq(membership.campaignId, campaignId), eq(membership.userId, userId)))
  )[0];

// The permission each action needs was checked before this runs (authorize); what's here are the rules about the
// seat being acted on (docs/design.md §3.6).
export async function applyAccessAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: AccessAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "invite.create": {
      if (!canGrantRole({ ctx, role: a.role })) fail("You can only invite players");
      // A character invite is one seat, used once. A room invite is the table QR: anyone with it claims or starts a
      // character until it expires.
      if (a.mode === "character")
        await ownActor(tx, { campaignId: cid, id: a.actorId ?? fail("Pick a character to invite") });
      else if (a.actorId) fail("A room invite isn't for one character");
      if (a.role !== "player" && a.allowGuests) fail("A GM seat needs an account");
      const code = newSecret();
      const [row] = await tx
        .insert(invite)
        .values({
          codeHash: hash(code),
          campaignId: cid,
          mode: a.mode,
          role: a.role,
          actorId: a.actorId ?? null,
          allowGuests: a.allowGuests,
          expiresAt: new Date(Date.now() + a.hours * 3600_000),
          maxUses: a.mode === "character" ? 1 : null,
        })
        .returning({ id: invite.id });
      return { ok: true, id: row!.id, token: code }; // the row was just inserted; the code is only ever shown now
    }

    case "invite.revoke": {
      const r = await tx
        .update(invite)
        .set({ revokedAt: new Date() })
        .where(and(eq(invite.id, a.id), eq(invite.campaignId, cid), isNull(invite.revokedAt)))
        .returning({ id: invite.id });
      return r.length ? { ok: true } : fail("Invite not found");
    }

    case "member.remove": {
      if (a.userId === ctx.userId) fail("Leave the room instead of removing yourself");
      const m = (await memberOf(tx, { campaignId: cid, userId: a.userId })) ?? fail("Member not found");
      if (!canActOnMember({ ctx, target: { userId: a.userId, role: m.role } }))
        fail(
          a.userId === ctx.campaignOwnerId
            ? "The owner can't be removed; they can hand the room on"
            : "You can only remove seats below your own",
        );
      await tx.delete(membership).where(eq(membership.id, m.id));
      return { ok: true };
    }

    case "member.appoint": {
      // Owner only (OWNER_ONLY): appoint a GM or co-GM, demote one, or set a co-GM's scopes.
      if (a.userId === ctx.campaignOwnerId) fail("The owner is always a GM");
      const m = (await memberOf(tx, { campaignId: cid, userId: a.userId })) ?? fail("Member not found");
      await tx
        .update(membership)
        .set({ role: a.role, scopes: a.role === "cogm" ? a.scopes : [] })
        .where(eq(membership.id, m.id));
      return { ok: true };
    }

    case "member.seat": {
      // Admin only. Only a user the app has seen: the id is a Clerk user id, and a typo mustn't seat nobody.
      const [u] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, a.userId));
      if (!u) fail("User not found");
      await tx
        .insert(membership)
        .values({ campaignId: cid, userId: a.userId, role: "gm" })
        .onConflictDoUpdate({ target: [membership.campaignId, membership.userId], set: { role: "gm", scopes: [] } });
      return { ok: true };
    }

    case "seat.leave": {
      // No kick: the phone navigates away on the ack, and a kick would drop the socket before the ack reaches it.
      if (ctx.seat.kind === "admin") fail("You hold no seat here");
      if (ctx.userId && ctx.userId === ctx.campaignOwnerId) fail("Hand the room on before you leave it");
      if (ctx.seat.kind === "member" && ctx.userId)
        await tx.delete(membership).where(and(eq(membership.campaignId, cid), eq(membership.userId, ctx.userId)));
      // ponytail: a guest can't be told apart from another phone on the same character's QR, so all its tokens go.
      else
        for (const actorId of ctx.seat.characterIds)
          await tx
            .update(accessToken)
            .set({ revokedAt: new Date() })
            .where(
              and(eq(accessToken.campaignId, cid), eq(accessToken.actorId, actorId), isNull(accessToken.revokedAt)),
            );
      return { ok: true };
    }

    case "token.issue": {
      await ownActor(tx, { campaignId: cid, id: a.actorId });
      return { ok: true, token: await issueToken(tx, { campaignId: cid, actorId: a.actorId }) };
    }

    case "token.revoke":
      await ownActor(tx, { campaignId: cid, id: a.actorId });
      await tx
        .update(accessToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(accessToken.actorId, a.actorId), isNull(accessToken.revokedAt)));
      return { ok: true };

    case "screen.issue":
      return { ok: true, token: await issueScreenToken(tx, { campaignId: cid }) };

    case "screen.revoke":
      await tx
        .update(accessToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(accessToken.campaignId, cid), eq(accessToken.role, "screen"), isNull(accessToken.revokedAt)));
      return { ok: true };

    case "campaign.transfer": {
      // To a signed-in member of this room only: they must already know the table.
      if (a.toUserId === ctx.campaignOwnerId) fail("They already own this room");
      if (!(await memberOf(tx, { campaignId: cid, userId: a.toUserId }))) fail("Only a member can take over the room");
      const expiresAt = new Date(Date.now() + TRANSFER_HOURS * 3600_000);
      await tx
        .insert(ownershipTransfer)
        .values({ campaignId: cid, toUserId: a.toUserId, expiresAt })
        .onConflictDoUpdate({ target: ownershipTransfer.campaignId, set: { toUserId: a.toUserId, expiresAt } });
      return { ok: true };
    }

    case "campaign.transferCancel": {
      await tx.delete(ownershipTransfer).where(eq(ownershipTransfer.campaignId, cid));
      return { ok: true };
    }

    case "campaign.transferAccept": {
      // No permission gates this (ACTION_PERMS null): the offer itself names who may accept.
      if (!ctx.userId) fail("Sign in to take over a room");
      const [offer] = await tx
        .delete(ownershipTransfer)
        .where(
          and(
            eq(ownershipTransfer.campaignId, cid),
            eq(ownershipTransfer.toUserId, ctx.userId),
            gt(ownershipTransfer.expiresAt, new Date()),
          ),
        )
        .returning({ toUserId: ownershipTransfer.toUserId });
      if (!offer) fail("There is no offer for you to accept");
      // The new owner always sits as a GM; the old owner keeps their GM seat until the new owner decides.
      await tx
        .insert(membership)
        .values({ campaignId: cid, userId: ctx.userId, role: "gm" })
        .onConflictDoUpdate({ target: [membership.campaignId, membership.userId], set: { role: "gm", scopes: [] } });
      await tx.update(campaign).set({ ownerUserId: ctx.userId }).where(eq(campaign.id, cid));
      return { ok: true };
    }
  }
}
