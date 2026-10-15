// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- type.d.ts is a global Clerk augmentation, not a module
/// <reference path="../type.d.ts" />
import { timingSafeEqual } from "node:crypto";
import { verifyToken } from "@clerk/backend";
import { TokenVerificationError, TokenVerificationErrorReason as Reason } from "@clerk/backend/errors";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { PLATFORM_ROLES, type PlatformRole } from "./role.ts";

export type { ClerkRole, PlatformRole } from "./role.ts";
export { PLATFORM_ROLES } from "./role.ts";

// Clerk session tokens (JWTs). The browser keeps one in the `__session` cookie; server-side Next sends it as a Bearer
// header. The custom claims (../type.d.ts) carry the user's name and app role, so the api needs no network call.

export const SESSION_COOKIE = "__session";

// An admin is also a creator. Roles come only from the verified token: the app never writes them (docs/design.md §3.6).
export type AuthUser = { userId: string; name: string; creator: boolean; moderator: boolean; admin: boolean };

// A token's own fault: the caller is just signed out. Anything else (no key, Clerk unreachable) is ours, so it's logged.
const TOKEN_FAULTS = new Set<string>([
  Reason.TokenExpired,
  Reason.TokenInvalid,
  Reason.TokenInvalidAlgorithm,
  Reason.TokenInvalidAuthorizedParties,
  Reason.TokenInvalidSignature,
  Reason.TokenNotActiveYet,
  Reason.TokenIatInTheFuture,
  Reason.JWKKidMismatch,
]);

const userOf = ({ userId, name, role }: { userId: string; name: string; role: string | undefined }): AuthUser => ({
  userId,
  name,
  creator: role === "creator" || role === "admin",
  moderator: role === "moderator",
  admin: role === "admin",
});

// Test-only tokens `test.<secret>.<userId>.<creator|member|moderator|admin>` let the smoke test act as signed-in users without a
// Clerk instance. Never in production, and fail closed: only when NODE_ENV says test or development (Bun leaves it unset).
if (process.env.CLERK_TEST_SECRET && process.env.NODE_ENV === "production")
  throw new Error("CLERK_TEST_SECRET must not be set in production");
const TEST_SECRET =
  process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development"
    ? process.env.CLERK_TEST_SECRET || undefined
    : undefined;
const isTestSecret = (s: string) => {
  const a = Buffer.from(s);
  const b = Buffer.from(TEST_SECRET ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
};

export const testSessionToken = ({
  secret,
  userId,
  role = "user",
}: {
  secret: string;
  userId: string;
  role?: PlatformRole;
}) => `test.${secret}.${userId}.${role}`;

// Browser origins allowed to present a token (the `azp` claim): the web app's address(es), comma separated.
const authorizedParties = process.env.WEB_ORIGIN?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// CLERK_JWT_KEY as its bare base64 body. Env editors mangle a multi-line PEM (Dockhand turned its newlines into spaces),
// and Clerk strips only newlines, so a stray space breaks the key and every token fails as "signed out". Clerk accepts
// the bare body: it strips the header and footer itself when they're present.
export const pemBody = (pem: string | undefined) =>
  pem?.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s+/g, "") || undefined;
const jwtKey = pemBody(process.env.CLERK_JWT_KEY);

export async function verifySession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  if (TEST_SECRET && token.startsWith("test.")) {
    const [, secret, userId, role] = token.split(".");
    return secret !== undefined && isTestSecret(secret) && userId ? userOf({ userId, name: userId, role }) : null;
  }
  try {
    const claims = await verifyToken(token, { jwtKey, secretKey: process.env.CLERK_SECRET_KEY, authorizedParties });
    const { metadata, name, username } = claims;
    const displayName = [name, username].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "Player";
    return userOf({ userId: claims.sub, name: displayName, role: metadata?.role });
  } catch (e) {
    // Expired, forged, or from another origin: treated as signed out.
    if (!(e instanceof TokenVerificationError && TOKEN_FAULTS.has(e.reason))) console.error(e);
    return null;
  }
}

// A Clerk user change worth acting on: the app keeps a seat open per socket, so the api drops the user's sockets when
// their role or lock changes, or the account goes (docs/handoff.md).
export type UserWebhook =
  | { type: "user.updated"; userId: string; role: PlatformRole; locked: boolean }
  | { type: "user.deleted"; userId: string };

// Verifies a Clerk webhook (Svix signature, through @clerk/backend) and returns the user change it carries, or null for
// any other event. Throws when the signature, the headers or the timestamp are not valid: the caller refuses the request.
export async function readUserWebhook({
  request,
  signingSecret,
}: {
  request: Request;
  signingSecret: string;
}): Promise<UserWebhook | null> {
  const event = await verifyWebhook(request, { signingSecret });
  if (event.type === "user.updated") {
    const role = PLATFORM_ROLES.find((r) => r === event.data.public_metadata?.role) ?? "user";
    return { type: event.type, userId: event.data.id, role, locked: event.data.locked === true };
  }
  if (event.type === "user.deleted" && event.data.id) return { type: event.type, userId: event.data.id };
  return null;
}

// The session token on a request: `Authorization: Bearer …` (server-side Next), else the `__session` cookie (browser).
export const bearerOf = (authorization: string | undefined) =>
  authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
