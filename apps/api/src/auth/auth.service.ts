import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { DEVICE_COOKIE, isDeviceSecret, type AuthUser } from "@inconsistable/auth/api";
import type { Ctx } from "@inconsistable/core-schema";
import { campaign } from "../campaign/campaign.schema.ts";
import { isAdminKey } from "../campaign/campaign.service.ts";
import { db, type Db, type Tx } from "../core/db.ts";
import { accessToken, appUser, device, membership, membershipCharacter } from "./auth.schema.ts";

// Guest login cookie (a player QR token). Every device also has `it_device` (deviceUser).
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
export function readCookie({ header, name = COOKIE }: { header: string | undefined; name?: string }) {
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

// The device's user, made on first sight of a well-formed `it_device` secret. Null for a missing or malformed secret
// (the web proxy mints a fresh one). Two first requests at once make one user: the loser of the device insert undoes
// the user it just made and reads the winner's.
export async function deviceUser(headers: { cookie?: string }): Promise<AuthUser | null> {
  const secret = readCookie({ header: headers.cookie, name: DEVICE_COOKIE });
  if (!isDeviceSecret(secret)) return null;
  const tokenHash = hash(secret);
  const find = async () => {
    const [row] = await db
      .select({ userId: appUser.id, name: appUser.name, role: appUser.role })
      .from(device)
      .innerJoin(appUser, eq(appUser.id, device.userId))
      .where(eq(device.tokenHash, tokenHash));
    return row && { userId: row.userId, name: row.name, creator: row.role === "creator" };
  };
  const known = await find();
  if (known) return known;
  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(appUser)
      .values({ id: sql`uuidv7()::text`, name: DEFAULT_NAME })
      .returning({ id: appUser.id });
    const [d] = await tx
      .insert(device)
      .values({ tokenHash, userId: u!.id }) // !: the insert returned its row
      .onConflictDoNothing()
      .returning({ tokenHash: device.tokenHash });
    if (!d) await tx.delete(appUser).where(eq(appUser.id, u!.id));
  });
  return (await find()) ?? null;
}

export const DEFAULT_NAME = "Player";

// The name other seats see. Trimmed and bounded by the caller's schema (campaign.controller).
export const renameUser = (userId: string, name: string) =>
  db.update(appUser).set({ name, updatedAt: new Date() }).where(eq(appUser.id, userId));

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

// A guest token's seat and its token's hash (what the rate limits key a token seat by).
async function guestSeat(token: string | undefined): Promise<{ ctx: Ctx; tokenId: string } | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      tokenHash: accessToken.tokenHash,
      campaignId: accessToken.campaignId,
      role: accessToken.role,
      actorId: accessToken.actorId,
    })
    .from(accessToken)
    .where(and(eq(accessToken.tokenHash, hash(token)), isNull(accessToken.revokedAt)));
  if (!row) return null;
  const c = await ownerOf(db, row.campaignId);
  if (!c) return null;
  return {
    tokenId: row.tokenHash,
    ctx: {
      campaignId: row.campaignId,
      userId: null,
      campaignOwnerId: c.ownerUserId,
      seat: { kind: "token", role: row.role, characterIds: row.actorId ? [row.actorId] : [] },
    },
  };
}

export async function resolveGuest(token: string | undefined): Promise<Ctx | null> {
  const guest = await guestSeat(token);
  return guest?.ctx ?? null;
}

// One seat, however many sockets it opens: a signed-in user, else the guest token's row.
const seatKey = ({ campaignId, userId, tokenId }: { campaignId: string; userId: string | null; tokenId?: string }) =>
  `${campaignId}:${userId ?? tokenId}`;

// The caller at `campaignId`: a member (by device) first, else a token for that same campaign. OPEN AS ADMIN is not
// here: it is the socket's `adminKey` handshake (resolveSocketCtx).
export async function resolveCtx({
  campaignId,
  headers,
}: {
  campaignId: string;
  headers: { cookie?: string };
}): Promise<{ ctx: Ctx; seatKey: string } | null> {
  const user = await deviceUser(headers);
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
      return {
        ctx: { campaignId, userId: user.userId, campaignOwnerId: c.ownerUserId, seat },
        seatKey: seatKey({ campaignId, userId: user.userId }),
      };
    }
  }
  const guest = await guestSeat(readCookie({ header: headers.cookie }));
  return guest?.ctx.campaignId === campaignId
    ? { ctx: guest.ctx, seatKey: seatKey({ campaignId, userId: null, tokenId: guest.tokenId }) }
    : null;
}

// What a client puts in `io({ auth })`. Browsers send only campaignId; the `it_device` or guest cookie proves who they
// are. Scripts, tests and the admin page pass a token instead: a guest `token`, or the server's `adminKey`.
const Handshake = z.object({
  campaignId: z.uuid().optional(),
  token: z.string().max(200).optional(),
  adminKey: z.string().max(500).optional(),
});

// The caller of a socket handshake, or null to refuse it. `script` marks the admin key (exempt from the action limit,
// logged as key.action); `seatKey` names the seat for the rate limits, so a second socket of the same seat shares them.
export async function resolveSocketCtx({
  auth,
  headers,
}: {
  auth: unknown;
  headers: { cookie?: string };
}): Promise<{ ctx: Ctx; script: boolean; seatKey: string } | null> {
  const h = Handshake.safeParse(auth ?? {});
  if (!h.success) return null;
  const { campaignId, token, adminKey } = h.data;
  if (adminKey && campaignId) {
    if (!isAdminKey(adminKey)) return null;
    const c = await ownerOf(db, campaignId);
    if (!c) return null;
    const ctx: Ctx = { campaignId, userId: null, campaignOwnerId: c.ownerUserId, seat: { kind: "admin" } };
    return { ctx, script: true, seatKey: `${campaignId}:admin-key` };
  }
  if (token) {
    const guest = await guestSeat(token);
    return guest && (!campaignId || guest.ctx.campaignId === campaignId)
      ? {
          ctx: guest.ctx,
          script: false,
          seatKey: seatKey({ campaignId: guest.ctx.campaignId, userId: null, tokenId: guest.tokenId }),
        }
      : null;
  }
  if (!campaignId) return null;
  const r = await resolveCtx({ campaignId, headers });
  return r && { ...r, script: false };
}
