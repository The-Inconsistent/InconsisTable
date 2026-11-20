import { describeFilter, norm } from "./labels.ts";
import { vocabOf, type BuildParams } from "./params.ts";
import type { Requirement, Wargear, WargearFilter } from "./schemas.ts";
import type { GearItem, Who } from "./types.ts";

export type BuildCtx = {
  params: BuildParams;
  attributes: Record<string, number>;
  skills: Partial<Record<string, number>>;
  keywords: Set<string>;
  species: string[]; // the species and what it counts as
  archetypeId: string | null; // null: Advanced Creation, no Archetype
  subFactionIds: Set<string>; // the sub-faction and its founders (successorOf)
  talents: Set<string>;
  talentCategories: string[];
  powers: { id: string; disciplineId: string }[];
  gear: GearItem[];
  wargear: ReadonlyMap<string, Wargear>;
  options: { groupId: string; name: string }[];
  influence: number;
  rank: number;
  tier: number;
  chosen?: string; // a bracketed Talent's pick, for chosenAttribute / chosenSkill
};

// true when met; otherwise why not, or { gm } for a condition only the GM can judge.
export function meets(r: Requirement, c: BuildCtx): true | string | { gm: string } {
  const vocab = vocabOf(c.params);
  switch (r.kind) {
    case "attribute":
      return c.attributes[r.attribute]! >= r.min || `needs ${vocab.attributeNames[r.attribute]} ${r.min}`;
    case "skill":
      return (c.skills[r.skill] ?? 0) >= r.min || `needs ${r.skill} ${r.min}`;
    case "chosenAttribute": {
      const a = vocab.attributes.find((x) => x === c.chosen || vocab.attributeNames[x] === c.chosen);
      return (a !== undefined && c.attributes[a]! >= r.min) || `needs the chosen Attribute at ${r.min}`;
    }
    case "chosenSkill": {
      const k = vocab.skills.find((x) => x === c.chosen);
      return (k !== undefined && (c.skills[k] ?? 0) >= r.min) || `needs the chosen Skill at ${r.min}`;
    }
    case "influence":
      return c.influence >= r.min || `needs Influence ${r.min}`;
    case "keyword":
      return r.anyOf.some((k) => c.keywords.has(k)) || `needs ${r.anyOf.join(" or ")}`;
    case "notKeyword":
      return !r.anyOf.some((k) => c.keywords.has(k)) || `not for ${r.anyOf.join(" or ")}`;
    case "species":
      return r.anyOf.some((x) => c.species.includes(x)) || `needs species ${r.anyOf.join(" or ")}`;
    case "notSpecies":
      return !r.anyOf.some((x) => c.species.includes(x)) || `not for species ${r.anyOf.join(" or ")}`;
    case "archetype":
      return (c.archetypeId !== null && r.anyOf.includes(c.archetypeId)) || `needs archetype ${r.anyOf.join(" or ")}`;
    case "notArchetype":
      return c.archetypeId === null || !r.anyOf.includes(c.archetypeId) || `not for archetype ${r.anyOf.join(" or ")}`;
    case "memorableInjuries":
      // No Memorable Injury is taken at creation yet (optional): the builder counts none.
      return r.min === undefined || r.min <= 0 || `needs ${r.min} Memorable Injur${r.min === 1 ? "y" : "ies"}`;
    case "subFaction":
      return r.anyOf.some((x) => c.subFactionIds.has(x)) || `needs ${r.anyOf.join(" or ")}`;
    case "talent":
      return r.anyOf.some((x) => c.talents.has(x)) || `needs talent ${r.anyOf.join(" or ")}`;
    case "notTalent":
      return !r.anyOf.some((x) => c.talents.has(x)) || `can't be taken with ${r.anyOf.join(" or ")}`;
    case "talentCategory":
      return (
        c.talentCategories.filter((x) => x === r.category).length >= r.min ||
        `needs ${r.min} ${r.category} talent${r.min > 1 ? "s" : ""}`
      );
    case "option":
      return (
        c.options.some((o) => o.groupId === r.groupId && r.anyOf.includes(o.name)) || `needs ${r.anyOf.join(" or ")}`
      );
    case "power":
      return r.anyOf.some((x) => c.powers.some((p) => p.id === x)) || `needs power ${r.anyOf.join(" or ")}`;
    case "powerCount": {
      const per = new Map<string, number>();
      for (const p of c.powers) per.set(p.disciplineId, (per.get(p.disciplineId) ?? 0) + 1);
      const n = r.sameDiscipline ? Math.max(0, ...per.values()) : c.powers.length;
      return n >= r.min || `needs ${r.min} psychic powers${r.sameDiscipline ? " from one Discipline" : ""}`;
    }
    case "wargear":
      return r.anyOf.some((n) => c.gear.some((g) => norm(g.name) === norm(n))) || `needs ${r.anyOf.join(" or ")}`;
    case "wargearKeyword":
      return (
        c.gear.some((g) =>
          (g.wargearId ? (c.wargear.get(g.wargearId)?.keywords ?? []) : []).some((k) => r.anyOf.includes(k)),
        ) || `needs wargear with ${r.anyOf.join(" or ")}`
      );
    case "wargearCount": {
      const n = c.gear.filter((g) => {
        const w = g.wargearId ? c.wargear.get(g.wargearId) : undefined;
        return w && wargearMatches(w, r.of, { tier: c.tier, newTier: c.tier }, c.params);
      }).length;
      return n >= r.min || `needs ${r.min} of ${describeFilter(r.of)}`;
    }
    case "rank":
      return c.rank >= r.min || `needs Rank ${r.min}${r.min > 1 ? ", not at creation" : ""}`;
    case "tier":
      return (
        ((r.min === undefined || c.tier >= r.min) && (r.max === undefined || c.tier <= r.max)) ||
        `needs Tier ${r.min ?? c.params.tiers.min}–${r.max ?? c.params.tiers.max}`
      );
    case "gm":
      return { gm: r.label };
    case "all": {
      for (const x of r.of) {
        const why = meets(x, c);
        if (why !== true) return why;
      }
      return true;
    }
    case "either": {
      const whys = r.of.map((x) => meets(x, c));
      if (whys.some((w) => w === true)) return true;
      const gm = whys.find((w): w is { gm: string } => typeof w === "object");
      return gm ?? whys.filter((w) => typeof w === "string").join(", or ");
    }
  }
}

