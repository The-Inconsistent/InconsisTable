/** The character drawer's tabs, in order (house decision #222). */
export const DRAWER_TABS = ["status", "gear", "advance", "seat"] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number];
