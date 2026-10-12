// Platform roles, defined once (backend-code-style, "Closed value sets"). They live in Clerk and are only ever changed
// in the Clerk Dashboard (docs/design.md §3.6); the app reads them from the verified session token.
export const PLATFORM_ROLES = ["user", "creator", "moderator", "admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// What the Dashboard stores as public metadata `role`: a plain user has none.
export type ClerkRole = Exclude<PlatformRole, "user">;
