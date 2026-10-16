import { timingSafeEqual } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { AuthUser } from "@inconsistable/auth/api";
import type { Lobby, LobbyGame } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { appUser, membership } from "../auth/auth.schema.ts";
import { db } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { ruleset, rulesetVersion } from "../ruleset/ruleset.schema.ts";
import { campaign, session } from "./campaign.schema.ts";

// The admin key (scripts only) compared in constant time.
export function isAdminKey(key: string | undefined) {
  const expected = process.env.ADMIN_KEY;
  if (!expected || !key) return false;
  const a = Buffer.from(key),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A new room with its creator as owner and GM. `owner.name` is a placeholder until they next sign in.
// A ruleset version can be picked at creation, if the owner imported it (the same rule as campaign.setRuleset).
export function createCampaign({
  name,
  owner,
  rulesetVersionId,
}: {
  name: string;
  owner: { userId: string; name: string } | null;
  rulesetVersionId?: string;
}) {
  return db.transaction(async (tx) => {
    if (owner) await tx.insert(appUser).values({ id: owner.userId, name: owner.name }).onConflictDoNothing();
    if (rulesetVersionId) {
      const [mine] = await tx
        .select({ id: rulesetVersion.id })
        .from(rulesetVersion)
        .innerJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
        .where(and(eq(rulesetVersion.id, rulesetVersionId), eq(ruleset.ownerUserId, owner?.userId ?? "")));
      if (!mine) fail("rulesetNotFound");
    }
    const [c] = await tx
      .insert(campaign)
      .values({ name, ownerUserId: owner?.userId ?? null, rulesetVersionId })
      .returning({ id: campaign.id });
    const campaignId = c!.id; // the row was just inserted
    if (owner) await tx.insert(membership).values({ campaignId, userId: owner.userId, role: "gm" });
    return { campaignId };
  });
}

// The caller's rooms: the ones they own, the ones where they hold another seat, and the archived ones.
export async function lobby(user: AuthUser): Promise<Lobby> {
  const seats = await db
    .select({ campaignId: membership.campaignId, role: membership.role })
    .from(membership)
    .where(eq(membership.userId, user.userId));
  const ids = seats.map((s) => s.campaignId);
  const empty = { canCreate: user.creator, admin: user.admin, mine: [], seated: [], archived: [] };
  if (!ids.length) return empty;
  const [camps, owners, players, running] = await Promise.all([
    db.select().from(campaign).where(inArray(campaign.id, ids)),
    db
      .select({ id: appUser.id, name: appUser.name })
      .from(appUser)
      .innerJoin(campaign, eq(campaign.ownerUserId, appUser.id))
      .where(inArray(campaign.id, ids)),
    db
      .select({ campaignId: actor.campaignId, n: count() })
      .from(actor)
      .where(and(inArray(actor.campaignId, ids), eq(actor.kind, "pc")))
      .groupBy(actor.campaignId),
    db
      .select({ campaignId: session.campaignId, number: session.number })
      .from(session)
      .where(and(inArray(session.campaignId, ids), isNull(session.endedAt))),
  ]);
  const games = camps.map((c): LobbyGame & { archived: boolean } => ({
    id: c.id,
    name: c.name,
    owner: owners.find((o) => o.id === c.ownerUserId)?.name ?? "—",
    players: players.find((p) => p.campaignId === c.id)?.n ?? 0,
    session: running.find((r) => r.campaignId === c.id)?.number ?? null,
    role: seats.find((s) => s.campaignId === c.id)?.role ?? null,
    isOwner: c.ownerUserId === user.userId,
    nextSessionAt: c.nextSessionAt?.toISOString() ?? null,
    archived: c.archivedAt !== null,
  }));
  const strip = ({ archived: _a, ...g }: LobbyGame & { archived: boolean }): LobbyGame => g;
  return {
    ...empty,
    mine: games.filter((g) => g.isOwner && !g.archived).map(strip),
    seated: games.filter((g) => !g.isOwner && !g.archived).map(strip),
    archived: games.filter((g) => g.archived).map(strip),
  };
}
