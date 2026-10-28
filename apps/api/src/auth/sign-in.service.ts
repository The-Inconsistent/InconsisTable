import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { createIdpClient, IdpError, type IdpClient, type IdpErrorCode, type SignIn } from "@the-inconsistent/client";
import { isDeviceSecret, type PlatformRole } from "@inconsistable/auth/api";
import { db, type Tx } from "../core/db.ts";
import { appUser } from "./auth.schema.ts";
import { DEFAULT_NAME, hash, newSecret } from "./auth.service.ts";
import { SESSION_IDLE_MS, SESSION_MAX_MS, apiSession, identityLink, logoutJti, oidcTx } from "./session.schema.ts";
import { userRoleOf, type LocalRefusal, type SignInConfig } from "./sign-in.rules.ts";

// Signing in through InconsisID with its SDK (docs/research/auth-service-security.md §7). The SDK checks the protocol;
// this module keeps what the SDK leaves to its caller: the single-use transaction, the identity link, the api's own
// session, and the logout-token replay table. It returns the hashes of the sessions it ends, so the caller can
// disconnect their sockets.

const TX_TTL = sql`interval '10 minutes'`;
// The SDK accepts a logout token up to 30 s past its `exp`; a jti is kept a minute past it so a replay inside that
// tolerance still finds its row.
const JTI_KEEP_MS = 60_000;

export type Refusal = LocalRefusal | IdpErrorCode;
export type Finished =
  { ok: true; token: string; returnTo: string; userId: string; ended: string[] } | { ok: false; reason: Refusal };
export type LogoutReceived = { ok: true; ended: string[] } | { ok: false; reason: Refusal };

const ENDED = { tokenHash: apiSession.tokenHash };
const hashes = (rows: { tokenHash: string }[]) => rows.map((r) => r.tokenHash);

// The (iss, sub) account's user, made on its first sign-in, with app_user.role set from the token each time (§8).
// Two first callbacks at once make one user: the link's primary key picks a winner; the loser drops the user it just
// made and reads the winner's. The device user of the browser is left untouched (ADR 0005).
export async function linkIdentity(
  tx: Tx,
  { iss, sub, roles }: Pick<SignIn, "iss" | "sub"> & { roles: PlatformRole[] },
) {
  const role = userRoleOf(roles);
  const linked = async () =>
    (
      await tx
        .select({ userId: identityLink.userId })
        .from(identityLink)
        .where(and(eq(identityLink.iss, iss), eq(identityLink.sub, sub)))
    )[0]?.userId;
  const known = await linked();
  if (known) {
    await tx.update(appUser).set({ role, updatedAt: new Date() }).where(eq(appUser.id, known));
    return known;
  }
  const [u] = await tx
    .insert(appUser)
    .values({ id: sql`uuidv7()::text`, name: DEFAULT_NAME, role })
    .returning({ id: appUser.id });
  const userId = u!.id; // !: the insert returned its row
  const [won] = await tx
    .insert(identityLink)
    .values({ iss, sub, userId })
    .onConflictDoNothing()
    .returning({ userId: identityLink.userId });
  if (won) return userId;
  await tx.delete(appUser).where(eq(appUser.id, userId));
  const winner = await linked();
  if (!winner) throw new Error("identity link lost its race and found no winner");
  return winner;
}

// A fresh session for a user who just signed in; the token goes in the cookie, only its hash in the row. Dead
// sessions are pruned here, the one place sessions are made.
export async function issueSession(
  tx: Tx,
  { userId, opSid, roles }: { userId: string; opSid: string; roles: PlatformRole[] },
) {
  const now = Date.now();
  await tx
    .delete(apiSession)
    .where(or(lt(apiSession.expiresAt, new Date(now)), lt(apiSession.lastSeenAt, new Date(now - SESSION_IDLE_MS))));
  const token = newSecret();
  await tx
    .insert(apiSession)
    .values({ tokenHash: hash(token), userId, opSid, roles, expiresAt: new Date(now + SESSION_MAX_MS) });
  return token;
}

export async function endSessionByToken(token: string | undefined): Promise<string[]> {
  if (!isDeviceSecret(token)) return [];
  return hashes(
    await db
      .delete(apiSession)
      .where(eq(apiSession.tokenHash, hash(token)))
      .returning(ENDED),
  );
}

export type SignInFlows = ReturnType<typeof signInFlows>;

