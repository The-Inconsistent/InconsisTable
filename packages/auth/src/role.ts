// Platform roles, defined once (backend-code-style, "Closed value sets"). A device user is a `creator` (the column
// default). A signed-in user's roles come from the identity provider's ID token (`admin`, `creator`); `admin` grants
// nothing yet, it only shows on the session. `user` is a signed-in user without `creator`.
export const PLATFORM_ROLES = ["user", "creator", "admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// The providers an account can link at the identity provider (its account API, contract C16), defined once.
export const SIGN_IN_PROVIDERS = ["google", "discord", "github"] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];
