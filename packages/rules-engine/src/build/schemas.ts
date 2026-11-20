import { z } from "zod";

import type { BuildParams } from "./params.ts";

// The records the ledger builder reads, the build it resolves and the sheet it writes. What does not depend on the
// ruleset is plain schemas here; what is built from a vocabulary (Attributes, Skills, kinds, rarities, sources, tier
// bounds) comes from `buildSchemas(params)`. No schema carries a book's wording: a record, a rule and a background row
// may hold a short `summary` in the importer's own words, and the few short strings that stay (a price's `when`, a
// filter's `condition`) are the importer's own words too.

const id = z.string().regex(/^[a-z0-9-]+$/);
const ids = z.array(id).min(1);
const keyword = z.string().regex(/^(\[[A-Z0-9' -]+\]|[A-Z0-9' -]+)$/); // upper case; "[NAME]" is a placeholder
const dice = z.string().regex(/^\d*d\d+([+-]\d+)?$/); // "1d3", "d6+3"
const summary = z.string().max(300).optional();
const shortWords = z.string().min(1).max(120);

// A number that can scale: per Tier ascended, times the Tier, per Rank (and more), or Rank plus a number.
export const Scaled = z.union([
  z.number().int(),
  z.object({ perTier: z.number().int() }),
  z.object({ timesTier: z.number().int() }),
  z.object({ perRank: z.number().int(), plus: z.number().int().optional() }),
  z.object({ rankPlus: z.number().int() }),
]);
export type Scaled = z.infer<typeof Scaled>;
// An amount that may be rolled.
export const Amount = z.union([Scaled, dice, z.object({ perTier: dice }), z.object({ roll: dice, times: Scaled })]);
export type Amount = z.infer<typeof Amount>;

// What a change to a weapon's profile can say, with its amounts as `amount`. Anything a profile can't hold stays a `gm`
// mod, so nothing is silently dropped.
export const weaponMods = <A extends z.ZodTypeAny>(amount: A) =>
  z.union([
    z.object({ kind: z.literal("trait"), traitId: z.string().min(1), rating: amount.optional() }),
    z.object({ kind: z.literal("removeTrait"), traitId: z.string().min(1) }),
    z.object({ kind: z.literal("traitRating"), traitId: z.string().min(1), delta: amount }),
    z.object({ kind: z.literal("damage"), delta: amount }),
    z.object({ kind: z.literal("ed"), delta: amount }),
    z.object({ kind: z.literal("ap"), delta: amount }),
    z.object({ kind: z.literal("setAp"), value: z.number().int().max(0) }),
    z.object({ kind: z.literal("salvo"), delta: amount }),
    // `multiply`, a flat `delta`, or `bands` (shortest first, as `range` prints)
    z.object({
      kind: z.literal("range"),
      multiply: z.number().positive().optional(),
      delta: z.number().int().optional(),
      bands: z.array(z.number().int()).min(1).max(3).optional(),
    }),
    z.object({ kind: z.literal("ar"), delta: z.number().int() }), // armour only
    z.object({ kind: z.literal("bonusDice"), dice: amount, when: z.string().min(1).max(200) }),
    z.object({ kind: z.literal("gm"), what: z.string().min(1).max(200) }),
  ]);
export const UpgradeMod = weaponMods(z.number().int());
export type UpgradeMod = z.infer<typeof UpgradeMod>;
// A Talent's amount: fixed, per Rank, and maybe more.
export const RankAmount = z.union([
  z.number().int(),
  z.object({ perRank: z.number().int(), plus: z.number().int().optional() }),
]);
export type RankAmount = z.infer<typeof RankAmount>;
export const WeaponMod = weaponMods(RankAmount);
export type WeaponMod = z.infer<typeof WeaponMod>;

// A weapon profile. `wargearId`, `upgrades`, `fitted`, `asPrinted`, `mods` and the derived fields are the sheet's.
export const Weapon = z.object({
  name: z.string(),
  count: z.number().int().positive().optional(),
  damage: z.number().int(),
  ed: z.union([z.number().int(), z.string()]),
  ap: z.number().int().max(0).optional(),
  range: z.array(z.number().int().positive()).min(1).max(3),
  salvo: z.number().int().nonnegative().nullable().optional(),
  traits: z.array(z.string()).default([]),
  melee: z.boolean().optional(),
  countsStrength: z.literal(true).optional(),
  thrown: z.number().int().positive().optional(),
  wargearId: z.string().optional(),
  upgrades: z.array(z.string()).max(8).optional(),
  fitted: z.array(z.string()).max(8).optional(),
  asPrinted: z.literal(true).optional(),
  mods: z.array(UpgradeMod).max(10).optional(),
  upgradeNames: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});
export type Weapon = z.infer<typeof Weapon>;

// Which bestiary Threats a follower may be; the builder only carries it, so the words are the ruleset's.
export const ThreatFilter = z.object({
  classes: z.array(z.string().min(1).max(20)).min(1).optional(),
  maxSize: z.string().min(1).max(20).optional(),
  keywords: z.array(keyword).min(1).optional(),
});

// What a record costs. `base` + `plus` and `byChoice[].when` are the importer's own words for what the GM adds or what
// decides the price.
export const XpCost = z.union([
  z.number().int().min(0),
  z.object({ perTier: z.number().int().positive() }),
  z.object({ base: z.number().int().min(0), plus: shortWords }),
  z.object({ atCreation: z.number().int().min(0), later: z.number().int().min(0) }),
  z.object({ byChoice: z.array(z.object({ xp: z.number().int().min(0), when: shortWords })).min(2) }),
]);
export type XpCost = z.infer<typeof XpCost>;

// A catalogue item. `upgrades` and `traitIds` name a variant the catalogue has no entry of its own for.
export const WargearItem = z.object({
  name: z.string().min(1).max(200),
  qty: z.union([z.number().int().positive(), dice]).default(1),
  wargearId: id.optional(),
  upgrades: ids.optional(),
  traitIds: ids.optional(),
  mundane: z.literal(true).optional(), // a possession no catalogue holds: a sheet line only
  scope: z.enum(["character", "group"]).default("character"),
});

// The answer to one choice in a grant, keyed by its path: option indexes for `choose ... from`, otherwise the picked ids
// or names.
export const BuildChoice = z.array(z.union([z.number().int().min(0), z.string().min(1).max(100)])).max(20);
export type BuildChoice = z.infer<typeof BuildChoice>;

// Advanced Creation: a build with no Archetype.
export const AdvancedBuild = z.object({
  factionId: id.optional(),
  abilityOf: id.optional(),
  wargear: z.array(id).max(60).prefault([]),
});
export type AdvancedBuild = z.infer<typeof AdvancedBuild>;

export const UPGRADE_HOSTS = ["weapon", "armour"] as const;
const UpgradeHost = z.enum(UPGRADE_HOSTS);
export const MAX_MUTATIONS = 20;
export const MAX_AMMO_TYPES = 12;

// A background table: its columns are named by the ruleset, so they sit beside the known fields.
type BackgroundTableData = {
  id: string;
  name: string;
  source: string;
  page: number;
  summary?: string | undefined;
  owner: { factionId: string } | { speciesId: string } | { speciesIds: string[] } | { subFactionId: string };
  [column: string]: unknown;
};
type BuildBackground = { tableId: string; bonus?: string | undefined; [row: string]: string | undefined };

const tuple = (list: string[]) => list as [string, ...string[]];

const memo = new WeakMap<BuildParams, ReturnType<typeof make>>();

// The record schemas, the build and the sheet, for one ruleset's parameters. Once per params object.
export function buildSchemas(params: BuildParams) {
  const cached = memo.get(params);
  if (cached) return cached;
  const made = make(params);
  memo.set(params, made);
  return made;
}

function make(params: BuildParams) {
  const v = params.vocabulary;
  const attrIds = v.attributes.map((a) => a.id);
  const skillNames = v.skills.map((s) => s.name);
  const modKeys = v.mods.map((m) => m.key);
  const attrTop = params.attributeXp.table.length - 1;
  const skillTop = params.skillXp.table.length - 1;

  const attribute = z.enum(tuple(attrIds));
  const skill = z.enum(tuple(skillNames));
  const rating = z.number().int().min(0).max(attrTop);
  const cap = z.number().int().min(1).max(params.speciesMax.capTop);
  const Tier = z.number().int().min(params.tiers.min).max(params.tiers.max);
  const Source = z.enum(tuple(params.sources.list.map((s) => s.id)));
  const Rarity = z.enum(tuple(params.rarity.order));
  const WargearKind = z.enum(tuple(v.wargearKinds));
  const UpgradeSlot = z.enum(tuple(v.upgradeSlots));
  const TalentCategory = z.enum(tuple(v.talentCategories));
  const SubFactionType = z.enum(tuple(v.subFactionTypes));
  const BackgroundRow = z.enum(tuple(v.backgroundRows));

  const Mods = z.object(Object.fromEntries(modKeys.map((k) => [k, z.number().int()]))).partial();
  const bonusKeys = v.mods.filter((m) => m.backgroundBonus).map((m) => m.key);
  // A background or table bonus: a Trait modifier, Wealth or Corruption.
  const Bonus = z.enum(tuple([...bonusKeys, "wealth", "corruption"]));

  // The catalogue filter: every field narrows; an empty filter is any item. `condition` and `upgrade` are the importer's
  // own words for what only the GM can judge.
  const WargearFilter = z.object({
    kinds: z.array(WargearKind).min(1).optional(),
    weapon: z.enum(["melee", "ranged"]).optional(),
    categories: z.array(z.string().min(1)).min(1).optional(),
    nameIncludes: z.string().min(1).optional(),
    wargearKeywords: z.array(z.string().min(1)).min(1).optional(), // the item has any of these
    allKeywords: z.array(z.string().min(1)).min(1).optional(), // the item has all of these
    weaponTraits: z.array(z.string().min(1)).min(1).optional(), // by name without its rating, or exactly as printed with a bracket
    notWeaponTraits: z.array(z.string().min(1)).min(1).optional(),
    maxValue: z
      .union([
        z.number().int().min(0),
        z.object({ tierPlus: z.number().int() }),
        z.object({ newTierPlus: z.number().int() }),
      ])
      .optional(),
    rarity: z.object({ atMost: Rarity.optional(), atLeast: Rarity.optional() }).optional(),
    upgrade: shortWords.optional(),
    condition: shortWords.optional(),
  });
  // `chosen`: the weapon a Talent's choice names. `granted`: the weapon the record's own grant gave. `unarmed`: no line.
  const WeaponFits = WargearFilter.extend({
    chosen: z.literal(true).optional(),
    granted: z.literal(true).optional(),
    unarmed: z.literal(true).optional(),
  });
  // A record's entries are alternatives for one weapon: the first that fits applies.
  const WeaponEffect = z.object({ fits: WeaponFits, mods: z.array(WeaponMod).min(1) });

  const requirements = [
    z.object({ kind: z.literal("attribute"), attribute, min: rating }),
    z.object({ kind: z.literal("skill"), skill, min: rating }),
    z.object({ kind: z.literal("chosenAttribute"), min: rating }),
    z.object({ kind: z.literal("chosenSkill"), min: rating }),
    z.object({ kind: z.literal("influence"), min: z.number().int() }),
    z.object({ kind: z.literal("keyword"), anyOf: z.array(keyword).min(1) }),
    z.object({ kind: z.literal("notKeyword"), anyOf: z.array(keyword).min(1) }),
    z.object({ kind: z.literal("species"), anyOf: ids }), // a species' `countsAs` matches too
    z.object({ kind: z.literal("notSpecies"), anyOf: ids }),
    z.object({ kind: z.literal("archetype"), anyOf: ids }),
    z.object({ kind: z.literal("notArchetype"), anyOf: ids }),
    z
      .object({
        kind: z.literal("memorableInjuries"),
        min: z.number().int().min(1).optional(),
        max: z.number().int().min(0).optional(),
      })
      .refine((m) => m.min !== undefined || m.max !== undefined, "memorableInjuries needs min or max"),
    z.object({ kind: z.literal("subFaction"), anyOf: ids }), // a Successor matches its `successorOf` too
    z.object({ kind: z.literal("talent"), anyOf: ids }),
    z.object({ kind: z.literal("notTalent"), anyOf: ids }),
    z.object({ kind: z.literal("talentCategory"), category: TalentCategory, min: z.number().int().min(1) }),
    z.object({ kind: z.literal("option"), groupId: id, anyOf: z.array(z.string().min(1)).min(1) }),
    z.object({ kind: z.literal("power"), anyOf: ids }),
    z.object({
      kind: z.literal("powerCount"),
      min: z.number().int().min(1),
      sameDiscipline: z.boolean().default(false),
    }),
    z.object({ kind: z.literal("wargear"), anyOf: z.array(z.string().min(1)).min(1) }), // printed names
    z.object({ kind: z.literal("wargearKeyword"), anyOf: z.array(keyword).min(1) }),
    z.object({ kind: z.literal("wargearCount"), of: WargearFilter, min: z.number().int().min(1) }),
    z.object({ kind: z.literal("rank"), min: z.number().int().min(1) }),
    z
      .object({
        kind: z.literal("tier"),
        min: Tier.optional(),
        max: Tier.optional(),
      })
      .refine((t) => t.min !== undefined || t.max !== undefined, "tier needs min or max"),
    // A story condition the GM judges. `id` keeps the path of the GM's approval; `label` is what the problem shows.
    z.object({ kind: z.literal("gm"), id: z.string().min(1).max(200), label: z.string().min(1).max(120) }),
  ] as const;
  const RequirementOne = z.discriminatedUnion("kind", requirements);
  // `all`: every one of `of`, as one option of an `either`.
  const RequirementAll = z.object({ kind: z.literal("all"), of: z.array(RequirementOne).min(2) });
  const Requirement = z.discriminatedUnion("kind", [
    ...requirements,
    RequirementAll,
    z.object({ kind: z.literal("either"), of: z.array(z.union([RequirementOne, RequirementAll])).min(2) }),
  ]);

  // Something a record gives. Every form is structured; `story` is a narrative benefit the GM runs, by `id` and `label`.
  const grantOne = z.union([
    z.object({ talent: id }),
    z.object({ keyword }),
    z.object({ keywords: z.array(keyword).min(2) }), // taken together
    z.object({ power: id }),
    z.object({ wargear: WargearItem, requires: z.array(RequirementOne).optional() }),
    z.object({ bundle: z.array(WargearItem).min(2) }), // items taken together
    z.object({ pick: Scaled, wargearOf: WargearFilter, requires: z.array(RequirementOne).optional() }),
    z.object({ weapon: Weapon.extend({ addStrength: z.boolean().default(false) }) }), // an innate profile
    z.object({ weaponTrait: z.string().min(1) }),
    z.object({ trinkets: Amount }),
    z.object({ wealth: Amount }),
    z.object({ influence: Scaled }),
    z.object({ corruption: Amount }), // negative to lose it
    z.object({ faith: Scaled }),
    z.object({ languages: z.union([Scaled, z.object({ skill })]), xenos: z.literal(true).optional() }),
    z.object({ memorableInjuries: Amount }),
    z.object({ traumaticInjuries: Amount }),
    z.object({ mutations: Amount }),
    z.object({ wrathPerSession: Scaled }),
    z.object({ wealthPerSession: Scaled }),
    z.object({ ammoPer: z.enum(["session", "mission"]), ammo: z.number().int().positive() }),
    z.object({ mods: z.partialRecord(z.enum(tuple([...modKeys, "armourRating"])), Scaled) }),
    // `add` raises by N, `to` raises to at least N; `attribute` is the Attribute(s) or the player's pick
    z.object({
      attribute: z.union([attribute, z.array(attribute).min(2), z.enum(["any", "lowest"])]),
      add: z.number().int().optional(),
      to: rating.optional(),
    }),
    z.object({ chosenTrait: Scaled }),
    z.object({ skills: z.array(skill).min(1), add: z.number().int() }),
    z.object({ optionAccess: id }),
    z.object({ neverKeyword: keyword }),
    z.object({ never: z.enum(["faith", "corruption"]) }),
    z.object({ gmRuin: Scaled }),
    z.object({ talentAccess: TalentCategory, asKeyword: keyword.optional() }),
    z.object({ disciplineAccess: ids }),
    z.object({ loseKeyword: keyword }), // the any-keyword placeholder: one the player picks
    z.object({ influenceAttribute: attribute }),
    // A cheaper price: a Talent at a set XP, or a discipline's powers at a fraction (`discipline` omitted: chosen)
    z.object({
      xpDiscount: z.union([
        z.object({ talent: id, xp: z.number().int().min(0) }),
        z.object({ discipline: id.optional(), multiplier: z.number().positive().max(1) }),
      ]),
    }),
    // Followers: `threatId` (and `variant`) a fixed stat block, `threatOf` the player's pick, `genericStats` a stand-in.
    z.object({
      followers: Scaled,
      kind: z.enum(["mob", "companion", "familiar", "devotees", "minion"]),
      threatId: id.optional(),
      variant: z.string().min(1).optional(),
      threatOf: ThreatFilter.optional(),
      genericStats: Scaled.optional(),
    }),
    // Bonus dice and the Skills or situation they apply to; `when` is the importer's own words.
    z.object({ bonusDice: Scaled, skills: z.array(skill).optional(), when: shortWords }),
    z.object({ chooseDisciplines: z.number().int().positive(), from: ids.optional() }),
    z.object({ onlyDisciplines: ids, untilTier: Tier.min(params.tiers.min + 1).optional() }),
    z.object({ noArmour: z.literal(true) }),
    z.object({ choose: Scaled, fromDisciplines: ids, random: z.boolean().default(false) }),
    z.object({ story: z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(120) }) }),
  ]);
  // Several grants as one option of a choice; `requires` limits the option to some characters.
  const grantAll = z.object({ all: z.array(grantOne).min(1), requires: z.array(RequirementOne).optional() });
  const Grant = z.union([
    grantOne,
    grantAll,
    // Skills of the character's choice raised to `rating`; `skills` limits the choice.
    z.object({
      choose: z.number().int().positive(),
      rating: z.number().int().min(1).max(skillTop),
      skills: z.array(skill).min(2).optional(),
    }),
    // `optional`: the character may take none; `repeat`: an option may be taken more than once.
    z.object({
      choose: Scaled,
      from: z.array(z.union([grantOne, grantAll])).min(1),
      optional: z.boolean().default(false),
      repeat: z.boolean().default(false),
    }),
  ]);

  // Every record: where it is printed, and an optional short summary in the importer's own words.
  const record = {
    id,
    name: z.string().min(1).max(100),
    source: Source,
    page: z.number().int().positive(),
    summary,
  };

  // A named ability or trait. `mods` only where it prints a flat bonus.
  const Rule = z.object({
    name: z.string().min(1).max(100),
    summary,
    page: z.number().int().positive().optional(), // when not the record's page
    source: Source.optional(), // when not the record's source: a homebrew rule kept on the official record
    mods: Mods.optional(),
    grants: z.array(Grant).optional(),
    weapons: z.array(WeaponEffect).optional(),
  });

  const Keyword = z.object({
    ...record,
    name: keyword,
    placeholder: SubFactionType.optional(),
    writeIn: z.boolean().default(false), // the player may fill it with a name the ruleset doesn't list
    grants: z.array(Grant).default([]),
  });
  const Faction = z.object({
    ...record,
    keywords: z.array(keyword).default([]),
    rules: z.array(Rule).default([]),
    backgroundsFrom: z.array(id).default([]),
  });
  const SubFaction = z.object({
    ...record,
    type: SubFactionType,
    factionId: id,
    keyword,
    requires: z.array(Requirement).default([]),
    successorOf: id.optional(), // one with no traits of its own takes its parent's
    traits: z.array(Rule.extend({ geneSeed: z.boolean().default(false) })).default([]),
  });

  const attributes = z.partialRecord(attribute, rating);
  const skills = z.partialRecord(skill, z.number().int().min(0).max(skillTop));

  const Species = z.object({
    ...record,
    xp: z.number().int().min(0),
    speed: z.number().int().positive(),
    size: z.enum(tuple(v.speciesSizes)).optional(),
    attributes,
    skills,
    max: z.object(Object.fromEntries([...attrIds, "speed"].map((k) => [k, cap]))).optional(),
    keywords: z.array(keyword).default([]),
    abilities: z.array(Rule).default([]),
    grants: z.array(Grant).default([]),
    countsAs: z.array(id).default([]), // species it also counts as for requirements
  });

  // Who a table or option group belongs to.
  const Owner = z.union([
    z.object({ factionId: id }),
    z.object({ speciesId: id }),
    z.object({ speciesIds: ids }),
    z.object({ subFactionId: id }),
  ]);

  const backgroundRow = z.object({
    name: z.string().min(1),
    summary,
    bonus: Bonus.optional(),
    grants: z.array(Grant).optional(),
    requires: z.array(Requirement).optional(),
  });
  const BackgroundTableBase = z.object({ ...record, owner: Owner });
  // The columns are named by the ruleset, so their fields are added from the vocabulary.
  const BackgroundTable = BackgroundTableBase.extend(
    Object.fromEntries(v.backgroundRows.map((r) => [r, z.array(backgroundRow).default([])])),
  ) as unknown as z.ZodType<BackgroundTableData>;

  const OptionGroup = z.object({
    ...record,
    owner: Owner,
    pick: z.union([z.number().int().positive(), z.literal("tier"), z.literal("any")]),
    xp: z.array(z.number().int().min(0)).min(1).default([0]), // cost of the 1st, 2nd... option taken; the last repeats
    options: z
      .array(
        Rule.extend({
          requires: z.array(Requirement).default([]),
          notAtCreation: z.boolean().default(false),
        }),
      )
      .min(1),
  });

  const Archetype = z.object({
    ...record,
    factionId: id,
    tier: Tier,
    speciesIds: ids,
    requires: z.array(Requirement).default([]),
    xp: z.number().int().min(0),
    keywords: z.array(keyword).default([]),
    grants: z.array(Grant).default([]),
    attributes,
    skills,
    abilities: z.array(Rule).min(1),
    wargear: z.array(Grant).default([]),
    influence: z.number().int().optional(),
  });

  const Talent = z.object({
    ...record,
    category: TalentCategory.default(v.talentCategories[0]!),
    xp: XpCost,
    requires: z.array(Requirement).default([]),
    // "perChoice": once for each choice of its bracket or option.
    repeatable: z.union([z.boolean(), z.literal("perChoice")]).default(false),
    options: z.array(z.string().min(1).max(60)).min(2).optional(), // what its choice is one of; a grant asks for it
    mods: Mods.optional(),
    grants: z.array(Grant).optional(),
    weapons: z.array(WeaponEffect).optional(),
  });

  const Package = z.object({
    ...record,
    kind: z.enum(["ascension", "advancement"]),
    xp: XpCost,
    requires: z.array(Requirement).default([]),
    notAtCreation: z.boolean().default(false),
    atCreationWith: keyword.optional(), // lifts `notAtCreation` when the grants leave the character with this keyword
    influence: z.union([z.number().int(), z.object({ perTier: z.number().int() })]).default(0),
    grants: z.array(Grant).default([]),
    weapons: z.array(WeaponEffect).optional(),
    becomesArchetypeId: id.optional(),
  });

  const Discipline = z.object({ ...record, requires: z.array(Requirement).default([]) });

  // `activation`, `duration`, `range` and `dn` are short mechanics, capped as the sheet caps them.
  const PsychicPower = z.object({
    ...record,
    disciplineId: id,
    alsoIn: z.array(id).default([]),
    xp: XpCost,
    dn: z.union([z.number().int().positive(), z.string().min(1).max(60)]),
    activation: z.string().min(1).max(60),
    duration: z.string().min(1).max(60),
    range: z.string().min(1).max(60),
    multiTarget: z.union([z.boolean(), z.string().min(1)]),
    tags: z.array(z.string().min(1)).default([]),
    requires: z.array(Requirement).default([]),
    useRequires: z.array(Requirement).default([]),
  });

  const Language = z.object({
    ...record,
    keywords: z.array(keyword).min(1),
    xenos: z.literal(true).optional(),
  });

  // ── wargear ──
  const WargearWeapon = Weapon.omit({ name: true, range: true })
    .extend({
      addStrength: z.boolean().default(false),
      range: Weapon.shape.range.optional(),
      thrown: z.number().int().positive().optional(),
    })
    .refine((w) => w.range !== undefined || w.thrown !== undefined, "a weapon needs range or thrown");
  const WargearArmour = z.object({
    ar: z.number().int().min(0).max(20),
    invulnerable: z.boolean().default(false),
    powered: z.number().int().min(0).max(10).default(0),
    traits: z.array(z.string()).default([]),
  });
  const Upgrade = z.object({
    slot: UpgradeSlot,
    fits: WargearFilter,
    mods: z.array(UpgradeMod).default([]),
    exempt: z.enum(["max", "slot"]).optional(),
    copies: z.number().int().min(2).optional(),
    slotOn: z.partialRecord(UpgradeHost, UpgradeSlot).optional(),
    gmOnly: z.boolean().optional(),
  });
  const Wargear = z.object({
    id,
    name: z.string().min(1).max(100),
    source: Source,
    page: z.number().int().positive(),
    summary,
    category: z.string().min(1).max(60),
    kind: WargearKind,
    value: z.number().int().min(0).max(30).nullable(), // null: none printed
    rarity: Rarity.nullable(),
    keywords: z.array(z.string().min(1)).default([]),
    weapon: WargearWeapon.optional(),
    armour: WargearArmour.optional(),
    upgrade: Upgrade.optional(),
    threatId: id.optional(),
    variant: z.string().min(1).optional(),
    requires: z.array(Requirement).optional(),
  });

  // ── the sheet ──
  const attr = z.number().int().min(1).max(attrTop);
  const rule = z.object({ name: z.string().max(100), summary, page: z.string().max(40).optional() });
  const SheetWeapon = Weapon.extend({ addStrength: z.boolean().default(false) });
  const SheetPower = z.object({
    name: z.string().max(100),
    page: z.string().max(40),
    summary,
    dn: z.union([z.number().int().positive(), z.string().max(60)]),
    activation: z.string().max(60),
    duration: z.string().max(60),
    range: z.string().max(60),
  });
  const MutationMods = z.object({
    attributes: z.partialRecord(attribute, z.number().int().min(-5).max(5)).default({}),
    skills: z.partialRecord(skill, z.number().int().min(-5).max(5)).default({}),
    traits: Mods.default({}),
  });
  const SheetMutation = z.object({
    id,
    name: z.string().min(1).max(200),
    page: z.number().int().positive(),
    summary,
    mods: MutationMods,
    weapons: z.array(SheetWeapon).max(4).default([]),
  });
  // A weapon effect as the build resolved it: the record it comes from, and which weapons it reaches.
  const SheetWeaponEffect = z.object({
    source: z.string().min(1).max(100),
    cite: z.string().max(40).optional(),
    fits: WargearFilter.extend({
      wargearIds: z.array(z.string().min(1)).max(10).optional(),
      names: z.array(z.string().min(1).max(100)).max(10).optional(),
    }),
    mods: z.array(WeaponMod).min(1).max(10),
  });
  const CharacterStats = z.object({
    species: z.string().max(60).default(""),
    archetype: z.string().max(100).default(""),
    keywords: z.array(z.string().max(60)).max(20).default([]),
    attributes: z
      .object(Object.fromEntries(attrIds.map((a) => [a, attr])))
      .default(Object.fromEntries(attrIds.map((a) => [a, 1]))),
    skills: z.partialRecord(skill, z.number().int().min(0).max(skillTop)).default({}),
    armour: z
      .object({
        name: z.string().max(100),
        ar: z.number().int().min(0).max(20),
        invulnerable: z.boolean().default(false),
        powered: z.number().int().min(0).max(10).default(0),
        traits: z.array(z.string().max(60)).default([]),
        wargearId: z.string().optional(),
        upgrades: z.array(z.string()).max(8).optional(),
        fitted: z.array(z.string()).max(8).optional(),
        upgradeNames: z.array(z.string()).optional(),
        notes: z.array(z.string()).optional(),
      })
      .default({ name: "", ar: 0, invulnerable: false, powered: 0, traits: [] }),
    speed: z.number().int().min(0).max(20).default(params.defaultSpeed),
    mods: Mods.default({}),
    abilities: z.array(rule).max(30).default([]),
    talents: z.array(rule).max(30).default([]),
    weapons: z.array(SheetWeapon).max(20).default([]),
    powers: z.array(SheetPower).max(30).optional(),
    gear: z.array(z.string().max(200)).max(60).default([]),
    weaponEffects: z.array(SheetWeaponEffect).max(60).optional(),
    wealth: z.number().int().min(0).default(0),
    corruption: z.number().int().min(0).default(0),
    mutations: z.array(SheetMutation).max(MAX_MUTATIONS).default([]),
    ammo: z
      .record(z.string().min(1).max(60), z.number().int().min(0).max(99))
      .refine((a) => Object.keys(a).length <= MAX_AMMO_TYPES, `At most ${MAX_AMMO_TYPES} ammo types`)
      .default({}),
    requisitioned: z.partialRecord(z.enum(["wargear", "ammo"]), z.string()).default({}),
  });

  // ── the build ──
  // Advancement: what the character buys after creation with the XP earned in play, priced from where creation left the
  // ratings. `boughtIn` is the purchase history: a label on a ledger row and nothing else, keyed by `purchaseKey`.
  const Advancement = z
    .object({
      attributes: z.partialRecord(attribute, z.number().int().min(1).max(attrTop)).prefault({}),
      skills: z.partialRecord(skill, z.number().int().min(0).max(skillTop)).prefault({}),
      talents: z.array(z.object({ id, choice: z.string().min(1).max(60).optional() })).prefault([]),
      powers: z.array(id).prefault([]),
      packages: z.array(id).prefault([]),
      languages: z.array(z.string().min(1).max(60)).prefault([]),
      archetypeAscension: z.object({ archetypeId: id }).optional(),
      boughtIn: z.record(z.string().min(1).max(200), z.number().int().min(1).max(10_000)).prefault({}),
    })
    .prefault({});

  const CharacterBuild = z
    .object({
      tier: Tier,
      budget: z.number().int().min(0).max(1000).optional(), // a GM's custom budget
      archetypeId: id.optional(), // exactly one of `archetypeId` and `advanced`
      advanced: AdvancedBuild.optional(),
      speciesId: id.optional(),
      // What fills each [PLACEHOLDER] keyword: a sub-faction, or a name the player writes in where the keyword allows it.
      fills: z.record(keyword, z.union([z.object({ id }), z.object({ writeIn: keyword })])).prefault({}),
      // One row of each column by name, and which row's bonus applies.
      background: (
        z.object({
          tableId: id,
          ...Object.fromEntries(v.backgroundRows.map((r) => [r, z.string().min(1).optional()])),
          bonus: BackgroundRow.optional(),
        }) as unknown as z.ZodType<BuildBackground>
      ).optional(),
      options: z.array(z.object({ groupId: id, name: z.string().min(1) })).prefault([]), // in the order taken
      attributes: z.partialRecord(attribute, z.number().int().min(1).max(attrTop)).prefault({}),
      skills: z.partialRecord(skill, z.number().int().min(0).max(skillTop)).prefault({}),
      talents: z.array(z.object({ id, choice: z.string().min(1).max(60).optional() })).prefault([]),
      powers: z.array(id).prefault([]),
      packages: z.array(id).prefault([]),
      languages: z
        .object({
          picks: z.array(z.string().min(1).max(60)).prefault([]),
          bought: z.array(z.string().min(1).max(60)).prefault([]),
        })
        .prefault({}),
      wealth: z.number().int().min(0).max(params.wealth.maxBought).prefault(0),
      choices: z.record(z.string().min(1).max(200), BuildChoice).prefault({}),
      advancement: Advancement,
      // The GM's part: rulings on this character that no book makes, and ticks on what only the GM can judge.
      gm: z
        .object({
          species: id.optional(),
          keywords: z.array(keyword).prefault([]),
          gear: z
            .object({ remove: z.array(z.string().min(1)).prefault([]), add: z.array(WargearItem).prefault([]) })
            .prefault({}),
          approved: z.array(z.string().min(1).max(200)).prefault([]), // paths of `gm` requirements and `story` grants
          mods: Mods.prefault({}),
        })
        .prefault({}),
    })
    .refine((b) => (b.archetypeId === undefined) !== (b.advanced === undefined), {
      message: "A build takes an Archetype or Advanced Creation, not both and not neither",
      path: ["archetypeId"],
    });

  return {
    Tier,
    Source,
    Rarity,
    WargearKind,
    Mods,
    Bonus,
    BackgroundRow,
    TalentCategory,
    SubFactionType,
    WargearFilter,
    WeaponEffect,
    RequirementOne,
    Requirement,
    Grant,
    Rule,
    Keyword,
    Faction,
    SubFaction,
    Species,
    BackgroundTable,
    OptionGroup,
    Archetype,
    Talent,
    Package,
    Discipline,
    PsychicPower,
    Language,
    WargearWeapon,
    Wargear,
    SheetWeaponEffect,
    CharacterStats,
    Advancement,
    CharacterBuild,
  };
}

