import type { CharacterStats, Creation, Wargear, WargearFilter, WargearItem } from "./schemas.ts";

// The builder's screens; every pending choice and problem names the one that fixes it.
export const BUILD_STEPS = ["tier", "archetype", "customise", "faction", "ascension", "detail", "advance"] as const;
export type BuildStep = (typeof BUILD_STEPS)[number];

// A purchase made in play, as a stable key for the history (`Advancement.boughtIn`). A rating is one key per rating
// point reached, so buying the same Attribute again later leaves the earlier point's session alone; a Talent's bracket
// pick is part of it; `~n` separates the second and later copies of an otherwise identical purchase.
export type Purchase =
  | { kind: "attribute"; attribute: string; rating: number }
  | { kind: "skill"; skill: string; rating: number }
  | { kind: "talent"; id: string; choice?: string }
  | { kind: "power"; id: string }
  | { kind: "package"; id: string }
  | { kind: "language"; name: string }
  | { kind: "ascension"; archetypeId: string };

export function purchaseKey(p: Purchase): string {
  switch (p.kind) {
    case "attribute":
      return `advance/attribute/${p.attribute}/${p.rating}`;
    case "skill":
      return `advance/skill/${p.skill}/${p.rating}`;
    case "talent":
      return `advance/talent/${p.id}${p.choice ? `:${p.choice}` : ""}`;
    case "power":
      return `advance/power/${p.id}`;
    case "package":
      return `advance/package/${p.id}`;
    case "language":
      return `advance/language/${p.name}`;
    case "ascension":
      return `advance/ascension/${p.archetypeId}`;
  }
}

export type GearItem = WargearItem & { from: string };

// `pool`: "advancement" for XP earned in play; absent for the creation budget. `key` and `session` are the purchase
// history, only ever on an advancement row: `key` is what `Advancement.boughtIn` is keyed by, `session` the session
// number stamped for it, absent until a save stamps one.
export type LedgerRow = {
  what: string;
  xp: number;
  cite?: string;
  step: BuildStep;
  pool?: "advancement";
  key?: string;
  session?: number;
};
// A choice still to make: `choose` of `options` (labels, answered by index) or, when `options` is empty, of the ids
// or names `of` describes.
export type PendingChoice = {
  path: string;
  step: BuildStep;
  what: string;
  choose: number;
  options: string[];
  of?: string;
  cite?: string;
  pick?: ChoicePick; // answered in `choices[path]`; without it, the builder's own field for that step answers it
};
// What a choice in `choices` picks from, so the builder can offer it: option indexes, or ids and names.
export type ChoicePick =
  | { kind: "option" }
  | { kind: "wargear"; filter: WargearFilter }
  | { kind: "skill"; from: string[] }
  | { kind: "attribute"; from: string[] }
  | { kind: "discipline"; from: string[] | null }
  | { kind: "power"; disciplines: string[] }
  | { kind: "keyword" };
// Every choice a grant asks for, answered or not, with the current answer: the builder shows them all.
export type BuildChoicePrompt = PendingChoice & { pick: ChoicePick; answer: (string | number)[] };
// "error" blocks saving; "gm" needs the GM's tick (its path in `gm.approved`) before it does.
export type BuildProblem = { step: BuildStep; what: string; cite?: string; severity: "error" | "gm"; path?: string };
// What the build gives that a sheet has no field for: followers, rolled Corruption, bonus dice in a situation...
export type BuildEffect = { what: string; cite?: string };

// Who the finished character is, for `outOfReach`: species (with what it counts as, null before one is picked),
// archetype, keywords, and the keywords a Talent or Package could still add.
export type Who = { species: string[] | null; archetypeId: string | null; keywords: string[]; buyable: string[] };

export type ResolvedBuild = {
  sheet: CharacterStats;
  budget: number;
  spent: number;
  ledger: LedgerRow[];
  pending: PendingChoice[];
  choices: BuildChoicePrompt[];
  problems: BuildProblem[];
  effects: BuildEffect[];
  // In play: the XP earned (the advancement budget), what advancement spends of it, Rank, the Tier now.
  advancement: { budget: number; spent: number; rank: number; tier: number } | null;
  who: Who;
};

// Ready to save: nothing left to choose, nothing wrong, and every GM question ticked.
export const buildReady = (r: ResolvedBuild) => r.pending.length === 0 && r.problems.length === 0;

export type BuildCatalogue = { creation: Creation; wargear: ReadonlyMap<string, Wargear>; homebrew: boolean };
