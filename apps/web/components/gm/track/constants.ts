import type { ActionInput, CombatSide, CombatVisibility } from "@inconsistable/core-schema";

// Sends one action and says whether it went through; the tracker shows the refusal itself.
export type Run = (a: ActionInput) => Promise<boolean>;

// How the tracker words itself: a board game (a seated order or phases) is a game, anything else a fight.
export type TrackMode = "game" | "fight";

// The keypad's keys in the order they are laid out; "clear" and "back" are the two non-digit keys. A digit is its own
// label and name; the other two are worded by the `track.keys` messages.
export const KEYPAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "clear", "0", "back"] as const;
export const KEY_LABELS: Readonly<Record<string, string>> = { clear: "C", back: "⌫" };

// The death save results the ruleset's `health.tracks` takes, in the order a GM reaches for them (`track.deathSave`).
export const DEATH_SAVE_KEYS = ["criticalSuccess", "success", "failure", "criticalFailure"] as const;
export type DeathSaveKey = (typeof DEATH_SAVE_KEYS)[number];

// The clock form: the quick picks for a clock's segments, the bounds of a custom count (core-schema's ClockSegments), and
// what a new clock starts as.
export const CLOCK_SEGMENT_PICKS = [4, 6, 8] as const;
export const CLOCK_SEGMENTS_MIN = 2;
export const CLOCK_SEGMENTS_MAX = 12;
export const CLOCK_DEFAULTS = { name: "", segments: 4, visibility: "gm", entryId: null } as const;

// The side and visibility a character of each kind joins a fight with.
export const JOIN_AS = {
  party: { side: "party", visibility: "full" },
  creature: { side: "foe", visibility: "hidden" },
  other: { side: "other", visibility: "bar" },
} as const satisfies Record<string, { side: CombatSide; visibility: CombatVisibility }>;
