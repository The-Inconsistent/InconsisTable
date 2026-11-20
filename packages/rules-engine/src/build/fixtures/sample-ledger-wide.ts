import { SAMPLE_CREATION_RAW, SAMPLE_PARAMS_INPUT, SAMPLE_WARGEAR_RAW } from "./sample-ledger.ts";

// The sample game widened, for the Go twin's generated vectors (apps/api-go/vectors/ledger.ts): records that reach
// every grant, requirement, price and wargear form the builder reads. Invented throughout, like the sample; the sample
// itself is unchanged, so its tests keep their numbers.

export const WIDE_PARAMS_INPUT = {
  ...SAMPLE_PARAMS_INPUT,
  vocabulary: {
    ...SAMPLE_PARAMS_INPUT.vocabulary,
    subFactionTypes: ["guild", "any", "circle"],
    backgroundRows: ["roots", "deed", "dream", "origin", "🌊tide"],
    // a key with no label is shown as JavaScript upper-cases its first letter, and ß upper-cases to SS
    mods: [...SAMPLE_PARAMS_INPUT.vocabulary.mods, { key: "ßpirit" }],
  },
  // a capture that is not always a whole number: Number() reads hex, and a fraction is refused by the sheet
  movementTrait: "^\\+([0-9a-fx.]+) Pace$",
};

const base = (id: string, name: string, page = 40) => ({
  id,
  name,
  source: "base",
  page,
  summary: `${name}, invented.`,
});
const extra = (id: string, name: string, page = 5) => ({ id, name, source: "extra", page });
const attrs = (MGT: number, AGI: number, WIT: number, PRE: number) => ({ MGT, AGI, WIT, PRE });
const item = (name: string, wargearId: string, more: Record<string, unknown> = {}) => ({
  wargear: { name, wargearId, ...more },
});

// One of every grant a choice can offer, so each label and each grant runs.
const EVERY_OPTION = [
  { talent: "toughened" },
  { keyword: "SEEKER" },
  { keywords: ["SEEKER", "FINDER"] },
  { power: "spark" },
  item("Lantern Staff", "lantern-staff", { qty: 2 }),
  {
    bundle: [
      { name: "Rope", wargearId: "rope" },
      { name: "Chalk", qty: "d3", mundane: true },
    ],
  },
  { pick: 1, wargearOf: { kinds: ["equipment"] } },
  { all: [{ power: "spark" }, { disciplineAccess: ["embers"] }] },
  { wealth: 1 },
  { influence: 1 },
  { mods: { guard: 1 } },
  { attribute: "MGT", to: 3 },
  { weapon: { name: "Bite", damage: 1, ed: 1, range: [1] } },
  // its label is the grant as JSON cut at 120 UTF-16 units, here inside the snake: a pair cut in half
  { weapon: { name: `${"B".repeat(100)}🐍 "fangs"\tbared`, damage: 1, ed: 1, range: [1] } },
  item("Sling", "sling"),
  { pick: 1, wargearOf: {} },
  {
    pick: 1,
    wargearOf: {
      rarity: { atLeast: "Scarce", atMost: "Scarce" },
      categories: ["Arms"],
      nameIncludes: "s",
      wargearKeywords: ["BOW", "TOOL"],
      allKeywords: ["WARDEN"],
      weaponTraits: ["Slow"],
      notWeaponTraits: ["Heavy (3)"],
      maxValue: 3,
    },
  },
  { pick: 1, wargearOf: { maxValue: { newTierPlus: 1 }, rarity: { atLeast: "Hard" } } },
  { pick: 1, wargearOf: { kinds: ["upgrade"], upgrade: "fits a bow", rarity: { atMost: "Scarce" } } },
  { talent: "lost-art" },
  { languages: 1 },
  { xpDiscount: { multiplier: 0.5 } },
  { chooseDisciplines: 1 },
  { loseKeyword: "MYSTIC" },
  { story: "Saw the far shore" },
  { followers: { perRank: 1 }, kind: "minion", variant: "small" },
  { onlyDisciplines: ["tides"], untilTier: 2 },
];

