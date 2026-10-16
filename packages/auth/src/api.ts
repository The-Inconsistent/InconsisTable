export type { PlatformRole } from "./role.ts";
export { PLATFORM_ROLES } from "./role.ts";

// Identity without accounts: each device is an anonymous user, named by a random secret in the `it_device` cookie. The
// web proxy mints it, the api trusts a well-formed one and creates the user on first sight (auth.service.ts).
// ponytail: a lost cookie is a lost identity, swap in a provider's session here
export const DEVICE_COOKIE = "it_device";

export type AuthUser = { userId: string; name: string; creator: boolean };

// 24 random bytes as base64url: 32 characters. Web Crypto only, so the Next proxy can call it too.
export function deviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// What the api accepts as a device secret: base64url, 32 to 200 characters.
export const isDeviceSecret = (s: string | undefined): s is string => !!s && /^[A-Za-z0-9_-]{32,200}$/.test(s);
