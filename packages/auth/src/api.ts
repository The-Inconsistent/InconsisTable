import type { PlatformRole } from "./role.ts";

export type { PlatformRole } from "./role.ts";
export { PLATFORM_ROLES } from "./role.ts";

// Identity without an account: each device is an anonymous user, named by a random secret in the `it_device` cookie.
// The web proxy mints it, the api trusts a well-formed one and creates the user on first sight (auth.service.ts).
// ponytail: a lost cookie is a lost identity, sign in through the identity provider to keep one (house decision #33)
export const DEVICE_COOKIE = "it_device";

// Signing in (house decision #33, docs/research/auth-service-security.md §7.1, §7.4). Both are httpOnly, Secure,
// Path=/ and SameSite=Lax; the `__Host-` prefix keeps a sibling subdomain from setting them.
export const OIDC_TX_COOKIE = "__Host-it_oidc_tx";
export const SESSION_COOKIE = "__Host-it_session";

// `account` is set when the caller came through a session (signed in), absent for an anonymous device user.
export type AuthUser = { userId: string; name: string; creator: boolean; account?: { roles: PlatformRole[] } };

// 24 random bytes as base64url: 32 characters. Web Crypto only, so the Next proxy can call it too.
export function deviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// What the api accepts as a device secret or a session token: base64url, 32 to 200 characters.
export const isDeviceSecret = (s: string | undefined): s is string => !!s && /^[A-Za-z0-9_-]{32,200}$/.test(s);
