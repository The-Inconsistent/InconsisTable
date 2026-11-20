import { BuildParams } from "../params.ts";
import { buildSchemas, type Creation, type Wargear } from "../schemas.ts";
import type { BuildCatalogue } from "../types.ts";

// An invented game for the ledger builder's tests: four Attributes, eight Skills, its own price tables and limits.
// Nothing here is from a real ruleset; the prices differ on purpose from any printed table.

export const SAMPLE_PARAMS_INPUT = {
  vocabulary: {
    attributes: [
      { id: "MGT", name: "Might" },
      { id: "AGI", name: "Agility" },
      { id: "WIT", name: "Wit" },
      { id: "PRE", name: "Presence" },
    ],
    skills: [
      { name: "Brawl", attribute: "MGT" },
      { name: "Climb", attribute: "MGT" },
      { name: "Sneak", attribute: "AGI" },
      { name: "Dodge", attribute: "AGI" },
      { name: "Lore", attribute: "WIT" },
      { name: "Craft", attribute: "WIT" },
      { name: "Charm", attribute: "PRE" },
      { name: "Command", attribute: "PRE" },
    ],
    mods: [
      { key: "maxHealth", label: "Max Health" },
      { key: "maxNerve", label: "Max Nerve" },
      { key: "guard" },
      { key: "grit" },
      { key: "influence" },
      { key: "speed" },
      { key: "notice", backgroundBonus: false },
    ],
    subFactionTypes: ["guild", "any"],
    talentCategories: ["talent", "gift"],
    speciesSizes: ["Small", "Average", "Large"],
    wargearKinds: ["weapon", "armour", "equipment", "upgrade"],
    upgradeSlots: ["sight", "grip"],
    backgroundRows: ["roots", "deed", "dream"],
  },
  sources: {
    pageSep: " p.",
    list: [
      { id: "base", cite: "Base", official: true },
      { id: "extra", cite: "Extra", official: false },
    ],
  },
  tiers: { min: 1, max: 4 },
  startingXp: { perTier: 80, cite: "Base p.2" },
  rank: { xpPerRank: 30, top: 4, cite: "Base p.3" },
  attributeXp: { table: [0, 0, 3, 8, 16, 28, 44], cite: "Base p.4" },
  skillXp: { table: [0, 1, 4, 9, 16, 25], cite: "Base p.5" },
  speciesMax: { capTop: 12, cite: "Base p.6" },
  treeOfLearning: { enabled: true, cite: "Base p.7" },
  wealth: { xp: 2, maxBought: 3, startingPerTier: 2, cite: "Base p.8" },
  languages: { xp: 2, freeFromKeywords: 1, cite: "Base p.9" },
  background: { bonusAmount: 1 },
  advanced: {
    bonusXpPerTier: 8,
    abilityXpPerTier: 6,
    wargear: {
      rows: [
        { total: 12, max: 6, rare: 0, veryRare: 0 },
        { total: 18, max: 8, rare: 1, veryRare: 0 },
        { total: 24, max: null, rare: 2, veryRare: 1 },
      ],
      cite: "Base p.10",
    },
  },
  archetypeAscension: { minRank: 2, cite: "Base p.11" },
  rarity: {
    order: ["Common", "Scarce", "Hard", "Fabled", "Unique"],
    rare: "Hard",
    veryRare: "Fabled",
    refused: ["Unique"],
  },
  keywords: {
    geneSeedSkip: "HARDENED",
    any: "[WILD]",
    anyTwo: "[WILD 2]",
    placeholderMarker: "[",
    placeholderCite: "Base p.12",
  },
  links: { influence: "PRE", poweredArmour: "MGT" },
  weapon: { meleeMaxReach: 3, thrownTrait: "Hurled ({m} m)" },
  movementTrait: "^\\+(\\d+) Pace$",
  defaultSpeed: 5,
  cites: {
    archetypeTier: "Base p.13",
    advancedCreation: "Base p.14",
    advancedWargear: "Base p.15",
    creationAscension: "Base p.16",
    ascensionSteps: "Base pp.16, 17",
    archetypeAscension: "Base p.17",
    archetypeAscensionRank: "Base pp.3, 17",
    advancementXp: "Base p.3",
    background: "Base p.18",
    speciesMax: "Base p.19",
    gm: "GM",
    backgroundBonus: "House rule 1",
    writeInKeyword: "House rule 2",
    writeInLanguage: "House rule 3",
  },
};

export const SAMPLE_PARAMS = BuildParams.parse(SAMPLE_PARAMS_INPUT);