const additions = {
  keywords: [
    { ...base("circle-keyword", "[CIRCLE]"), placeholder: "circle" },
    {
      ...base("mystic-keyword", "MYSTIC"),
      // two never-keywords, listed out of alphabetical order: the problems follow the order they were given
      grants: [
        { disciplineAccess: ["tides"] },
        { neverKeyword: "MYSTIC" },
        { neverKeyword: "DRIFTER" },
        { optionAccess: "vows" },
      ],
    },
    {
      ...base("bannered-keyword", "BANNERED"),
      grants: [{ choose: 1, from: [{ keyword: "HERALD" }, { keywords: ["CAPTAIN", "LEADER"] }] }],
    },
    {
      ...base("herald-keyword", "HERALD"),
      grants: [
        { wealthPerSession: 1 },
        { all: [{ wargear: { name: "Banner Pole", mundane: true } }], requires: [{ kind: "rank", min: 2 }] },
      ],
    },
    { ...base("ascended-keyword", "ASCENDED"), grants: [{ keyword: "[WILD]" }] },
  ],
  factions: [
    {
      ...base("circle-folk", "Circle-folk"),
      rules: [{ name: "Ring Dance" }],
      backgroundsFrom: ["drift-roots"],
    },
    { ...extra("outcasts", "Outcasts"), keywords: ["OUTCAST"] },
  ],
  "sub-factions": [
    { ...base("rook", "Rook"), type: "circle", factionId: "circle-folk", keyword: "ROOK", successorOf: "crow" },
    {
      ...base("crow", "Crow"),
      type: "circle",
      factionId: "circle-folk",
      keyword: "CROW",
      successorOf: "rook",
      requires: [{ kind: "species", anyOf: ["stoneborn"] }],
      traits: [
        { name: "Crow Eyes", geneSeed: true, mods: { notice: 1 } },
        { name: "Borrowed Feather", source: "extra", page: 4 },
        { name: "Night Flight", page: 41, grants: [{ attribute: "lowest", add: 1 }] },
      ],
    },
    {
      ...base("lantern-guild", "Lantern Guild"),
      type: "guild",
      factionId: "wardens",
      keyword: "LANTERN",
      requires: [{ kind: "notSpecies", anyOf: ["stoneborn"] }],
      traits: [{ name: "Steady Hands", geneSeed: true, grants: [{ skills: ["Craft"], add: 1 }] }],
    },
  ],
  species: [
    {
      ...base("ashkin", "Ashkin"),
      xp: 8,
      speed: 5,
      size: "Average",
      attributes: attrs(2, 2, 2, 2),
      skills: { Lore: 1, Craft: 0 },
      max: { MGT: 5, AGI: 5, WIT: 6, PRE: 4, speed: 6 },
      keywords: ["ASH"],
      countsAs: ["heron-kin"],
      abilities: [
        { name: "Cinder Skin", page: 7, grants: [{ languages: { skill: "Lore" }, xenos: true }] },
        { name: "Ember Tongue", source: "extra", page: 2 },
      ],
      grants: [
        { choose: 1, from: [{ keyword: "ASH-BORN" }, { keywords: ["EMBER-BORN", "SOOT"] }] },
        { keyword: "CINDER" },
        { attribute: ["WIT", "PRE"], add: 1 },
        { story: "Remembers the fire" },
        { corruption: 1 },
        { languages: { perTier: 1 } },
        // keyword grants mixed with others are not skipped for an archetype
        { all: [{ keyword: "EMBERED" }, { faith: 1 }] },
        { choose: 1, from: [{ keyword: "SMOKED" }, { trinkets: 1 }] },
        // a negative count: .slice(0, -1) keeps all but the last answer
        { choose: -1, from: [{ keyword: "KILN" }, { keyword: "FORGE" }, { keyword: "BELLOWS" }], repeat: true },
        { choose: 1, fromDisciplines: ["tides"] },
        { wealth: { timesTier: 1 } },
        { influence: { rankPlus: 1 } },
        { mods: { guard: { perRank: 1, plus: 1 } } },
        { wealth: "d6" },
        { wealth: { perTier: "d3" } },
      ],
    },
    {
      ...extra("gloomling", "Gloomling"),
      xp: 3,
      speed: 4,
      attributes: attrs(1, 3, 3, 1),
      skills: { Sneak: 2 },
      grants: [{ onlyDisciplines: ["tides"] }, { chooseDisciplines: 1, from: ["embers", "tides"] }],
    },
    // faster than a sheet holds: every build with it is refused by the sheet's schema
    { ...base("giantkin", "Giantkin"), xp: 2, speed: 25, attributes: attrs(4, 1, 1, 1), skills: {} },
  ],
  backgrounds: [
    {
      ...base("drift-roots", "Drift Roots"),
      owner: { speciesIds: ["stoneborn", "ashkin"] },
      roots: [
        { name: "Ashfall", bonus: "influence", grants: [{ talent: "keen-sense" }] },
        { name: "Riverbend", bonus: "speed", requires: [{ kind: "attribute", attribute: "AGI", min: 3 }] },
      ],
      dream: [{ name: "Open Sky", bonus: "wealth", grants: [{ wealth: { roll: "d3", times: 2 } }] }],
      "🌊tide": [{ name: "Undertow", bonus: "ßpirit" }],
      origin: [
        { name: "Far Shore", bonus: "corruption" },
        { name: "Near Shore", bonus: "maxNerve", grants: [{ choose: 1, rating: 2, skills: ["Lore", "Craft"] }] },
      ],
    },
    { ...extra("rook-roots", "Rook Roots"), owner: { subFactionId: "rook" }, roots: [{ name: "Nest" }] },
    { ...base("ash-roots", "Ash Roots"), owner: { speciesId: "ashkin" }, origin: [{ name: "Kiln", bonus: "guard" }] },
  ],
  "option-groups": [
    {
      ...base("vows", "Vows"),
      owner: { factionId: "circle-folk" },
      pick: 2,
      xp: [1, 2, 3],
      options: [
        { name: "Vow of Ash", grants: [{ faith: 1 }] },
        { name: "Vow of Rain", notAtCreation: true },
        {
          name: "Vow of Stone",
          requires: [{ kind: "keyword", anyOf: ["ASH"] }],
          mods: { grit: 1 },
          weapons: [{ fits: { granted: true }, mods: [{ kind: "damage", delta: 1 }] }],
          grants: [item("Hand Axe", "hand-axe")],
        },
      ],
    },
    {
      ...base("tricks", "Tricks"),
      owner: { subFactionId: "crow" },
      pick: "any",
      options: [
        { name: "Feint", page: 9, source: "base" },
        { name: "Dodge Roll", grants: [{ skills: ["Dodge"], add: 1 }] },
      ],
    },
    {
      ...extra("shadow-marks", "Shadow Marks"),
      owner: { factionId: "outcasts" },
      pick: 1,
      // a lowered Attribute: a rating bought from below the price table prices as NaN
      options: [{ name: "Hollow Mark", grants: [{ attribute: "AGI", add: -3 }] }],
    },
  ],
  archetypes: [
    {
      ...base("seeker", "Seeker"),
      factionId: "drifters",
      tier: 1,
      speciesIds: ["heron-kin", "stoneborn", "ashkin"],
      xp: 22,
      attributes: attrs(2, 3, 2, 2),
      skills: { Lore: 2, Sneak: 1 },
      keywords: ["DRIFTER", "[CIRCLE]", "MYSTIC"],
      abilities: [{ name: "Far Sight", grants: [{ choose: 2, from: EVERY_OPTION }] }],
      grants: [
        { attribute: "any", add: 1 },
        { choose: 1, rating: 2 },
        { choose: 2, rating: 1, skills: ["Lore", "Sneak", "Craft"] },
        { xpDiscount: { talent: "hardy", xp: 1 } },
      ],
      wargear: [
        {
          pick: 2,
          wargearOf: { kinds: ["weapon"], rarity: { atMost: "Scarce" }, condition: "a weapon the GM allows" },
        },
        {
          bundle: [
            { name: "Rope", wargearId: "rope" },
            { name: "Chalk", qty: "d3", mundane: true },
          ],
        },
        {
          ...item("Hunting Bow", "hunting-bow", { upgrades: ["sight-lens"], traitIds: ["fletched"] }),
          requires: [{ kind: "skill", skill: "Sneak", min: 2 }],
        },
      ],
    },
    {
      ...base("mystic", "Mystic"),
      factionId: "drifters",
      tier: 2,
      speciesIds: ["ashkin"],
      xp: 35,
      attributes: attrs(2, 2, 3, 3),
      skills: { Command: 1, Lore: 2 }, // not in the vocabulary's order: an Ascension short of them lists them so
      keywords: ["MYSTIC", "[WILD]"],
      requires: [
        {
          kind: "either",
          of: [
            { kind: "attribute", attribute: "WIT", min: 4 },
            {
              kind: "all",
              of: [
                { kind: "rank", min: 2 },
                { kind: "keyword", anyOf: ["SEER"] },
              ],
            },
          ],
        },
      ],
      abilities: [{ name: "Inner Fire", mods: { maxNerve: 1 } }],
      grants: [
        { onlyDisciplines: ["embers", "tides"], untilTier: 3 },
        { chooseDisciplines: 1, from: ["embers"] },
        { choose: { perTier: 1 }, fromDisciplines: ["embers", "tides"], random: true },
        { xpDiscount: { multiplier: 0.5 } },
        { xpDiscount: { discipline: "tides", multiplier: 0.28 } },
        { loseKeyword: "[WILD]" },
        { influenceAttribute: "WIT" },
        { mods: { armourRating: 2, speed: 1 } },
      ],
      wargear: [item("Plate Harness", "plate")],
      influence: 2,
    },
    {
      ...base("old-guard", "Old Guard"),
      factionId: "wardens",
      tier: 3,
      speciesIds: ["heron-kin", "stoneborn"],
      xp: 60,
      attributes: attrs(4, 3, 3, 3),
      skills: { Brawl: 3, Command: 2 },
      keywords: ["WARDEN", "[GUILD]", "HARDENED"],
      requires: [
        { kind: "notArchetype", anyOf: ["seeker"] },
        { kind: "tier", min: 3 },
      ],
      abilities: [{ name: "Old Scars", page: 30 }],
      grants: [
        { weapon: { name: "Shield Bash", damage: 2, ed: 1, range: [1, 2, 3], thrown: 2 } },
        { followers: { perRank: 1, plus: 1 }, kind: "companion", threatId: "hound" },
        { gmRuin: 1 },
        { never: "corruption" },
        { memorableInjuries: { perTier: "d3" } },
        { traumaticInjuries: 1 },
        { mutations: { roll: "d3", times: { timesTier: 1 } } },
        { wrathPerSession: { rankPlus: 1 } },
        { ammoPer: "mission", ammo: 3 },
        { chosenTrait: 1 },
        { bonusDice: 2, skills: ["Brawl"], when: "when cornered" },
        { talentAccess: "gift", asKeyword: "SEER" },
        { noArmour: true },
        { weaponTrait: "Keen" },
        { trinkets: "d6" },
        { corruption: -1 },
        { corruption: "2d3" },
        { faith: { timesTier: 1 } },
      ],
    },
    {
      ...base("gatekeeper", "Gatekeeper"),
      factionId: "wardens",
      tier: 1,
      speciesIds: ["stoneborn"],
      xp: 12,
      attributes: attrs(3, 2, 2, 2),
      skills: {},
      keywords: ["WARDEN", "[CIRCLE]"],
      abilities: [{ name: "Gate Ward" }],
      wargear: [
        item("Hand Axe", "hand-axe", { qty: 3 }),
        item("Javelin", "javelin"),
        item("Ring Mail", "ring-mail"),
        item("Great Maul", "great-maul"),
      ],
    },
  ],
  talents: [
    {
      ...base("lore-keeper", "Lore Keeper"),
      category: "gift",
      xp: {
        byChoice: [
          { xp: 2, when: "a scholar" },
          { xp: 5, when: "anyone else" },
        ],
      },
      requires: [{ kind: "skill", skill: "Lore", min: 2 }],
    },
    {
      ...base("favoured", "Favoured"),
      xp: { base: 3, plus: "a favour owed" },
      requires: [{ kind: "influence", min: 1 }],
      grants: [{ choose: 1, from: [{ talent: "hardy" }, { talent: "keen-sense" }], optional: true }],
    },
    {
      ...base("wanderer", "Wanderer"),
      xp: { perTier: 2 },
      repeatable: true,
      requires: [
        { kind: "notKeyword", anyOf: ["WARDEN"] },
        { kind: "notArchetype", anyOf: ["old-guard"] },
        {
          kind: "all",
          of: [
            { kind: "notSpecies", anyOf: ["giantkin"] },
            { kind: "rank", min: 1 },
          ],
        },
      ],
      grants: [{ keyword: "WANDERER" }],
    },
    {
      ...base("weapon-focus", "Weapon Focus"),
      xp: 3,
      options: ["Hand Axe", "Hunting Bow", "Sling"],
      repeatable: "perChoice",
      requires: [{ kind: "chosenSkill", min: 1 }],
      weapons: [
        { fits: { chosen: true }, mods: [{ kind: "damage", delta: { perRank: 1 } }] },
        { fits: { unarmed: true }, mods: [{ kind: "ed", delta: 1 }] },
      ],
    },
    {
      // options that fold differently in full Unicode: İ lowers to i and a combining dot, a final Σ to ς
      ...base("iron-will", "Iron Will"),
      xp: 1,
      options: ["İron", "ΣΤΑΣΙΣ"],
      repeatable: "perChoice",
    },
    {
      ...base("strong-arm", "Strong Arm"),
      xp: 3,
      options: ["Might", "AGI"],
      requires: [{ kind: "chosenAttribute", min: 3 }],
      mods: { maxHealth: 1 },
    },
    {
      ...base("gifted-sight", "Gifted Sight"),
      category: "gift",
      xp: 4,
      requires: [
        { kind: "talentCategory", category: "gift", min: 2 },
        { kind: "power", anyOf: ["spark"] },
      ],
    },
    {
      ...base("pyromancer", "Pyromancer"),
      category: "gift",
      xp: 5,
      requires: [{ kind: "powerCount", min: 2, sameDiscipline: true }],
      grants: [{ power: "kindle" }],
    },
    {
      ...base("kit-bearer", "Kit Bearer"),
      xp: 2,
      requires: [
        { kind: "wargear", anyOf: ["ROPE"] },
        { kind: "wargearKeyword", anyOf: ["TOOL"] },
        { kind: "wargearCount", of: { kinds: ["weapon"], weapon: "melee" }, min: 1 },
      ],
    },
    {
      ...base("veteran", "Veteran"),
      xp: 6,
      requires: [
        { kind: "rank", min: 2 },
        { kind: "memorableInjuries", min: 1 },
        { kind: "memorableInjuries", max: 2 },
        { kind: "subFaction", anyOf: ["ironhand"] },
        { kind: "option", groupId: "marks", anyOf: ["Wing Mark"] },
        { kind: "talent", anyOf: ["hardy"] },
        { kind: "notTalent", anyOf: ["wanderer"] },
        { kind: "species", anyOf: ["heron-kin"] },
        { kind: "archetype", anyOf: ["lamplighter"] },
        { kind: "tier", max: 2 },
        { kind: "power", anyOf: ["ebb"] },
        { kind: "powerCount", min: 1 },
        { kind: "talentCategory", category: "talent", min: 3 },
      ],
    },
    {
      ...base("seer-sight", "Seer Sight"),
      xp: 3,
      requires: [{ kind: "keyword", anyOf: ["SEER"] }],
      grants: [{ keyword: "FARSEER" }],
    },
    { ...extra("outsider", "Outsider"), xp: 1, grants: [{ keyword: "OUTSIDER" }] },
    {
      ...base("camp-cook", "Camp Cook"),
      xp: 1,
      grants: [
        {
          all: [{ keyword: "COOK" }, { wargear: { name: "Pot", mundane: true } }],
          requires: [{ kind: "keyword", anyOf: ["DRIFTER"] }],
        },
        { pick: 1, wargearOf: { kinds: ["equipment"] }, requires: [{ kind: "attribute", attribute: "WIT", min: 3 }] },
        {
          // a gated grant whose own part is gated again: the list being walked grows
          all: [
            { talent: "toughened" },
            { wargear: { name: "Stew Pot", mundane: true }, requires: [{ kind: "rank", min: 1 }] },
          ],
          requires: [{ kind: "tier", min: 1 }],
        },
        // gated on what an earlier gated grant gave: the character is read again for each one
        { all: [{ keyword: "CHEF" }], requires: [{ kind: "keyword", anyOf: ["COOK"] }] },
      ],
    },
    {
      ...base("bird-friend", "Bird Friend"),
      xp: 2,
      grants: [{ followers: 1, kind: "familiar", threatOf: { keywords: ["BIRD"], classes: ["beast"] } }],
    },
    {
      ...base("gm-favour", "GM's Favour"),
      xp: 2,
      requires: [
        { kind: "gm", id: "the-gm-likes-you", label: "The GM likes this character" },
        // an approval path cut at 200 UTF-16 units, inside the smile
        { kind: "gm", id: `${"x".repeat(173)}😀 long`, label: "A long story" },
        // a GM's condition inside an either: its label is left out of the path
        {
          kind: "either",
          of: [
            { kind: "gm", id: "sworn", label: "Swore to the GM" },
            { kind: "rank", min: 3 },
          ],
        },
      ],
      grants: [{ talent: "strong-arm" }],
    },
    {
      // 97 units, so the weapon effect's source, name and choice, is cut at 100 inside the choice
      ...base("long-focus", "Focus".padEnd(97, ".")),
      xp: 1,
      options: ["😀 stone", "Sling"],
      weapons: [{ fits: { chosen: true, weapon: "melee" }, mods: [{ kind: "ap", delta: -1 }] }],
    },
  ],
  packages: [
    {
      ...base("ember-ascent", "Ember Ascent"),
      kind: "ascension",
      xp: { perTier: 4 },
      influence: 1,
      requires: [{ kind: "attribute", attribute: "WIT", min: 3 }],
      grants: [
        { keyword: "ASCENDED" },
        { mods: { maxHealth: { perTier: 2 } } },
        item("Twin Blades", "twin-blades"),
        { keyword: "BANNERED" },
      ],
      weapons: [{ fits: { granted: true }, mods: [{ kind: "trait", traitId: "keen" }] }],
      becomesArchetypeId: "pyre-lord",
    },
    {
      ...base("kindred-rite", "Kindred Rite"),
      kind: "advancement",
      xp: { atCreation: 4, later: 8 },
      notAtCreation: true,
      atCreationWith: "SOOT",
      grants: [{ choose: 1, from: [{ keyword: "SOOT" }, { keyword: "ASH" }] }],
    },
    {
      ...base("patron", "Patron"),
      kind: "advancement",
      xp: {
        byChoice: [
          { xp: 3, when: "a small patron" },
          { xp: 9, when: "a great one" },
        ],
      },
      becomesArchetypeId: "nobody",
      grants: [{ attribute: ["MGT", "AGI"], add: 1 }],
    },
    { ...extra("hidden-path", "Hidden Path"), kind: "ascension", xp: 3, grants: [{ keyword: "HIDDEN" }] },
  ],
  disciplines: [{ ...base("shadows", "Shadows"), requires: [{ kind: "keyword", anyOf: ["MYSTIC"] }] }],
  powers: [
    {
      ...base("veil", "Veil"),
      disciplineId: "shadows",
      alsoIn: ["tides"],
      xp: { perTier: 2 },
      dn: "Opposed",
      activation: "Action",
      duration: "Scene",
      range: "Self",
      multiTarget: "up to three",
      requires: [{ kind: "skill", skill: "Sneak", min: 2 }],
    },
    {
      ...base("flare", "Flare"),
      disciplineId: "embers",
      xp: { base: 2, plus: "a candle" },
      dn: 2,
      activation: "Free",
      duration: "Instant",
      range: "4 m",
      multiTarget: true,
    },
    {
      // 10 XP at the Mystic's 0.3: 10 × 0.3 is 3.0000000000000004 in floating point, so Math.ceil makes it 4
      ...base("undertow", "Undertow"),
      disciplineId: "tides",
      xp: 25,
      dn: 3,
      activation: "Action",
      duration: "Instant",
      range: "10 m",
      multiTarget: false,
    },
    {
      ...extra("deep-tide", "Deep Tide"),
      disciplineId: "tides",
      xp: { atCreation: 5, later: 7 },
      dn: 5,
      activation: "Action",
      duration: "Round",
      range: "20 m",
      multiTarget: false,
    },
  ],
  languages: [
    { ...base("ash-speech", "Ash-speech"), keywords: ["ASH"] },
    { ...base("rook-caw", "Rook-caw"), keywords: ["ROOK"], xenos: true },
  ],
};

