import { desc, eq, sql } from "drizzle-orm";
import type { Action, ActionResult, AdminEventAction, Ctx } from "@inconsistable/core-schema";
import { appUser } from "../auth/auth.schema.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { db } from "../core/db.ts";
import { pack } from "../pack/pack.schema.ts";
import { ruleset, rulesetVersion } from "../ruleset/ruleset.schema.ts";
import { adminEvent } from "./admin.schema.ts";

// The part of the table socket this service drives (TableGateway has it), so the service imports no Nest code.
type Table = {
  run(args: { ctx: Ctx; action: Action }): Promise<ActionResult>;
};

// ponytail: whole lists, fine for a private deployment; paginate once rooms or users pass a few hundred
export const listCampaigns = () =>
  db
    .select({
      id: campaign.id,
      name: campaign.name,
      ownerUserId: campaign.ownerUserId,
      ownerName: appUser.name,
      ruleset: ruleset.title,
      rulesetVersion: rulesetVersion.version,
      lastPlayedAt: sql<
        string | null
      >`(select max(coalesce(s.ended_at, s.started_at)) from session s where s.campaign_id = ${campaign.id})`,
      archived: sql<boolean>`${campaign.archivedAt} is not null`,
    })
    .from(campaign)
    .leftJoin(appUser, eq(appUser.id, campaign.ownerUserId))
    .leftJoin(rulesetVersion, eq(rulesetVersion.id, campaign.rulesetVersionId))
    .leftJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
    .orderBy(desc(campaign.createdAt));

// Every imported pack, for finding the one a takedown notice names. Metadata only: an admin does not read pack content.
export const listPacks = () =>
  db
    .select({
      id: pack.id,
      slug: pack.slug,
      ownerUserId: pack.ownerUserId,
      license: pack.license,
      disabled: sql<boolean>`${pack.disabledAt} is not null`,
    })
    .from(pack)
    .orderBy(desc(pack.createdAt));

// Notice-and-takedown (docs/design.md §4.6): a disabled pack is served to nobody and can't be attached or re-imported,
// at once, in every room. Logged with the owner as target. false when there is no such pack.
export async function setPackDisabled({ packId, disabled }: { packId: string; disabled: boolean }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .update(pack)
      .set({ disabledAt: disabled ? new Date() : null })
      .where(eq(pack.id, packId))
      .returning({ slug: pack.slug, ownerUserId: pack.ownerUserId });
    if (!p) return false;
    await tx.insert(adminEvent).values({
      actorUserId: ADMIN_KEY_ACTOR,
      action: disabled ? "pack.disable" : "pack.enable",
      targetUserId: p.ownerUserId,
      detail: `${p.slug} (${packId})`,
    });
    return true;
  });
}

export const listEvents = () => db.select().from(adminEvent).orderBy(desc(adminEvent.createdAt)).limit(200);

// The admin key (scripts) is no user; its rows in the log carry this sentinel as the actor.
export const ADMIN_KEY_ACTOR = "admin-key";

export async function logAdminKey({
  action,
  campaignId,
  detail,
}: {
  action: AdminEventAction;
  campaignId?: string;
  detail?: string;
}) {
  await db.insert(adminEvent).values({ actorUserId: ADMIN_KEY_ACTOR, action, campaignId, detail });
}

// One housekeeping action at one room, as OPEN AS ADMIN, through the socket's own path (queue, transaction,
// authorize, kicks, broadcast). Null when the room doesn't exist.
export async function adminAction(
  table: Table,
  { campaignId, action }: { campaignId: string; action: Action },
): Promise<ActionResult | null> {
  const [c] = await db.select({ ownerUserId: campaign.ownerUserId }).from(campaign).where(eq(campaign.id, campaignId));
  if (!c) return null;
  return table.run({
    ctx: { campaignId, userId: null, campaignOwnerId: c.ownerUserId, seat: { kind: "admin" } },
    action,
  });
}
