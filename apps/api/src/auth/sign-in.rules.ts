import { readFileSync } from "node:fs";
import { z } from "zod";
import type { IdpClientOptions } from "@the-inconsistent/client";
import type { PlatformRole } from "@inconsistable/auth/api";

// The pure rules of signing in, with no database: the boot config, where a sign-in may return to, and what the ID
// token's roles make of an app_user.

// What the api refuses on its own, beside the SDK's IdpErrorCode: a callback without a live transaction, and a logout
// token already acted on. Logged, never shown.
export const LocalRefusal = z.enum(["no_transaction", "replayed"]);
export type LocalRefusal = z.infer<typeof LocalRefusal>;

// The callback route (sign-in.controller.ts); the registered redirect URI must end in it.
export const CALLBACK_PATH = "/api/auth/callback";

// The web routes a sign-in may land back on (RFC 9700 §4.11.1: the client is no open redirector). Anything else is "/".
const RETURN_TO = /^\/(?:library|admin|c\/[0-9a-f-]{36})?$/;
export const safeReturnTo = (value: unknown): string =>
  typeof value === "string" && RETURN_TO.test(value) ? value : "/";

// `app_user.role` gates starting rooms, so it is `creator` exactly when the token says so (§8). `admin` grants nothing
// in this slice; it travels on the session's roles only.
export const userRoleOf = (roles: readonly PlatformRole[]): PlatformRole =>
  roles.includes("creator") ? "creator" : "user";

export type SignInConfig = Omit<IdpClientOptions, "privateJwk"> & {
  privateJwk: PrivateJwk;
  // The web origin the callback lands on; the login POST must come from it (its cookies are set for that origin).
  webOrigin: string;
};

// The client's private ES256 key, as the SDK takes it; checked here so a bad file refuses to boot.
const PrivateJwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  kid: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1),
});
type PrivateJwk = z.infer<typeof PrivateJwk>;

const Raw = z.object({
  NODE_ENV: z.string().optional(),
  IDP_SIGN_IN: z.stringbool().default(false),
  IDP_DEV_HTTP: z.stringbool().default(false),
  IDP_ISSUER: z.url().optional(),
  IDP_CLIENT_ID: z.string().min(1).max(200).optional(),
  IDP_REDIRECT_URI: z.url().optional(),
  IDP_CLIENT_JWK_FILE: z.string().min(1).optional(),
});

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

// Accounts exist only on HTTPS deployments (house decision #33). Plain http is allowed only for a loopback host, with
// IDP_DEV_HTTP=1 and outside production: browsers keep Secure cookies on http://localhost, nowhere else.
function httpProblem({ url, devHttp, production }: { url: string; devHttp: boolean; production: boolean }) {
  const u = new URL(url);
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && devHttp && !production && LOOPBACK.includes(u.hostname)) return null;
  return `${url} must be https (http only for localhost, with IDP_DEV_HTTP=1, outside production)`;
}

// Read once at boot. Sign-in is off (null) unless IDP_SIGN_IN=1; once on, a missing or unsafe value refuses to boot.
export function loadSignInConfig(env: Record<string, string | undefined>): SignInConfig | null {
  const raw = Raw.parse(env);
  if (!raw.IDP_SIGN_IN) return null;
  const {
    IDP_ISSUER: issuer,
    IDP_CLIENT_ID: clientId,
    IDP_REDIRECT_URI: redirectUri,
    IDP_CLIENT_JWK_FILE: jwkFile,
  } = raw;
  if (!issuer || !clientId || !redirectUri || !jwkFile) {
    throw new Error("IDP_SIGN_IN=1 needs IDP_ISSUER, IDP_CLIENT_ID, IDP_REDIRECT_URI and IDP_CLIENT_JWK_FILE");
  }
  for (const url of [issuer, redirectUri]) {
    const problem = httpProblem({ url, devHttp: raw.IDP_DEV_HTTP, production: raw.NODE_ENV === "production" });
    if (problem) throw new Error(problem);
  }
  const redirect = new URL(redirectUri);
  if (redirect.pathname !== CALLBACK_PATH || redirect.search) {
    throw new Error(`IDP_REDIRECT_URI must be <web origin>${CALLBACK_PATH}`);
  }
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(jwkFile, "utf8"));
  } catch (error) {
    throw new Error(`IDP_CLIENT_JWK_FILE ${jwkFile} is missing or not JSON`, { cause: error });
  }
  const privateJwk = PrivateJwk.safeParse(file);
  if (!privateJwk.success) throw new Error(`IDP_CLIENT_JWK_FILE ${jwkFile} is not a private ES256 JWK`);
  return {
    issuer,
    clientId,
    redirectUri,
    postLogoutRedirectUri: `${redirect.origin}/`,
    privateJwk: privateJwk.data,
    webOrigin: redirect.origin,
  };
}