export type Schemas = ReturnType<typeof buildSchemas>;
export type WargearFilter = z.infer<Schemas["WargearFilter"]>;
export type WeaponEffect = z.infer<Schemas["WeaponEffect"]>;
export type Requirement = z.infer<Schemas["Requirement"]>;
export type Grant = z.infer<Schemas["Grant"]>;
export type Rule = z.infer<Schemas["Rule"]>;
export type Keyword = z.infer<Schemas["Keyword"]>;
export type Faction = z.infer<Schemas["Faction"]>;
export type SubFaction = z.infer<Schemas["SubFaction"]>;
export type Species = z.infer<Schemas["Species"]>;
export type BackgroundTable = z.infer<Schemas["BackgroundTable"]>;
export type BackgroundRowEntry = {
  name: string;
  summary?: string | undefined;
  bonus?: string | undefined;
  grants?: Grant[] | undefined;
  requires?: Requirement[] | undefined;
};
export type OptionGroup = z.infer<Schemas["OptionGroup"]>;
export type Archetype = z.infer<Schemas["Archetype"]>;
export type Talent = z.infer<Schemas["Talent"]>;
export type Package = z.infer<Schemas["Package"]>;
export type Discipline = z.infer<Schemas["Discipline"]>;
export type PsychicPower = z.infer<Schemas["PsychicPower"]>;
export type Language = z.infer<Schemas["Language"]>;
export type Wargear = z.infer<Schemas["Wargear"]>;
export type WargearWeapon = z.infer<Schemas["WargearWeapon"]>;
export type SheetWeaponEffect = z.infer<Schemas["SheetWeaponEffect"]>;
export type CharacterStats = z.infer<Schemas["CharacterStats"]>;
export type CharacterBuild = z.infer<Schemas["CharacterBuild"]>;
export type CharacterBuildInput = z.input<Schemas["CharacterBuild"]>;
export type WargearItem = z.infer<typeof WargearItem>;

// The catalogue the builder reads: the record lists of the creation types and the wargear by id.
export type Creation = {
  keywords: Keyword[];
  factions: Faction[];
  "sub-factions": SubFaction[];
  species: Species[];
  backgrounds: BackgroundTable[];
  "option-groups": OptionGroup[];
  archetypes: Archetype[];
  talents: Talent[];
  packages: Package[];
  disciplines: Discipline[];
  powers: PsychicPower[];
  languages: Language[];
};
