import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { Codex, LiveState } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import {
  accessToken,
  appUser,
  invite,
  membership,
  membershipCharacter,
  ownershipTransfer,
} from "../auth/auth.schema.ts";
import { campaign, session } from "../campaign/campaign.schema.ts";
import { codexEntry, codexReveal } from "../codex/codex.schema.ts";
import { db } from "../core/db.ts";

const iso = (d: Date | null) => d?.toISOString() ?? null;

// The live snapshot, read after the action's transaction commits (CLAUDE.md, "The server decides").
// ponytail: whole snapshot per action, fine at table scale; versioned per-seat patches once a snapshot passes ~256 KB
// or its build passes ~50 ms at p95 in the P3 load test (docs/design.md §5.6)
export async function loadState(campaignId: string): Promise<LiveState | null> {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId));
  if (!c) return null;
  const [sessions, actors, members, held, invites, guests, [screens], [transfer]] = await Promise.all([
    db.select().from(session).where(eq(session.campaignId, campaignId)).orderBy(desc(session.number)).limit(1),
    db.select().from(actor).where(eq(actor.campaignId, campaignId)).orderBy(asc(actor.createdAt)),
    db
      .select({
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
        scopes: membership.scopes,
        name: appUser.name,
      })
      .from(membership)
      .innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(eq(membership.campaignId, campaignId))
      .orderBy(asc(membership.createdAt)),
    db
      .select({ membershipId: membershipCharacter.membershipId, actorId: membershipCharacter.actorId })
      .from(membershipCharacter)
      .innerJoin(membership, eq(membership.id, membershipCharacter.membershipId))
      .where(eq(membership.campaignId, campaignId)),
    db
      .select()
      .from(invite)
      .where(and(eq(invite.campaignId, campaignId), isNull(invite.revokedAt), gt(invite.expiresAt, new Date()))),
    db
      .selectDistinct({ actorId: accessToken.actorId })
      .from(accessToken)
      .where(
        and(eq(accessToken.campaignId, campaignId), eq(accessToken.role, "player"), isNull(accessToken.revokedAt)),
      ),
    db
      .select({ n: count() })
      .from(accessToken)
      .where(
        and(eq(accessToken.campaignId, campaignId), eq(accessToken.role, "screen"), isNull(accessToken.revokedAt)),
      ),
    db.select().from(ownershipTransfer).where(eq(ownershipTransfer.campaignId, campaignId)),
  ]);
  const last = sessions[0];
  return {
    campaign: {
      id: c.id,
      name: c.name,
      ownerUserId: c.ownerUserId,
      archived: c.archivedAt !== null,
      nextSessionAt: iso(c.nextSessionAt),
      nextSessionPlace: c.nextSessionPlace,
    },
    stateVersion: c.stateVersion,
    session:
      last && last.endedAt === null
        ? {
            id: last.id,
            number: last.number,
            title: last.title,
            startedAt: last.startedAt.toISOString(),
            endedAt: null,
            recap: last.recap,
            notes: last.notes,
          }
        : null,
    actors: actors.map((a) => ({ id: a.id, kind: a.kind, name: a.name, status: a.status, ownerUserId: a.ownerUserId })),
    access: {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        role: m.role,
        scopes: m.scopes,
        characterIds: held.filter((h) => h.membershipId === m.id).map((h) => h.actorId),
      })),
      invites: invites.map((i) => ({
        id: i.id,
        mode: i.mode,
        role: i.role,
        actorId: i.actorId,
        allowGuests: i.allowGuests,
        expiresAt: i.expiresAt.toISOString(),
        uses: i.uses,
        maxUses: i.maxUses,
      })),
      guests: guests.flatMap((g) => (g.actorId ? [{ actorId: g.actorId }] : [])),
      screens: screens?.n ?? 0,
      transfer:
        transfer && transfer.expiresAt > new Date()
          ? { toUserId: transfer.toUserId, expiresAt: transfer.expiresAt.toISOString() }
          : null,
    },
  };
}

export async function loadCodex(campaignId: string): Promise<Codex> {
  const [entries, reveals] = await Promise.all([
    db.select().from(codexEntry).where(eq(codexEntry.campaignId, campaignId)).orderBy(asc(codexEntry.createdAt)),
    db
      .select({ entryId: codexReveal.entryId, actorId: codexReveal.actorId })
      .from(codexReveal)
      .innerJoin(codexEntry, eq(codexEntry.id, codexReveal.entryId))
      .where(eq(codexEntry.campaignId, campaignId)),
  ]);
  return {
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      gmNotes: e.gmNotes,
      visibility: e.visibility,
      audienceMode: e.audienceMode,
      audience: reveals.filter((r) => r.entryId === e.id).map((r) => r.actorId),
    })),
  };
}
