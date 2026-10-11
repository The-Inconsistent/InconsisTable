import { desc, eq, sql } from "drizzle-orm";
import type { Action, ActionResult } from "@inconsistable/core-schema";
import { appUser } from "../auth/auth.schema.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { db } from "../core/db.ts";
import type { TableGateway } from "../table/table.gateway.ts";
import { adminEvent } from "./admin.schema.ts";

// ponytail: whole lists, fine for a private deployment; paginate once rooms or users pass a few hundred
export const listCampaigns = () =>
  db
    .select({
      id: campaign.id,
      name: campaign.name,
      ownerUserId: campaign.ownerUserId,
      archived: sql<boolean>`${campaign.archivedAt} is not null`,
    })
    .from(campaign)
    .orderBy(desc(campaign.createdAt));

export const listEvents = () => db.select().from(adminEvent).orderBy(desc(adminEvent.createdAt)).limit(200);

// One housekeeping action at one room, as OPEN AS ADMIN, through the socket's own path (queue, transaction,
// authorize, kicks, broadcast). Null when the room doesn't exist.
export async function adminAction(
  table: TableGateway,
  { adminId, campaignId, action }: { adminId: string; campaignId: string; action: Action },
): Promise<ActionResult | null> {
  const [c] = await db.select({ ownerUserId: campaign.ownerUserId }).from(campaign).where(eq(campaign.id, campaignId));
  if (!c) return null;
  return table.run({
    ctx: { campaignId, userId: adminId, campaignOwnerId: c.ownerUserId, seat: { kind: "admin" } },
    action,
  });
}

// A moderator's or admin's lock: the user is signed out of the app (signedInUser) and every open socket drops.
// Admins and moderators can't be locked from here; that stays in the Clerk Dashboard.
export async function setLock(
  table: TableGateway,
  { actorUserId, userId, locked }: { actorUserId: string; userId: string; locked: boolean },
): Promise<"ok" | "not-found" | "protected"> {
  const [u] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, userId));
  if (!u) return "not-found";
  if (u.role === "admin" || u.role === "moderator") return "protected";
  await db.transaction(async (tx) => {
    await tx
      .update(appUser)
      .set({ lockedAt: locked ? new Date() : null })
      .where(eq(appUser.id, userId));
    await tx
      .insert(adminEvent)
      .values({ actorUserId, action: locked ? "user.lock" : "user.unlock", targetUserId: userId });
  });
  await table.kickUser(userId);
  return "ok";
}
