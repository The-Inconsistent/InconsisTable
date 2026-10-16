// Platform roles, defined once (backend-code-style, "Closed value sets"). No provider yet: every device user is a
// creator (the column default), and `user` only exists for rows someone sets by hand.
export const PLATFORM_ROLES = ["user", "creator"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