const merged = SAMPLE_CREATION_RAW as Record<string, unknown[]>;
export const WIDE_CREATION_RAW: Record<string, unknown[]> = Object.fromEntries(
  Object.entries(additions).map(([k, list]) => [k, [...(merged[k] ?? []), ...list]]),
);

const gear = (id: string, name: string, kind: string, value: number | null, rarity: string | null, more = {}) => ({
  ...base(id, name),
  category: kind === "weapon" ? "Arms" : "Kit",
  kind,
  value,
  rarity,
  ...more,
});

export const WIDE_WARGEAR_RAW: unknown[] = [
  ...SAMPLE_WARGEAR_RAW,
  gear("javelin", "Javelin", "weapon", 1, "Common", { weapon: { damage: 2, ed: 1, thrown: 4, addStrength: true } }),
  gear("ring-mail", "Ring Mail", "armour", null, "Common", {
    armour: { ar: 3, invulnerable: true, traits: ["+0x2 Pace"] },
  }),
  gear("glider", "Glider", "equipment", 2, null),
  gear("great-maul", "Great Maul", "weapon", 7, "Hard", {
    keywords: ["TOOL"],
    weapon: { damage: 6, ed: 2, range: [2], traits: ["Heavy (3)", "Slow"], count: 1, salvo: null },
  }),
  gear("ember-plate", "Ember Plate", "armour", 9, "Fabled", { armour: { ar: 18, powered: 4, traits: ["+1.5 Pace"] } }),
  {
    ...gear("spare-sling", "Spare Sling", "weapon", 1, "Common", {
      weapon: { damage: 1, ed: "d3", ap: -1, range: [6, 12, 18], mods: [{ kind: "range", multiply: 1.5 }] },
    }),
    source: "extra",
  },
];
