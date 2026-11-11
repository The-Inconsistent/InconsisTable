import { z } from "zod";

import { PLATFORM_ROLES, SIGN_IN_PROVIDERS } from "@inconsistable/auth/api";

// The api's replies that carry a seat's table (create room, accept invite, guest join, /api/guest). The id goes into a
// URL path, so only id characters pass.
export const CampaignRef = z.object({ campaignId: z.string().regex(/^[A-Za-z0-9-]+$/) });

// /api/auth/me: whether this deployment signs in, the caller's name (null before the device has an identity) and the
// signed-in account's roles (null for an anonymous device user).
export const AuthMe = z.object({
  signInEnabled: z.boolean(),
  name: z.string().nullable(),
  account: z.object({ roles: z.array(z.enum(PLATFORM_ROLES)) }).nullable(),
});
export type AuthMe = z.infer<typeof AuthMe>;

// /api/account: the signed-in account at InconsisID (accountView in apps/api-go/internal/auth/account.go). `manageUrl`
// opens InconsisID's own account pages, which come back to /account; only http(s) passes, since it becomes a link.
export const AccountView = z.object({
  displayName: z.string(),
  roles: z.array(z.enum(PLATFORM_ROLES)),
  createdAt: z.iso.datetime(),
  signInMethods: z.object({
    passkeys: z.array(
      z.object({ name: z.string(), createdAt: z.iso.datetime(), lastUsedAt: z.iso.datetime().nullable() }),
    ),
    password: z.object({ username: z.string() }).nullable(),
    providers: z.array(z.enum(SIGN_IN_PROVIDERS)),
  }),
  recoveryCodesLeft: z.number().int().nonnegative(),
  manageUrl: z.url({ protocol: /^https?$/ }),
});
export type AccountView = z.infer<typeof AccountView>;

// The api's refusal body (code, English message, params); any other shape falls back to the caller's own text.
export const ApiMessage = z.object({
  message: z.string(),
  code: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

// A fetch body as untrusted JSON, or null when it isn't JSON.
export async function readJson(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json();
    return body;
  } catch {
    return null;
  }
}
