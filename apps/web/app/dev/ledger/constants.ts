// The Play part's switches: what the group's Ascension shows, and how the XP box's character stands.
export const ASCENSION_CASES = ["short", "ready", "top", "refusal"] as const;
export type AscensionCase = (typeof ASCENSION_CASES)[number];
export const XP_CASES = ["toSpend", "spentAll", "notBuilt"] as const;
export type XpCase = (typeof XP_CASES)[number];

// Invented figures and names (no game's): Tiers 1 to 4, 50 XP to Ascend, a Rank every 20 XP up to 5.
export const SAMPLE_PLAY = {
  tier: 2,
  topTier: 4,
  needed: 50,
  xpPerRank: 20,
  topRank: 5,
  award: { max: 30, suggested: [4, 6, 8], value: 6 },
  earned: 64,
  spent: 40,
  // in the "short" case this member has earned only so much this Tier
  short: { id: "oskar", earnedThisTier: 38 },
} as const;
export const SAMPLE_MEMBERS = [
  { id: "wren", name: "Wren Halloway", earned: 116, earnedThisTier: 66, gone: false },
  { id: "oskar", name: "Oskar Dunmere", earned: 102, earnedThisTier: 52, gone: false },
  { id: "pell", name: "Pell", earned: 120, earnedThisTier: 70, gone: false },
  { id: "juno", name: "Juno Vask", earned: 81, earnedThisTier: 31, gone: true },
] as const;
