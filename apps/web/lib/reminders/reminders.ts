import type { Encounter } from "@inconsistable/core-schema";

/**
 * The labels of the acting combatant's conditions that end with this turn (house decision #81): an own-turn condition
 * with one turn left. Read from what the combat side already receives; nothing is changed. Empty between turns.
 */
export function endingThisTurn(encounter: Encounter): string[] {
  const acting = encounter.combatants.find((c) => c.id === encounter.currentId);
  if (acting === undefined) return [];
  const labelOf = new Map(encounter.conditionDefs.map((d) => [d.id, d.label]));
  return acting.conditions
    .filter((c) => c.expiresOn === "ownTurnEnd" && c.left === 1)
    .map((c) => labelOf.get(c.id) ?? c.id);
}