// Keywords a Talent or Package this character can take would give, however deep in its choices. A record or choice
// whose own requirements are out of reach gives nothing, and one keyword can open the next record, so this runs until
// nothing new turns up. A placeholder names no keyword yet, so it opens nothing.
export function buyableKeywords(
  records: readonly { requires?: Requirement[]; grants?: unknown }[],
  self: Omit<Who, "buyable">,
  params: BuildParams,
): string[] {
  const found = new Set<string>();
  const add = (k: unknown) => typeof k === "string" && !k.startsWith(params.keywords.placeholderMarker) && found.add(k);
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    // Catalogue data, parsed at load: a `requires` anywhere in it is a Requirement list.
    const reqs = (x as { requires?: Requirement[] }).requires;
    if (reqs && outOfReach(reqs, { ...self, buyable: [...found] })) return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "keyword") add(v);
      else if (k === "keywords" && Array.isArray(v)) v.forEach(add);
      else if (k !== "requires") walk(v);
    }
  };
  for (let size = -1; size !== found.size;) {
    size = found.size;
    walk(records.map((r) => ({ requires: r.requires, grants: r.grants })));
  }
  return [...found];
}

// True when a requirement no purchase can meet fails: the species, the archetype, a keyword nothing buyable gives. The
// builder hides such a record from its lists; anything a purchase can still meet (a rating, another Talent) stays, and
// `resolveBuild` flags it. Before a species is picked, species requirements hide nothing.
export function outOfReach(reqs: readonly Requirement[] | undefined, who: Who): boolean {
  const keywords = new Set(who.keywords);
  const buyable = new Set(who.buyable);
  const { species } = who;
  const out = (r: Requirement): boolean => {
    switch (r.kind) {
      case "species":
        return !!species && !r.anyOf.some((x) => species.includes(x));
      case "notSpecies":
        return !!species && r.anyOf.some((x) => species.includes(x));
      case "archetype":
        return who.archetypeId === null || !r.anyOf.includes(who.archetypeId);
      case "notArchetype":
        return who.archetypeId !== null && r.anyOf.includes(who.archetypeId);
      case "keyword":
        return !r.anyOf.some((k) => keywords.has(k) || buyable.has(k));
      case "notKeyword":
        return r.anyOf.some((k) => keywords.has(k));
      case "all":
        return r.of.some(out);
      case "either":
        return r.of.every(out);
      default:
        return false;
    }
  };
  return (reqs ?? []).some(out);
}

export function wargearMatches(
  w: Wargear,
  f: WargearFilter,
  { tier, newTier }: { tier: number; newTier: number },
  params: BuildParams,
) {
  const rarities = params.rarity.order;
  if (f.kinds && !f.kinds.includes(w.kind)) return false;
  if (f.weapon) {
    if (!w.weapon) return false;
    const melee = w.weapon.range?.length === 1 && w.weapon.thrown === undefined; // melee weapons print one reach
    if ((f.weapon === "melee") !== melee) return false;
  }
  if (f.categories && !f.categories.includes(w.category)) return false;
  if (f.nameIncludes && !norm(w.name).includes(norm(f.nameIncludes))) return false;
  if (f.wargearKeywords && !w.keywords.some((k) => f.wargearKeywords!.includes(k))) return false;
  if (f.allKeywords && !f.allKeywords.every((k) => w.keywords.includes(k))) return false;
  if (f.weaponTraits || f.notWeaponTraits) {
    // Traits are printed with their rating ("Heavy (3)"); the filter names the Trait alone, or the whole printed Trait
    // when the bracket is the point.
    const printed = [...(w.weapon?.traits ?? []), ...(w.armour?.traits ?? [])];
    const has = (t: string) =>
      t.includes("(")
        ? printed.some((p) => norm(p) === norm(t))
        : printed.some((p) => norm(p.split("(")[0]!) === norm(t));
    if (f.weaponTraits && !f.weaponTraits.some(has)) return false;
    if (f.notWeaponTraits?.some(has)) return false;
  }
  if (f.maxValue !== undefined) {
    const max =
      typeof f.maxValue === "number"
        ? f.maxValue
        : "tierPlus" in f.maxValue
          ? tier + f.maxValue.tierPlus
          : newTier + f.maxValue.newTierPlus;
    if (w.value === null || w.value > max) return false;
  }
  if (f.rarity) {
    if (!w.rarity) return false;
    const r = rarities.indexOf(w.rarity);
    if (f.rarity.atMost && r > rarities.indexOf(f.rarity.atMost)) return false;
    if (f.rarity.atLeast && r < rarities.indexOf(f.rarity.atLeast)) return false;
  }
  return true;
}
