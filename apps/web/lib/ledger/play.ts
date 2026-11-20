// The ledger in play (docs/adr/0011, last stage): XP to spend, Rank from XP earned, the group's Ascension and the XP a
// session awards. Pure: the play components show what these answer, and the numbers come from the caller.

// XP earned and not yet spent; never below zero.
export const toSpend = ({ earned, spent }: { earned: number; spent: number }) => Math.max(0, earned - spent);

// Rank from the XP earned: one, plus one per `xpPerRank`, no higher than `top`.
export const rankOf = ({ earned, xpPerRank, top }: { earned: number; xpPerRank: number; top: number }) =>
  Math.min(top, 1 + Math.floor(Math.max(0, earned) / xpPerRank));

export type AscensionMember = { id: string; name: string; rank: number; earnedThisTier: number; gone: boolean };
export type AscensionRow = AscensionMember & { ready: boolean; short: number };

// The group's Ascension, as Auspex's party panel weighs it: each member still in the story is ready once it earned the
// XP this Tier needs, or so many short; a gone member is listed apart and not counted. By experience only when someone
// counts and all of them are ready; by milestone at the GM's word. Neither at the top Tier.
export function ascensionRows({
  tier,
  topTier,
  needed,
  members,
}: {
  tier: number;
  topTier: number;
  needed: number;
  members: readonly AscensionMember[];
}) {
  const counted: AscensionRow[] = members
    .filter((m) => !m.gone)
    .map((m) => ({ ...m, ready: m.earnedThisTier >= needed, short: Math.max(0, needed - m.earnedThisTier) }));
  const gone = members.filter((m) => m.gone);
  const atTop = tier >= topTier;
  const ready = counted.filter((m) => m.ready).length;
  return {
    counted,
    gone,
    ready,
    atTop,
    experience: !atTop && counted.length > 0 && ready === counted.length,
    milestone: !atTop,
  };
}

// The session's XP award as typed: a whole number from 0 to `max`, else null (not passed on).
export function awardOf({ text, max }: { text: string; max: number }): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= max ? n : null;
}
