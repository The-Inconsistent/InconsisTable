import { WORLD_SCHEMES, worldColours, type WorldScheme } from "@inconsistable/rules-engine";

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
 * The browser's own colour (its toolbar, the task switcher) in a room wearing a World: the World's band, per set it
 * brings, as Auspex's is its iron band (house decision #208). The set the device picked (`picked`, from the scheme
 * cookie) wins when the World brings it, as the page's own colours do; with no pick, one colour per system setting.
 * Null with no World, so the base Theme's band stands.
 */
export function roomBand({
  world,
  picked,
}: {
  world: RoomWorld;
  picked?: WorldScheme;
}): string | { media: string; color: string }[] | null {
  if (!world) return null;
  const sets = WORLD_SCHEMES.flatMap((scheme) => {
    const colours = world.theme.schemes[scheme];
    return colours ? [{ scheme, band: worldColours({ scheme, colours }).band }] : [];
  });
  const chosen = sets.find((s) => s.scheme === picked);
  if (chosen) return chosen.band;
  if (sets.length === 1) return sets[0]!.band;
  return sets.map((s) => ({ media: `(prefers-color-scheme: ${s.scheme})`, color: s.band }));
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
