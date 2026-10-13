import { and, eq } from "drizzle-orm";
import type { Action, ActionResult, BuilderDraftBody, Ctx, LiveState } from "@inconsistable/core-schema";
import { campaign } from "../campaign/campaign.schema.ts";
import type { Db, Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { requirePerm } from "../table/table.authorize.ts";
import { actor, builderDraft } from "./actor.schema.ts";

export type DraftAction = Extract<Action, { type: "draft.save" | "draft.discard" }>;

// A draft belongs to a signed-in member: a guest has no account to keep it under.
const owner = (ctx: Ctx) =>
  ctx.userId !== null && ctx.seat.kind === "member" ? ctx.userId : fail("Sign in to keep a draft");

export async function applyDraftAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: DraftAction },
): Promise<ActionResult> {
  const userId = owner(ctx);
  const cid = ctx.campaignId;
  if (a.type === "draft.discard") {
    await tx.delete(builderDraft).where(and(eq(builderDraft.userId, userId), eq(builderDraft.campaignId, cid)));
    return { ok: true };
  }
  // Only a character the caller may build, and only under the ruleset the room has pinned.
  requirePerm({ ctx, perm: "character:edit:own", target: { actorId: a.body.actorId } });
  const [found] = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.id, a.body.actorId), eq(actor.campaignId, cid)));
  if (!found) fail("Character not found");
  const [room] = await tx.select({ version: campaign.rulesetVersionId }).from(campaign).where(eq(campaign.id, cid));
  if (!room?.version) fail("This game has no ruleset yet");
  await tx
    .insert(builderDraft)
    .values({ userId, campaignId: cid, rulesetVersionId: room.version, body: a.body })
    .onConflictDoUpdate({
      target: [builderDraft.userId, builderDraft.campaignId],
      set: { rulesetVersionId: room.version, body: a.body, updatedAt: new Date() },
    });
  return { ok: true };
}

/** A snapshot with the receiving user's own draft in `myDraft`; every other user's stays out of it. */
export const forUser = ({
  state,
  drafts,
  ctx,
}: {
  state: LiveState;
  drafts: ReadonlyMap<string, BuilderDraftBody>;
  ctx: Ctx;
}): LiveState => ({ ...state, myDraft: (ctx.userId !== null && drafts.get(ctx.userId)) || null });

/** The room's drafts by user, only those written under the ruleset the room has pinned now. */
export async function loadDrafts(conn: Db, campaignId: string): Promise<Map<string, BuilderDraftBody>> {
  const rows = await conn
    .select({ userId: builderDraft.userId, body: builderDraft.body })
    .from(builderDraft)
    .innerJoin(campaign, eq(campaign.id, builderDraft.campaignId))
    .where(and(eq(builderDraft.campaignId, campaignId), eq(builderDraft.rulesetVersionId, campaign.rulesetVersionId)));
  return new Map(rows.map((r) => [r.userId, r.body]));
}
