import type { Encounter } from "@inconsistable/core-schema";

/** The one line the phone's header band shows (house decision #112). `round` is a ruleset that marks it for the header. */
export type PhoneStatus =
  { line: "noFight" } | { line: "yourTurn" } | { line: "done" } | { line: "round"; round: number };

/**
 * From the encounter the seat is sent: no fight; your turn (a held character acts, the fight not paused); done (every
 * held character in the order has ended its turn this round, as the order's own mark reads `encounter.done`); else the
 * round, only where the ruleset declares `header.round`. Null: a fight runs and there is nothing to say.
 */
export function phoneStatusOf({
  encounter,
  held,
  showRound,
}: {
  encounter: Encounter | null;
  held: readonly string[];
  showRound: boolean;
}): PhoneStatus | null {
  if (!encounter) return { line: "noFight" };
  const mine = encounter.combatants.filter((c) => held.includes(c.actorId));
  if (!encounter.paused && mine.some((c) => c.id === encounter.currentId)) return { line: "yourTurn" };
  if (mine.length > 0 && mine.every((c) => encounter.done.includes(c.id))) return { line: "done" };
  return showRound ? { line: "round", round: encounter.round } : null;
}
