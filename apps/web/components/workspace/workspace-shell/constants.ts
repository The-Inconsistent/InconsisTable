// The rail's pages, in order. `count` names the lobby number shown beside the link, when there is one.
export const RAIL_LINKS = [
  { key: "rooms", href: "/", count: "rooms" },
  { key: "characters", href: "/characters", count: "characters" },
  { key: "library", href: "/library", count: null },
] as const;
export type RailCount = NonNullable<(typeof RAIL_LINKS)[number]["count"]>;
