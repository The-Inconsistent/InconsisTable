// The two ways a group Ascends: everyone has earned the XP, or at the GM's word at a turn in the story (as in Auspex).
// ponytail: a UI-only set until the server's Ascension action lands, upgrade: take its enum from core-schema then.
export const ASCEND_KINDS = ["experience", "milestone"] as const;
export type AscendKind = (typeof ASCEND_KINDS)[number];
