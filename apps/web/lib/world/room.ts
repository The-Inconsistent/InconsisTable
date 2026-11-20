import type { RulesReply } from "@/lib/library/library";

import { worldLook, worldStyle, type WorldAttributes } from "./world";

/** The room's World as the seat-scoped rules route serves it: null without one, or while it is not served. */
export type RoomWorld = RulesReply["world"];

/** What a room page's wrapper wears: the World's data attributes and its <style> text, or null with no World served. */
export function roomLook(world: RoomWorld): { attributes: WorldAttributes; style: string } | null {
  if (!world) return null;
  const look = worldLook(world.theme);
  return { attributes: look.attributes, style: worldStyle(look) };
}

/**
 * Whether a room page should read its server data again: the room's pinned World (`live`, from the socket state;
 * undefined before the first snapshot) is not the one the page was rendered with. `refreshed` is the value it last
 * refreshed for, so a pin the server does not serve (the page renders null for it) is asked for once, not in a loop.
 */
export function needsRefresh({
  rendered,
  live,
  refreshed,
}: {
  rendered: string | null;
  live: string | null | undefined;
  refreshed: string | null | undefined;
}): boolean {
  return live !== undefined && live !== rendered && live !== refreshed;
}
