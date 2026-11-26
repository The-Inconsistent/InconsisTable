import type { Encounter } from "@inconsistable/core-schema";
import { usedKey, type RuleState, type SidesInitiative } from "@inconsistable/rules-engine";

import { markOf } from "@/lib/sides/sides";

// The phone's Fight tab (house decision #117), read from what this seat was sent. The server decides every rule.

/** Who holds the turn when the seat is not sent them: an actor outside the order, so another side's (#116). */
export const UNSEEN_ACTOR = "";

/**
 * The fight as the engine reads it for a spend or a panel (house decisions #84, #91, #116), from this seat's encounter:
 * whose turn, the order, the sides, who holds, who is barred and the round's uses. A turn someone unseen holds is
 * `UNSEEN_ACTOR`'s.
 */
export function turnOf(e: Encounter | null): RuleState["turn"] {
  if (e === null) return null;
  const current = e.combatants.find((c) => c.id === e.currentId);
  return {
    round: e.round,
    currentId: current?.actorId ?? (e.unseen === true ? UNSEEN_ACTOR : null),
    order: e.combatants.map((c) => c.actorId),
    sideOf: Object.fromEntries(e.combatants.map((c) => [c.actorId, c.side])),
    held: e.combatants.filter((c) => c.held === true).map((c) => c.actorId),
    barred: e.combatants.filter((c) => c.barred === true).map((c) => c.actorId),
    // House decision #91: the round's uses, as the server counts them.
    used: e.combatants.flatMap((c) =>
      (c.used ?? []).map((spendId) => usedKey({ round: e.round, actorId: c.actorId, spendId })),
    ),
  };
}

/** The combatant one of the seat's characters is, acting now; null when none of them acts. */
export const actingMine = ({ encounter, held }: { encounter: Encounter; held: readonly string[] }) =>
  encounter.combatants.find((c) => c.id === encounter.currentId && held.includes(c.actorId)) ?? null;

/**
 * On the seat's turn, how many of the others it is sent still act this round after it, of how many others: in a sides
 * order the ones ready or holding an action, in a ranked or seated one the ones after it in the order. Null off its turn.
 */
export function afterYou({
  encounter,
  held,
  sides,
}: {
  encounter: Encounter;
  held: readonly string[];
  sides?: SidesInitiative;
}): { after: number; of: number } | null {
  const mine = actingMine({ encounter, held });
  if (mine === null) return null;
  const others = encounter.combatants.filter((c) => c.id !== mine.id);
  const after =
    encounter.begun !== undefined
      ? others.filter((c) => {
          const mark = markOf({ encounter, combatant: c, sides });
          return mark === "ready" || mark === "holding";
        }).length
      : others.filter((c) => c.ord > mine.ord).length;
  return { after, of: others.length };
}

/** In a ranked or seated order, who acts after whoever acts now; null at the round's end or in a sides order. */
export function nextUp(encounter: Encounter): string | null {
  if (encounter.begun !== undefined) return null;
  const at = encounter.combatants.findIndex((c) => c.id === encounter.currentId);
  return at < 0 ? null : (encounter.combatants[at + 1]?.name ?? null);
}
