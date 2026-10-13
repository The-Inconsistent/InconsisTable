import type { Ruleset } from "@inconsistable/rules-engine";

// Which entity types of a ruleset are creatures to place at a table: actor-based types that creation does not build for
// a player (a character is built, a monster is spawned from a pack entry).
export function creatureTypes(ruleset: Ruleset): string[] {
  const built = new Set(ruleset.creation.map((s) => s.actor));
  return ruleset.entities.filter((e) => e.base === "actor" && !built.has(e.id)).map((e) => e.id);
}

export const MIN_SPAWN = 1;
export const MAX_SPAWN = 20; // the api's limit (actor.spawn)

/** The count stepper stays inside the api's range. */
export const clampCount = (n: number) => Math.min(MAX_SPAWN, Math.max(MIN_SPAWN, n));
