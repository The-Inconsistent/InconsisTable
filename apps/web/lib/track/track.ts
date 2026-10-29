import type { Combatant, Encounter } from "@inconsistable/core-schema";

export const MAX_KEYS = 4; // 9999 is more than any one hit

/** The keypad's entry after one key: a digit, "back" or "clear". No leading zeros, at most MAX_KEYS digits. */
export function pressKey({ entry, key }: { entry: string; key: string }): string {
  if (key === "clear") return "";
  if (key === "back") return entry.slice(0, -1);
  if (!/^\d$/.test(key) || entry.length >= MAX_KEYS) return entry;
  return entry === "0" ? key : entry + key;
}

/** The whole number the keypad shows; 0 when nothing is typed. */
export const amountOf = (entry: string) => (entry === "" ? 0 : Number(entry));

/**
 * A combatant's state (never colour alone): `acting`, or what the character's health status says. The key is also the
 * Theme's hook (`data-state`) and the `combatState` message that words it.
 */
export function stateKey({
  current,
  healthState,
}: {
  current: boolean;
  healthState: unknown;
}): "acting" | "dead" | "down" | "stable" | null {
  if (healthState === "dead") return "dead";
  if (healthState === "dying") return "down";
  if (healthState === "stable") return "stable";
  return current ? "acting" : null;
}

/** What is left of a condition's count ("2 rounds", "1 turn") as a count and a unit, or null for one that doesn't count. */
export function leftOf({
  left,
  expiresOn,
}: {
  left: number | null;
  expiresOn: string;
}): { count: number; unit: "turn" | "round" } | null {
  if (left === null) return null;
  return { count: left, unit: expiresOn === "ownTurnEnd" ? "turn" : "round" };
}

/** A health bar's width as a percentage for the CSS; empty when the actor has no health to show. */
export const barPercent = (c: Pick<Combatant, "bar">) => (c.bar === null ? null : Math.round(c.bar * 100));

/** Whose turn it is among the combatants, if any. */
export const currentOf = ({ combatants, currentId }: { combatants: readonly Combatant[]; currentId: string | null }) =>
  combatants.find((c) => c.id === currentId);

/** The phase the round is in, or undefined when the ruleset has none. */
export const phaseOf = (encounter: Encounter) => encounter.phases.find((p) => p.id === encounter.phaseId);
