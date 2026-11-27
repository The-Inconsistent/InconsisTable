import type { Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { markOf } from "../sides/sides.ts";

/** Who acts now, as the phone's Fight tab plates it: a combatant the seat is sent, one it is not, or nobody. */
export type ActingPlate = { kind: "combatant"; name: string; mine: boolean } | { kind: "unseen" } | null;

/**
 * The fixed part of the phone's Fight tab (house decision #114), from the encounter the seat is sent:
 * - `acting`: the plate; a hidden combatant holding the turn is said, never named (house decision #68).
 * - `mine`: the combatant ids of the seat's own characters, marked YOU.
 * - `after`: "N of M to act after you", counting only the other combatants the seat is sent. A ranked or seated order
 *   counts those placed after the seat's first combatant; a sides order (its snapshot carries `begun`) counts those
 *   still to act this round (ready or holding). Null when the seat has nobody in the fight.
 */
export function fightTabOf({
  encounter,
  held,
  sides,
}: {
  encounter: Encounter;
  held: readonly string[];
  sides?: SidesInitiative;
}): { acting: ActingPlate; mine: Set<string>; after: { count: number; of: number } | null } {
  const order = [...encounter.combatants].sort((a, b) => a.ord - b.ord);
  const mine = new Set(order.filter((c) => held.includes(c.actorId)).map((c) => c.id));
  const current = order.find((c) => c.id === encounter.currentId);
  const acting: ActingPlate = current
    ? { kind: "combatant", name: current.name, mine: mine.has(current.id) }
    : encounter.unseen
      ? { kind: "unseen" }
      : null;
  const first = order.findIndex((c) => mine.has(c.id));
  if (first < 0) return { acting, mine, after: null };
  const others = order.filter((c) => !mine.has(c.id));
  const count =
    encounter.begun !== undefined
      ? others.filter((c) => ["ready", "holding"].includes(markOf({ encounter, combatant: c, sides }))).length
      : order.slice(first + 1).filter((c) => !mine.has(c.id)).length;
  return { acting, mine, after: { count, of: others.length } };
}
