import { z } from "zod";

// Everything the ledger builder takes from a ruleset instead of from code: the price tables, the limits, the vocabularies,
// the keyword conventions, the sources and every cite. A group that is a rule carries its `cite` (the printed page, in
// the ruleset's own words); `cites` holds the rest. Nothing here is a book's text: numbers, names and short cites only.

const cite = z.string().min(1).max(80);
const name = z.string().min(1).max(60);
const count = z.number().int().min(0);
const pricing = z.array(count).min(2); // total XP to reach a rating, by rating

const Vocabulary = z.object({
  // The Attributes, in sheet order (the order the builder walks them).
  attributes: z.array(z.object({ id: name, name })).min(1),
  // The Skills, in sheet order, each with the Attribute it is linked to.
  skills: z.array(z.object({ name, attribute: name })).min(1),
  // The Trait modifiers a record may carry. `backgroundBonus: false` keeps one out of what a background row may give.
  // `influence` and `speed` are read by the builder and must be listed.
  mods: z.array(z.object({ key: name, label: name.optional(), backgroundBonus: z.boolean().default(true) })).min(1),
  subFactionTypes: z.array(name).min(1),
  // The first one is what a Talent without a category is.
  talentCategories: z.array(name).min(1),
  speciesSizes: z.array(name).min(1),
  wargearKinds: z.array(name).min(1),
  upgradeSlots: z.array(name).min(1),
  // The columns of a background table, in the order the builder asks them.
  backgroundRows: z.array(name).min(1),
});

const Source = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  cite: name, // the abbreviation a record's cite starts with
  official: z.boolean(), // an unofficial source is homebrew: the campaign's `homebrew` flag lets it in
});

const AdvancedWargearRow = z.object({
  total: count, // Total Value must stay strictly under this
  max: count.nullable(), // the highest Value of one item; null: none
  rare: count,
  veryRare: count,
});

