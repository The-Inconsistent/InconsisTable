import type { AdvantageMode } from "@inconsistable/rules-engine";

// How a roll is taken, as the table says it.
export const ADVANTAGE_LABEL: Record<AdvantageMode, string> = {
  none: "Normal",
  advantage: "Advantage",
  disadvantage: "Disadvantage",
};

// The pad's digit keys in reading order; Delete, 0 and Report make the last row.
export const PAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
