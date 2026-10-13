import type { ActionInput, CombatSide, CombatVisibility } from "@inconsistable/core-schema";

// Sends one action and says whether it went through; the tracker shows the refusal itself.
export type Run = (a: ActionInput) => Promise<boolean>;

// The keypad's keys in the order they are laid out; "clear" and "back" are the two non-digit keys.
export const KEYPAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "clear", "0", "back"] as const;
export const KEY_LABELS: Readonly<Record<string, string>> = { clear: "C", back: "⌫" };
export const KEY_NAMES: Readonly<Record<string, string>> = { clear: "Clear", back: "Delete last digit" };

export const SIDE_LABELS: Record<CombatSide, string> = { party: "Party", foe: "Foe", other: "Other" };

// What the table sees of a combatant (docs/p1-plan.md, F).
export const VISIBILITY_LABELS: Record<CombatVisibility, string> = {
  hidden: "Hidden",
  bar: "Bar",
  full: "Numbers",
};

// The death save results the ruleset's `health.tracks` takes, in the words a GM says at the table.
export const DEATH_SAVE_LABELS = {
  criticalSuccess: "Critical success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical failure",
} as const;
export type DeathSaveKey = keyof typeof DEATH_SAVE_LABELS;

// The side and visibility a character of each kind joins a fight with.
export const JOIN_AS = {
  party: { side: "party", visibility: "full" },
  creature: { side: "foe", visibility: "hidden" },
  other: { side: "other", visibility: "bar" },
} as const satisfies Record<string, { side: CombatSide; visibility: CombatVisibility }>;