// The flows for one configured identity provider. The SDK client is made on first use and remade after a failure,
// so an api that boots while the provider is down still serves anonymous tables and signs in once it is back.
export function signInFlows(config: SignInConfig) {
  let client: Promise<IdpClient> | undefined;
  const idp = () =>
    (client ??= createIdpClient(config).catch((error: unknown) => {
      client = undefined;
      throw error;
    }));

  // POST /api/auth/login: a transaction row keyed by the hash of a handle the caller puts in its cookie.
  async function start({ deviceUserId, returnTo }: { deviceUserId: string | null; returnTo: string }) {
    const { url, transaction } = await (await idp()).startSignIn({ purpose: "signin" });
    const handle = newSecret();
    await db.delete(oidcTx).where(lt(oidcTx.createdAt, sql`now() - ${TX_TTL}`));
    await db.insert(oidcTx).values({ handleHash: hash(handle), transaction, deviceUserId, returnTo });
    return { handle, url };
  }

  // GET /api/auth/callback, in the order of §7.2: the transaction is deleted on first read (one use, this browser
  // only), then the SDK's checks, then the link and a fresh session. The browser's previous session, if any, ends.
  async function finish({
    handle,
    callbackUrl,
    previousSession,
  }: {
    handle: string | undefined;
    callbackUrl: string;
    previousSession: string | undefined;
  }): Promise<Finished> {
    if (!isDeviceSecret(handle)) return { ok: false, reason: "no_transaction" };
    const [row] = await db
      .delete(oidcTx)
      .where(and(eq(oidcTx.handleHash, hash(handle)), gt(oidcTx.createdAt, sql`now() - ${TX_TTL}`)))
      .returning({ transaction: oidcTx.transaction, returnTo: oidcTx.returnTo });
    if (!row) return { ok: false, reason: "no_transaction" };
    let signIn: SignIn;
    try {
      signIn = await (await idp()).finishSignIn(callbackUrl, row.transaction);
    } catch (error) {
      if (error instanceof IdpError) return { ok: false, reason: error.code };
      throw error;
    }
    const ended = await endSessionByToken(previousSession);
    const roles: PlatformRole[] = signIn.roles;
    const { userId, token } = await db.transaction(async (tx) => {
      const linked = await linkIdentity(tx, { iss: signIn.iss, sub: signIn.sub, roles });
      return { userId: linked, token: await issueSession(tx, { userId: linked, opSid: signIn.sid, roles }) };
    });
    return { ok: true, token, returnTo: row.returnTo, userId, ended };
  }

  // POST /api/auth/logout ends the api session first; the provider then asks the user to confirm its own logout.
  // Without a reachable provider the user still ends up signed out here, back on the lobby.
  async function logout(token: string | undefined) {
    const ended = await endSessionByToken(token);
    try {
      return { ended, redirect: (await idp()).logoutUrl().href };
    } catch (error) {
      if (error instanceof IdpError) return { ended, redirect: "/" };
      throw error;
    }
  }

  // POST /api/auth/backchannel-logout (§7.6): the SDK verifies the token; a jti seen before is a replay. A `sid` ends
  // that provider session; a token with only `sub` ends every session of the linked user.
  async function receiveLogout(logoutToken: string): Promise<LogoutReceived> {
    let claims: Awaited<ReturnType<IdpClient["verifyLogoutToken"]>>;
    try {
      claims = await (await idp()).verifyLogoutToken(logoutToken);
    } catch (error) {
      if (error instanceof IdpError) return { ok: false, reason: error.code };
      throw error;
    }
    const { sub, sid, jti, exp } = claims;
    await db.delete(logoutJti).where(lt(logoutJti.exp, new Date(Date.now() - JTI_KEEP_MS)));
    const [fresh] = await db
      .insert(logoutJti)
      .values({ jti, exp: new Date(exp * 1000) })
      .onConflictDoNothing()
      .returning({ jti: logoutJti.jti });
    if (!fresh) return { ok: false, reason: "replayed" };
    if (sid)
      return { ok: true, ended: hashes(await db.delete(apiSession).where(eq(apiSession.opSid, sid)).returning(ENDED)) };
    const linked = db
      .select({ userId: identityLink.userId })
      .from(identityLink)
      .where(and(eq(identityLink.iss, config.issuer), eq(identityLink.sub, sub ?? "")));
    return {
      ok: true,
      ended: hashes(await db.delete(apiSession).where(inArray(apiSession.userId, linked)).returning(ENDED)),
    };
  }

  return { config, warm: idp, start, finish, logout, receiveLogout };
}
