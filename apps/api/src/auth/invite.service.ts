import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AuthUser } from "@inconsistable/auth/api";
import { AcceptInvite, type Actor, type InvitePreview } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { createActor } from "../actor/actor.actions.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { db, type Db, type Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { accessToken, invite, membership, membershipCharacter } from "./auth.schema.ts";
import { hash, issueToken } from "./auth.service.ts";

// A live invite by its code: not revoked, not expired, uses left.
async function liveInvite(conn: Db, code: string) {
  const [row] = await conn
    .select()
    .from(invite)
    .where(
      and(
        eq(invite.codeHash, hash(code)),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, new Date()),
        or(isNull(invite.maxUses), sql`${invite.uses} < ${invite.maxUses}`),
      ),
    );
  return row ?? fail("This invite has expired or was already used. Ask your GM for a new one");
}

// Characters someone plays: a seat holds them or a live guest token points at them.
export async function claimedActorIds(conn: Db, campaignId: string): Promise<Set<string>> {
  const [seated, guests] = await Promise.all([
    conn
      .select({ actorId: membershipCharacter.actorId })
      .from(membershipCharacter)
      .innerJoin(membership, eq(membership.id, membershipCharacter.membershipId))
      .where(eq(membership.campaignId, campaignId)),
    conn
      .select({ actorId: accessToken.actorId })
      .from(accessToken)
      .where(and(eq(accessToken.campaignId, campaignId), isNull(accessToken.revokedAt))),
  ]);
  return new Set([...seated, ...guests].flatMap((r) => (r.actorId ? [r.actorId] : [])));
}

const toActor = (r: typeof actor.$inferSelect): Actor => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  status: r.status,
  ownerUserId: r.ownerUserId,
});

// Player characters of a campaign: what an invite can offer.
const playerCharacters = (conn: Db, campaignId: string) =>
  conn
    .select()
    .from(actor)
    .where(and(eq(actor.campaignId, campaignId), eq(actor.kind, "pc"), eq(actor.status, "active")))
    .orderBy(asc(actor.createdAt));

export async function previewInvite({ code, user }: { code: string; user: AuthUser | null }): Promise<InvitePreview> {
  const inv = await liveInvite(db, code);
  const [[c], pcs, claimed] = await Promise.all([
    db.select({ name: campaign.name }).from(campaign).where(eq(campaign.id, inv.campaignId)),
    playerCharacters(db, inv.campaignId),
    claimedActorIds(db, inv.campaignId),
  ]);
  const [m] = user
    ? await db
        .select({ id: membership.id })
        .from(membership)
        .where(and(eq(membership.campaignId, inv.campaignId), eq(membership.userId, user.userId)))
    : [];
  const invited = pcs.find((r) => r.id === inv.actorId);
  return {
    campaignId: inv.campaignId,
    campaignName: c?.name ?? "?",
    mode: inv.mode,
    role: inv.role,
    actor: invited ? toActor(invited) : null,
    openActors: inv.mode === "room" && inv.role === "player" ? pcs.filter((r) => !claimed.has(r.id)).map(toActor) : [],
    allowGuests: inv.allowGuests,
    signedIn: !!user,
    member: !!m,
  };
}

// Accept: a signed-in user takes a seat; a guest gets a player token (the caller sets it as the guest cookie).
// Runs in the campaign's action queue (TableGateway.mutate), so the claim checks can't race.
export async function acceptInvite(
  tx: Tx,
  { code, user, body }: { code: string; user: AuthUser | null; body: unknown },
): Promise<{ campaignId: string; guestToken?: string }> {
  const parsed = AcceptInvite.safeParse(body);
  if (!parsed.success) fail("Pick a character, or name a new one");
  const b = parsed.data;
  const inv = await liveInvite(tx, code);
  const campaignId = inv.campaignId;
  // A change at the table like any action: it bumps the state version (docs/design.md §5.6); a refusal rolls it back.
  const [c] = await tx
    .update(campaign)
    .set({ stateVersion: sql`${campaign.stateVersion} + 1` })
    .where(eq(campaign.id, campaignId))
    .returning({ archivedAt: campaign.archivedAt });
  if (c?.archivedAt) fail("This game is archived");
  if (b.asGuest && !inv.allowGuests) fail("This invite needs an account. Sign in first");
  if (!b.asGuest && !user) fail("Sign in first, or join as a guest");
  if (!b.asGuest && user) {
    const [m] = await tx
      .select({ id: membership.id })
      .from(membership)
      .where(and(eq(membership.campaignId, campaignId), eq(membership.userId, user.userId)));
    if (m) return { campaignId }; // already seated: nothing to use up
  }

  const useUp = () =>
    tx
      .update(invite)
      .set({ uses: sql`${invite.uses} + 1` })
      .where(eq(invite.id, inv.id));

  // A GM or co-GM invite seats them without a character.
  if (inv.role !== "player") {
    await useUp();
    await tx.insert(membership).values({ campaignId, userId: user!.userId, role: inv.role }); // !: guests refused above
    return { campaignId };
  }

  // Which character: the invited one, an open one the player picked, or a new one by name (room invites).
  const claimed = await claimedActorIds(tx, campaignId);
  const open = (await playerCharacters(tx, campaignId)).filter((r) => !claimed.has(r.id));
  let actorId: string;
  if (inv.mode === "character") {
    actorId = inv.actorId ?? fail("Invite has no character");
    if (!open.some((r) => r.id === actorId)) fail("That character is already taken");
  } else if (b.actorId) {
    if (!open.some((r) => r.id === b.actorId)) fail("That character is already taken");
    actorId = b.actorId;
  } else if (b.newCharacterName) {
    actorId = await createActor(tx, {
      campaignId,
      kind: "pc",
      name: b.newCharacterName,
      ownerUserId: b.asGuest ? null : user!.userId, // !: checked above
    });
  } else fail("Pick a character, or name a new one");

  await useUp();
  if (b.asGuest) return { campaignId, guestToken: await issueToken(tx, { campaignId, actorId }) };
  const [m] = await tx
    .insert(membership)
    .values({ campaignId, userId: user!.userId, role: "player" }) // !: checked above
    .returning({ id: membership.id });
  await tx.insert(membershipCharacter).values({ membershipId: m!.id, actorId }); // the row was just inserted
  // The player owns what they play from now on (export to their library).
  await tx
    .update(actor)
    .set({ ownerUserId: user!.userId })
    .where(and(eq(actor.id, actorId), isNull(actor.ownerUserId)));
  return { campaignId };
}
