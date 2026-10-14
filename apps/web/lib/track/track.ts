import type { Combatant } from "@inconsistable/core-schema";

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

/** A combatant's state as a word (never colour alone): ACTING, or what the character's health status says. */
export function stateWord({ current, healthState }: { current: boolean; healthState: unknown }): string {
  if (healthState === "dead") return "DEAD";
  if (healthState === "dying") return "DOWN";
  if (healthState === "stable") return "STABLE";
  return current ? "ACTING" : "";
}

/** "2 rounds", "1 turn", or "" for a condition that doesn't count. */
export function leftText({ left, expiresOn }: { left: number | null; expiresOn: string }): string {
  if (left === null) return "";
  const unit = expiresOn === "ownTurnEnd" ? "turn" : "round";
  return `${left} ${unit}${left === 1 ? "" : "s"}`;
}

/** A health bar's width as a percentage for the CSS; empty when the actor has no health to show. */
export const barPercent = (c: Pick<Combatant, "bar">) => (c.bar === null ? null : Math.round(c.bar * 100));

/** Whose turn it is among the combatants, if any. */
export const currentOf = ({ combatants, currentId }: { combatants: readonly Combatant[]; currentId: string | null }) =>
  combatants.find((c) => c.id === currentId);
