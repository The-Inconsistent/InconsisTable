// The admin console's tabs (house decision #94): the rooms ledger and the users.
export const ADMIN_TABS = ["rooms", "users"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
