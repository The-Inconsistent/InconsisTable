import type { BackgroundTable, Grant, Requirement, SubFaction, WargearFilter } from "./schemas.ts";

// Labels for what a choice or an effect line shows, and small lookups on the records.

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function amount(a: unknown): string {
  if (typeof a === "number" || typeof a === "string") return String(a);
  if (a && typeof a === "object") {
    if ("perTier" in a) return `${String(a.perTier)} per Tier Ascended`;
    if ("timesTier" in a) return `${String(a.timesTier)} × Tier`;
    if ("perRank" in a) return `${String(a.perRank)} × Rank${"plus" in a && a.plus ? ` + ${String(a.plus)}` : ""}`;
    if ("rankPlus" in a) return `Rank + ${String(a.rankPlus)}`;
    if ("roll" in a && "times" in a) return `${String(a.roll)} × ${amount(a.times)}`;
  }
  return "?";
}

export function describeFilter(f: WargearFilter): string {
  const bits = [
    f.rarity &&
      (f.rarity.atMost === f.rarity.atLeast
        ? f.rarity.atMost
        : [f.rarity.atLeast && `${f.rarity.atLeast}+`, f.rarity.atMost && `up to ${f.rarity.atMost}`]
            .filter(Boolean)
            .join(" ")),
    f.weapon && `${f.weapon} weapon`,
    f.kinds?.join(" or "),
    f.categories?.join(" or "),
    f.nameIncludes && `"${f.nameIncludes}"`,
    f.wargearKeywords && `with ${f.wargearKeywords.join(" or ")}`,
    f.allKeywords && `with ${f.allKeywords.join(" and ")}`,
    f.weaponTraits && `with the ${f.weaponTraits.join(" or ")} Trait`,
    f.notWeaponTraits && `without the ${f.notWeaponTraits.join(" or ")} Trait`,
    f.maxValue !== undefined &&
      `Value ≤ ${typeof f.maxValue === "number" ? f.maxValue : "tierPlus" in f.maxValue ? `Tier + ${f.maxValue.tierPlus}` : `new Tier + ${f.maxValue.newTierPlus}`}`,
  ].filter(Boolean);
  return bits.join(", ") || "any wargear";
}

// A short label for one option of a choice.
export function label(g: Grant): string {
  if ("all" in g) return g.all.map(label).join(" + ");
  if ("choose" in g && "from" in g) return `${amount(g.choose)} of ${g.from.map(label).join(" / ")}`;
  if ("choose" in g && "rating" in g) return `${g.choose} Skill${g.choose > 1 ? "s" : ""} to ${g.rating}`;
  if ("talent" in g) return `Talent: ${g.talent}`;
  if ("keyword" in g) return g.keyword;
  if ("keywords" in g) return g.keywords.join(" and ");
  if ("power" in g) return `Power: ${g.power}`;
  if ("wargear" in g) return g.wargear.qty === 1 ? g.wargear.name : `${g.wargear.name} ×${g.wargear.qty}`;
  if ("bundle" in g) return g.bundle.map((w) => w.name).join(" and ");
  if ("pick" in g) return `${amount(g.pick)} of ${describeFilter(g.wargearOf)}`;
  return describeGrant(g);
}

// A grant whose only content is Keywords: one or several, or a choice between such options. A species' Keywords belong
// to Advanced Creation, so these are the species grants an archetype build skips.
export const keywordsOnly = (g: Grant): boolean =>
  "keyword" in g ||
  "keywords" in g ||
  ("all" in g && g.all.every(keywordsOnly)) ||
  ("choose" in g && "from" in g && g.from.every(keywordsOnly));

export function describeGrant(g: Grant): string {
  if ("weaponTrait" in g) return `A weapon gains ${g.weaponTrait}`;
  if ("trinkets" in g) return `${amount(g.trinkets)} Trinkets`;
  if ("corruption" in g) return `Corruption ${amount(g.corruption)}`;
  if ("faith" in g) return `Faith ${amount(g.faith)}`;
  if ("memorableInjuries" in g) return `${amount(g.memorableInjuries)} Memorable Injuries`;
  if ("traumaticInjuries" in g) return `${amount(g.traumaticInjuries)} Traumatic Injuries`;
  if ("mutations" in g) return `${amount(g.mutations)} Mutations`;
  if ("wrathPerSession" in g) return `+${amount(g.wrathPerSession)} Wrath each session`;
  if ("wealthPerSession" in g) return `+${amount(g.wealthPerSession)} Wealth each session`;
  if ("ammoPer" in g) return `${g.ammo} Ammo each ${g.ammoPer}`;
  if ("never" in g) return `Never gains ${capital(g.never)}`;
  if ("gmRuin" in g) return `The GM's Ruin: ${amount(g.gmRuin)}`;
  if ("talentAccess" in g) return `May take ${g.talentAccess} talents`;
  if ("onlyDisciplines" in g)
    return `Only ${g.onlyDisciplines.join(", ")} powers${g.untilTier ? ` until Tier ${g.untilTier}` : ""}`;
  if ("noArmour" in g) return "May not wear armour";
  if ("followers" in g) return `${amount(g.followers)} ${g.kind}${g.threatId ? ` (${g.threatId})` : ""}`;
  if ("bonusDice" in g) return `+${amount(g.bonusDice)} bonus dice ${g.when}`;
  if ("chosenTrait" in g) return `+${amount(g.chosenTrait)} to the chosen Trait`;
  if ("story" in g) return g.story;
  return JSON.stringify(g).slice(0, 120);
}

// Who a table or option group belongs to, as a requirement on the character.
export function ownerReqs(o: BackgroundTable["owner"]): Requirement[] {
  if ("speciesId" in o) return [{ kind: "species", anyOf: [o.speciesId] }];
  if ("speciesIds" in o) return [{ kind: "species", anyOf: o.speciesIds }];
  if ("subFactionId" in o) return [{ kind: "subFaction", anyOf: [o.subFactionId] }];
  return []; // a faction's table: the archetype's faction, checked by the builder's choice of table
}

// A Successor's founders, so it matches their requirements too.
export function successors(sf: SubFaction, all: ReadonlyMap<string, SubFaction>): string[] {
  const out: string[] = [];
  for (let p = sf.successorOf; p && !out.includes(p); p = all.get(p)?.successorOf) out.push(p);
  return out;
}