export const BuildParams = z
  .object({
    vocabulary: Vocabulary,
    sources: z.object({
      pageSep: z.string().min(1).max(10), // between a source's cite and the page: a record's cite is its source's cite + pageSep + page
      list: z.array(Source).min(1),
    }),
    tiers: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
    // The campaign Tier's budget and the Rank the XP earned in play gives.
    startingXp: z.object({ perTier: count, cite }),
    rank: z.object({ xpPerRank: z.number().int().min(1), top: z.number().int().min(1), cite }),
    // Cumulative price tables: the Attribute table is indexed by rating (index 0 and 1 are the floor), the Skill table by
    // rating from 0. The top rating of each is the table's last index.
    attributeXp: z.object({ table: pricing, cite }),
    skillXp: z.object({ table: pricing, cite }),
    speciesMax: z.object({ capTop: z.number().int().min(1), cite }), // capTop: the highest a species maximum may be
    // Raising a Skill with XP to R needs R Skills with points, that one included.
    treeOfLearning: z.object({ enabled: z.boolean(), cite }),
    wealth: z.object({
      xp: count, // XP per point bought
      maxBought: count,
      startingPerTier: count, // starting Wealth = this x the campaign Tier
      cite,
    }),
    languages: z.object({ xp: count, freeFromKeywords: count, cite }),
    background: z.object({ bonusAmount: z.number().int().min(1) }),
    advanced: z.object({
      bonusXpPerTier: count, // added to the budget: no Archetype Ability
      abilityXpPerTier: count, // buying one Archetype's Ability costs its Tier x this
      wargear: z.object({ rows: z.array(AdvancedWargearRow).min(1), cite }), // row 0 is Tier 1; a higher Tier uses the last
    }),
    archetypeAscension: z.object({ minRank: z.number().int().min(1), cite }),
    rarity: z.object({
      order: z.array(name).min(1), // most common first
      rare: name,
      veryRare: name,
      refused: z.array(name), // no Advanced Creation Tier takes one
    }),
    keywords: z.object({
      geneSeedSkip: name, // a holder ignores a sub-faction trait flagged `geneSeed`
      any: name, // the placeholder a player fills with one of their own keywords
      anyTwo: name, // the placeholder that stands for two different keywords
      placeholderMarker: z.string().min(1).max(4), // what a placeholder keyword starts with
      placeholderCite: cite, // the cite of a placeholder with no keyword record
    }),
    links: z.object({
      influence: name, // the Attribute Influence starts from
      poweredArmour: name, // the Attribute powered armour adds to when a weapon is thrown or swung
    }),
    weapon: z.object({
      meleeMaxReach: z.number().int().min(1), // the longest reach a melee profile prints
      thrownTrait: z.string().min(1).max(60), // the trait a swung and thrown weapon notes, "{m}" being the metres
    }),
    movementTrait: z.string().min(1).max(120), // regular expression, one capture group: the armour trait that adds Speed
    defaultSpeed: count,
    cites: z.object({
      archetypeTier: cite,
      advancedCreation: cite,
      advancedWargear: cite,
      creationAscension: cite,
      ascensionSteps: cite,
      archetypeAscension: cite,
      archetypeAscensionRank: cite,
      advancementXp: cite,
      background: cite,
      speciesMax: cite,
      gm: cite,
      // House rulings the builder cites by name.
      backgroundBonus: cite,
      writeInKeyword: cite,
      writeInLanguage: cite,
    }),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const attrs = new Set(p.vocabulary.attributes.map((a) => a.id));
    const mods = new Set(p.vocabulary.mods.map((m) => m.key));
    const rarities = new Set(p.rarity.order);
    for (const s of p.vocabulary.skills)
      if (!attrs.has(s.attribute)) fail(`skill ${s.name}: unknown attribute ${s.attribute}`);
    for (const k of ["influence", "speed"]) if (!mods.has(k)) fail(`mods must list ${k}`);
    for (const a of [p.links.influence, p.links.poweredArmour])
      if (!attrs.has(a)) fail(`links: unknown attribute ${a}`);
    for (const r of [p.rarity.rare, p.rarity.veryRare, ...p.rarity.refused])
      if (!rarities.has(r)) fail(`rarity ${r} is not in the order`);
    if (!p.vocabulary.wargearKinds.includes("upgrade")) fail("wargearKinds must list upgrade");
    if (p.tiers.max < p.tiers.min) fail("tiers.max is below tiers.min");
    try {
      new RegExp(p.movementTrait);
    } catch {
      fail("movementTrait is not a regular expression");
    }
  });
export type BuildParams = z.infer<typeof BuildParams>;

export type Vocab = {
  attributes: string[];
  attributeNames: Record<string, string>;
  skills: string[];
  skillAttribute: Record<string, string>;
  modKeys: string[];
};

const vocabs = new WeakMap<BuildParams, Vocab>();
// The vocabularies as lookups, once per params object.
export function vocabOf(params: BuildParams): Vocab {
  const cached = vocabs.get(params);
  if (cached) return cached;
  const v = params.vocabulary;
  const made: Vocab = {
    attributes: v.attributes.map((a) => a.id),
    attributeNames: Object.fromEntries(v.attributes.map((a) => [a.id, a.name])),
    skills: v.skills.map((s) => s.name),
    skillAttribute: Object.fromEntries(v.skills.map((s) => [s.name, s.attribute])),
    modKeys: v.mods.map((m) => m.key),
  };
  vocabs.set(params, made);
  return made;
}

const sourceOf = (params: BuildParams, id: string) => params.sources.list.find((s) => s.id === id);
export const isOfficial = (params: BuildParams, source: string) => sourceOf(params, source)?.official ?? false;
export const sourceName = (params: BuildParams, source: string) => sourceOf(params, source)?.cite ?? source;
// A record's cite: its source's cite and the page.
export const sourceCite = (params: BuildParams, { source, page }: { source: string; page: number }) =>
  `${sourceName(params, source)}${params.sources.pageSep}${page}`;