const S = buildSchemas(SAMPLE_PARAMS);
const base = (id: string, name: string, page = 20) => ({
  id,
  name,
  source: "base",
  page,
  summary: `${name}, invented.`,
});
const attrs = (MGT: number, AGI: number, WIT: number, PRE: number) => ({ MGT, AGI, WIT, PRE });
const max = { MGT: 4, AGI: 6, WIT: 6, PRE: 5, speed: 8 };
const item = (name: string, wargearId: string) => ({ wargear: { name, wargearId } });

const raw = {
  keywords: [
    { ...base("guild-keyword", "[GUILD]"), placeholder: "guild", writeIn: false },
    { ...base("wild-keyword", "[WILD]"), placeholder: "any", writeIn: true },
    { ...base("wild-two-keyword", "[WILD 2]"), placeholder: "any", writeIn: true },
    {
      ...base("gifted-keyword", "GIFTED"),
      grants: [
        { disciplineAccess: ["embers"] },
        { keyword: "EMBER-BORN" },
        // waits for the character to be known: only a HARDENED one is a SEER
        { all: [{ keyword: "SEER" }], requires: [{ kind: "keyword", anyOf: ["HARDENED"] }] },
      ],
    },
    { ...base("ember-born-keyword", "EMBER-BORN"), grants: [{ keyword: "SPARKED" }] },
    { ...base("sparked-keyword", "SPARKED"), grants: [{ mods: { grit: 1 } }] },
  ],
  factions: [
    { ...base("wardens", "Wardens"), keywords: ["WARDEN"] },
    { ...base("drifters", "Drifters"), keywords: ["DRIFTER"] },
  ],
  "sub-factions": [
    {
      ...base("ironhand", "Ironhand"),
      type: "guild",
      factionId: "wardens",
      keyword: "IRONHAND",
      traits: [
        { name: "Forged", mods: { guard: 1 } },
        { name: "Temper", geneSeed: true, mods: { maxNerve: 1 } },
      ],
    },
    {
      ...base("sparrow", "Sparrow"),
      type: "guild",
      factionId: "wardens",
      keyword: "SPARROW",
      successorOf: "ironhand",
    },
    {
      ...base("ashen", "Ashen"),
      source: "extra",
      type: "guild",
      factionId: "wardens",
      keyword: "ASHEN",
    },
  ],
  species: [
    {
      ...base("heron-kin", "Heron-kin"),
      xp: 6,
      speed: 6,
      size: "Small",
      attributes: attrs(2, 3, 3, 2),
      skills: { Sneak: 1 },
      max,
      abilities: [{ name: "Light Bones", summary: "Invented." }],
    },
    {
      ...base("stoneborn", "Stoneborn"),
      xp: 4,
      speed: 4,
      size: "Large",
      attributes: attrs(3, 2, 2, 2),
      skills: {},
      max,
      keywords: ["STONE"],
    },
  ],
  backgrounds: [
    {
      ...base("warden-roots", "Warden Roots"),
      owner: { factionId: "wardens" },
      roots: [
        { name: "Lowland", bonus: "guard" },
        { name: "Hillfolk", bonus: "wealth" },
      ],
      deed: [
        { name: "Held the Gate", bonus: "maxHealth" },
        { name: "Walked Alone", grants: [{ talent: "iron-nerve" }] },
      ],
      dream: [{ name: "A Quiet Hearth", bonus: "corruption" }],
    },
  ],
  "option-groups": [
    {
      ...base("marks", "Marks"),
      owner: { speciesId: "heron-kin" },
      pick: "tier",
      xp: [0, 2],
      options: [
        { name: "Wing Mark", mods: { speed: 1 } },
        { name: "Beak Mark", requires: [{ kind: "attribute", attribute: "AGI", min: 3 }] },
      ],
    },
  ],
  archetypes: [
    {
      ...base("lamplighter", "Lamplighter"),
      factionId: "wardens",
      tier: 1,
      speciesIds: ["heron-kin"],
      xp: 20,
      attributes: attrs(2, 3, 3, 2),
      skills: { Sneak: 2, Lore: 1 },
      keywords: ["WARDEN", "[GUILD]"],
      abilities: [{ name: "Steady Flame", mods: { guard: 1 } }],
      grants: [{ talent: "old-rite" }],
      wargear: [item("Lantern Staff", "lantern-staff"), item("Leather Coat", "leather-coat")],
    },
    {
      ...base("beacon-keeper", "Beacon-keeper"),
      factionId: "wardens",
      tier: 2,
      speciesIds: ["heron-kin", "stoneborn"],
      xp: 40,
      attributes: attrs(3, 4, 4, 3),
      skills: { Sneak: 3, Lore: 2, Command: 1 },
      keywords: ["WARDEN", "HARDENED", "[GUILD]"],
      abilities: [{ name: "Tall Light" }],
      wargear: [item("Hunting Bow", "hunting-bow")],
    },
    {
      ...base("pyre-lord", "Pyre-lord"),
      factionId: "wardens",
      tier: 3,
      speciesIds: ["heron-kin", "stoneborn"],
      xp: 70,
      attributes: attrs(4, 4, 5, 4),
      skills: { Sneak: 3, Lore: 3, Command: 2 },
      keywords: ["WARDEN"],
      abilities: [{ name: "High Pyre" }],
    },
    {
      ...base("oathkeeper", "Oathkeeper"),
      factionId: "wardens",
      tier: 1,
      speciesIds: ["heron-kin"],
      xp: 15,
      attributes: attrs(2, 3, 3, 3),
      skills: { Command: 1 },
      keywords: ["WARDEN"],
      abilities: [{ name: "Sworn Word" }],
      grants: [{ story: { id: "old-debt", label: "Owes an old debt" } }, { talent: "oath-witness" }],
    },
    {
      ...base("wayfarer", "Wayfarer"),
      factionId: "drifters",
      tier: 1,
      speciesIds: ["heron-kin", "stoneborn"],
      xp: 18,
      attributes: attrs(2, 2, 2, 3),
      skills: { Charm: 2 },
      keywords: ["DRIFTER", "[WILD]", "[WILD 2]"],
      abilities: [{ name: "Open Road" }],
      influence: 1,
    },
    {
      ...base("tinker", "Tinker"),
      factionId: "drifters",
      tier: 1,
      speciesIds: ["stoneborn"],
      xp: 16,
      attributes: attrs(3, 2, 3, 2),
      skills: { Craft: 2 },
      keywords: ["DRIFTER", "GIFTED"],
      abilities: [{ name: "Spare Parts" }],
      grants: [{ talent: "keen-sense" }, { mods: { armourRating: 1 } }],
      wargear: [
        { pick: 1, wargearOf: { kinds: ["equipment"], maxValue: { tierPlus: 1 } } },
        item("Hurler Frame", "hurler-frame"),
        item("Hand Axe", "hand-axe"),
      ],
    },
    {
      ...base("outlander", "Outlander"),
      source: "extra",
      factionId: "drifters",
      tier: 1,
      speciesIds: ["heron-kin"],
      xp: 10,
      attributes: attrs(2, 3, 3, 2),
      skills: {},
      abilities: [{ name: "Far Roads" }, { name: "Borrowed Rule", source: "extra" }],
    },
  ],
  talents: [
    { ...base("iron-nerve", "Iron Nerve"), xp: 3, mods: { maxNerve: 1 } },
    { ...base("hardy", "Hardy"), xp: 4, requires: [{ kind: "attribute", attribute: "MGT", min: 3 }] },
    { ...base("toughened", "Toughened"), xp: 2, repeatable: true, mods: { maxHealth: 1 } },
    { ...base("keen-sense", "Keen Sense"), xp: 2, options: ["sight", "smell", "touch"], repeatable: "perChoice" },
    { ...base("quarry", "Quarry"), xp: 3, repeatable: "perChoice" },
    { ...base("old-rite", "Old Rite"), xp: 5, requires: [{ kind: "skill", skill: "Lore", min: 3 }] },
    {
      ...base("oath-witness", "Oath Witness"),
      xp: 5,
      requires: [{ kind: "gm", id: "oath-witness", label: "Swore before a witness" }],
    },
  ],
  packages: [
    {
      ...base("rising-banner", "Rising Banner"),
      kind: "ascension",
      xp: { perTier: 5 },
      influence: { perTier: 1 },
      grants: [{ keyword: "BANNERED" }],
    },
    { ...base("veil-cloak", "Veil Cloak"), kind: "ascension", xp: 12 },
    {
      ...base("second-wind", "Second Wind"),
      kind: "advancement",
      xp: 6,
      notAtCreation: true,
      grants: [{ mods: { maxHealth: 2 } }],
    },
  ],
  disciplines: [{ ...base("embers", "Embers") }, { ...base("tides", "Tides") }],
  powers: [
    {
      ...base("spark", "Spark"),
      disciplineId: "embers",
      xp: 4,
      dn: 3,
      activation: "Action",
      duration: "Instant",
      range: "8 m",
      multiTarget: false,
    },
    {
      ...base("kindle", "Kindle"),
      disciplineId: "embers",
      xp: { atCreation: 3, later: 6 },
      dn: "Target's Guard",
      activation: "Action",
      duration: "Scene",
      range: "Touch",
      multiTarget: false,
    },
    {
      ...base("ebb", "Ebb"),
      disciplineId: "tides",
      xp: 4,
      dn: 4,
      activation: "Action",
      duration: "Instant",
      range: "12 m",
      multiTarget: false,
    },
  ],
  languages: [
    { ...base("trade-tongue", "Trade-tongue"), keywords: ["WARDEN"] },
    { ...base("old-cant", "Old Cant"), keywords: ["DRIFTER"] },
    { ...base("birdsong", "Birdsong"), keywords: ["WARDEN"], xenos: true },
  ],
};

