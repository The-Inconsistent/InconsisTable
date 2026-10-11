import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SESSION_COOKIE, bearerOf, verifySession, type AuthUser } from "@inconsistable/auth/api";
import type { Ctx, PlatformRole } from "@inconsistable/core-schema";
import { campaign } from "../campaign/campaign.schema.ts";
import { db, type Db, type Tx } from "../core/db.ts";
import { accessToken, appUser, membership, membershipCharacter } from "./auth.schema.ts";

// Guest login cookie (a player QR token). Signed-in users use Clerk's `__session` instead.
export const COOKIE = "it_token";

export const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newSecret = () => randomBytes(24).toString("base64url");

// Guest player token for one character (the per-character QR).
export async function issueToken(tx: Tx, { campaignId, actorId }: { campaignId: string; actorId: string }) {
  const token = newSecret();
  await tx.insert(accessToken).values({ tokenHash: hash(token), campaignId, role: "player", actorId });
  return token;
}

// Screen token for the table's TV: no character, and the seat only reads (canInCampaign).
// ponytail: every SCREEN QR tap mints a token that lives until REVOKE SCREENS; reuse or expire them if TVs multiply.
export async function issueScreenToken(tx: Tx, { campaignId }: { campaignId: string }) {
  const token = newSecret();
  await tx.insert(accessToken).values({ tokenHash: hash(token), campaignId, role: "screen", actorId: null });
  return token;
}

// Header is attacker-controlled: a malformed escape (`it_token=%`) reads as no value instead of throwing, which in the
// socket middleware would be an unhandled rejection and take the process down.
export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join("="));
    } catch {
      return undefined;
    }
  }
}

const platformRoleOf = (user: AuthUser): PlatformRole =>
  user.admin ? "admin" : user.moderator ? "moderator" : user.creator ? "creator" : "user";

// The signed-in Clerk user on a request, if any, and not locked by a moderator. Their display name and a display copy
// of their Clerk role are kept fresh for member lists and the admin page; the app never writes the role to Clerk.
export async function signedInUser(headers: { authorization?: string; cookie?: string }): Promise<AuthUser | null> {
  const user = await verifySession(bearerOf(headers.authorization) ?? readCookie(headers.cookie, SESSION_COOKIE));
  if (!user) return null;
  const role = platformRoleOf(user);
  const [row] = await db
    .insert(appUser)
    .values({ id: user.userId, name: user.name, role })
    // Only when something changed or the last-seen stamp has gone stale: rewriting the same values on every request
    // would churn a row version per call for nothing.
    .onConflictDoUpdate({
      target: appUser.id,
      set: { name: user.name, role, lastSeenAt: new Date(), updatedAt: new Date() },
      setWhere: sql`${appUser.name} is distinct from ${user.name} or ${appUser.role} is distinct from ${role} or ${appUser.lastSeenAt} < now() - interval '1 hour'`,
    })
    .returning({ lockedAt: appUser.lockedAt });
  // No row back means nothing changed: read the lock separately.
  const lockedAt =
    row?.lockedAt ??
    (await db.select({ lockedAt: appUser.lockedAt }).from(appUser).where(eq(appUser.id, user.userId)))[0]?.lockedAt;
  return lockedAt ? null : user;
}

const ownerOf = async (conn: Db, campaignId: string) =>
  (await conn.select({ ownerUserId: campaign.ownerUserId }).from(campaign).where(eq(campaign.id, campaignId)))[0];

// The characters a membership holds.
export async function heldCharacters(conn: Db, membershipId: string): Promise<string[]> {
  const rows = await conn
    .select({ actorId: membershipCharacter.actorId })
    .from(membershipCharacter)
    .where(eq(membershipCharacter.membershipId, membershipId));
  return rows.map((r) => r.actorId);
}

export async function resolveGuest(token: string | undefined): Promise<Ctx | null> {
  if (!token) return null;
  const [row] = await db
    .select({ campaignId: accessToken.campaignId, role: accessToken.role, actorId: accessToken.actorId })
    .from(accessToken)
    .where(and(eq(accessToken.tokenHash, hash(token)), isNull(accessToken.revokedAt)));
  if (!row) return null;
  const c = await ownerOf(db, row.campaignId);
  if (!c) return null;
  return {
    campaignId: row.campaignId,
    userId: null,
    campaignOwnerId: c.ownerUserId,
    seat: { kind: "token", role: row.role, characterIds: row.actorId ? [row.actorId] : [] },
  };
}

// The caller at `campaignId`: a signed-in member first, else an admin without a seat (OPEN AS ADMIN), else a token
// for that same campaign. A seated admin gets their seat, never admin powers (docs/design.md §3.6).
export async function resolveCtx({
  campaignId,
  headers,
}: {
  campaignId: string;
  headers: { authorization?: string; cookie?: string };
}): Promise<{ ctx: Ctx; openedAsAdmin: boolean } | null> {
  const user = await signedInUser(headers);
  if (user) {
    const c = await ownerOf(db, campaignId);
    if (!c) return null;
    const [m] = await db
      .select({ id: membership.id, role: membership.role, scopes: membership.scopes })
      .from(membership)
      .where(and(eq(membership.campaignId, campaignId), eq(membership.userId, user.userId)));
    if (m) {
      const characterIds = await heldCharacters(db, m.id);
      const seat = { kind: "member" as const, role: m.role, scopes: m.scopes, characterIds };
      return { ctx: { campaignId, userId: user.userId, campaignOwnerId: c.ownerUserId, seat }, openedAsAdmin: false };
    }
    if (user.admin)
      return {
        ctx: { campaignId, userId: user.userId, campaignOwnerId: c.ownerUserId, seat: { kind: "admin" } },
        openedAsAdmin: true,
      };
  }
  const guest = await resolveGuest(readCookie(headers.cookie));
  return guest?.campaignId === campaignId ? { ctx: guest, openedAsAdmin: false } : null;
}