const parseAll = <T>(schema: { parse: (x: unknown) => T }, list: unknown[]): T[] => list.map((x) => schema.parse(x));

const creation: Creation = {
  keywords: parseAll(S.Keyword, raw.keywords),
  factions: parseAll(S.Faction, raw.factions),
  "sub-factions": parseAll(S.SubFaction, raw["sub-factions"]),
  species: parseAll(S.Species, raw.species),
  backgrounds: parseAll(S.BackgroundTable, raw.backgrounds),
  "option-groups": parseAll(S.OptionGroup, raw["option-groups"]),
  archetypes: parseAll(S.Archetype, raw.archetypes),
  talents: parseAll(S.Talent, raw.talents),
  packages: parseAll(S.Package, raw.packages),
  disciplines: parseAll(S.Discipline, raw.disciplines),
  powers: parseAll(S.PsychicPower, raw.powers),
  languages: parseAll(S.Language, raw.languages),
};

const gear = (
  id: string,
  name: string,
  kind: string,
  value: number,
  rarity: string,
  more: Record<string, unknown> = {},
) => ({ ...base(id, name), category: kind === "weapon" ? "Arms" : "Kit", kind, value, rarity, ...more });

export const SAMPLE_WARGEAR_RAW = [
  gear("lantern-staff", "Lantern Staff", "weapon", 1, "Common", {
    keywords: ["WARDEN"],
    weapon: { damage: 2, ed: 2, range: [2], addStrength: true, traits: ["Reach"] },
  }),
  gear("hunting-bow", "Hunting Bow", "weapon", 3, "Scarce", {
    keywords: ["WARDEN", "BOW"],
    weapon: { damage: 4, ed: 1, range: [8, 16, 24], traits: ["Slow (1)"] },
  }),
  gear("hand-axe", "Hand Axe", "weapon", 2, "Common", {
    keywords: ["TOOL"],
    weapon: { damage: 2, ed: 1, range: [1], thrown: 3, addStrength: true },
  }),
  gear("sling", "Sling", "weapon", 1, "Common", { weapon: { damage: 2, ed: 1, range: [6, 12, 18] } }),
  gear("twin-blades", "Twin Blades", "weapon", 8, "Fabled", {
    keywords: ["BLADE"],
    weapon: { damage: 3, ed: 2, range: [1], addStrength: true, traits: ["Quick", "Keen"] },
  }),
  gear("void-glaive", "Void Glaive", "weapon", 9, "Unique", {
    weapon: { damage: 5, ed: 3, range: [2], addStrength: true },
  }),
  gear("leather-coat", "Leather Coat", "armour", 1, "Common", { armour: { ar: 2 } }),
  gear("plate", "Plate Harness", "armour", 6, "Hard", { armour: { ar: 5, traits: ["Heavy (2)"] } }),
  gear("hurler-frame", "Hurler Frame", "armour", 5, "Scarce", { armour: { ar: 3, powered: 2, traits: ["+1 Pace"] } }),
  gear("rope", "Rope", "equipment", 1, "Common"),
  gear("lens", "Brass Lens", "equipment", 2, "Common", { keywords: ["TOOL"] }),
  gear("signal-horn", "Signal Horn", "equipment", 3, "Scarce"),
  gear("sight-lens", "Sight Lens", "upgrade", 2, "Scarce", {
    upgrade: { slot: "sight", fits: { weapon: "ranged" }, mods: [] },
  }),
];

const wargear = new Map<string, Wargear>(SAMPLE_WARGEAR_RAW.map((w) => [w.id, S.Wargear.parse(w)]));

// `homebrew`: whether the campaign allows the unofficial source.
export const sampleCatalogue = (homebrew = false): BuildCatalogue => ({ creation, wargear, homebrew });
export const SAMPLE_CREATION = creation;
export const SAMPLE_WARGEAR = wargear;
