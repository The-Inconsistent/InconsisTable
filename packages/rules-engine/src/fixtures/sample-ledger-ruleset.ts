import { SAMPLE_PARAMS_INPUT } from "../build/fixtures/sample-ledger.ts";
import { LEDGER_KINDS, type ItemsBlock, type LedgerKind, type RulesetInput } from "../manifest.ts";

/**
 * A ruleset whose `hero` is built by the ledger builder (house decision #62), over the invented game of
 * build/fixtures/sample-ledger.ts. Every name, number and page is made up and points at no real book.
 */

const int = (label: string) => ({ type: "int", label, visibility: "party" }) as const;

/** The entity type that holds each kind of record. */
export const SAMPLE_LEDGER_KINDS: Record<LedgerKind, string> = {
  keywords: "keyword",
  factions: "faction",
  "sub-factions": "subFaction",
  species: "species",
  backgrounds: "background",
  "option-groups": "optionGroup",
  archetypes: "archetype",
  talents: "talent",
  packages: "package",
  disciplines: "discipline",
  powers: "power",
  languages: "language",
  wargear: "wargear",
};

const attributes = { MGT: "attr.mgt", AGI: "attr.agi", WIT: "attr.wit", PRE: "attr.pre" };
const skills = {
  Brawl: "skill.brawl",
  Climb: "skill.climb",
  Sneak: "skill.sneak",
  Dodge: "skill.dodge",
  Lore: "skill.lore",
  Craft: "skill.craft",
  Charm: "skill.charm",
  Command: "skill.command",
};
const mods = {
  maxHealth: "mod.maxHealth",
  maxNerve: "mod.maxNerve",
  guard: "mod.guard",
  grit: "mod.grit",
  influence: "mod.influence",
  speed: "mod.speed",
  notice: "mod.notice",
};

/**
 * Items a hero holds in play (house decision #95), proven on the catalogue's own gear: arms (one of each), fittings
 * fitted to arms (two on one, one per slot, a pair only by the GM), counted stores the holder spends, and kit, which
 * any other gear is. A GIVE hands over the gear a codex item names.
 */
export const SAMPLE_LEDGER_ITEMS = {
  kinds: [
    {
      id: "arms",
      label: "Arms",
      entry: "wargear",
      tag: "weapon",
      entities: ["hero"],
      card: "weapons",
      unique: true,
      max: 20,
      cite: "Base p.40",
    },
    {
      id: "fittings",
      label: "Fittings",
      entry: "wargear",
      tag: "upgrade",
      entities: ["hero"],
      fits: { to: ["arms"], max: 2, slot: "slot", gmTag: "pair" },
      cite: "Base p.41",
    },
    {
      id: "stores",
      label: "Stores",
      entry: "supply",
      entities: ["hero"],
      stacks: true,
      spend: true,
      cite: "Base p.42",
    },
    { id: "kit", label: "Kit", entry: "wargear", entities: ["hero"], card: "gear", cite: "Base p.40" },
  ],
  give: { ref: "of", loose: "kit" },
  // House decision #102: a hero procures gear by a Test against its rating, eased by every tag it shares with the
  // hero past the first; once a session for gear and once for stores; a miss topped up with coin, up to 3; stores
  // come three at a time, and a weapon that names its stores comes with one.
  acquire: {
    test: "procure",
    inputs: {
      dn: [
        { label: "Base", value: "8" },
        { label: "Rating", value: "item.rating" },
        { label: "Matched tags", value: "-max(0, overlap(item.tags, keywords) - 1)" },
      ],
      bonus: [{ label: "Push", value: "ctx.push" }],
    },
    picks: { push: { label: "Push", min: 0, max: "2" } },
    if: 'overlap(item.tags, keywords) > 0 || contains(item.tags, "open")',
    limits: [
      { kinds: ["arms", "fittings", "kit"], max: 1 },
      { kinds: ["stores"], max: 1 },
    ],
    topUp: { resource: "coin", max: "3" },
    quantity: "3",
    load: { field: "loads", quantity: "1" },
    cite: "Base p.43",
  },
} satisfies ItemsBlock;

export const SAMPLE_LEDGER_RULESET: RulesetInput = {
  id: "sample-ledger",
  // 0.1.1: the hero's Guard, gear with a slot, stores, the item codex field and the items block (house decision #95).
  // 0.1.2: the GM's override of the Guard, and what a build over a hand-made sheet keeps (house decision #96).
  // 0.1.3: procuring gear by a Test, coin to top a miss up, a gear rating and the stores a weapon loads (#102).
  version: "0.1.3",
  core: "^0.1.0",
  sources: [{ id: "base", title: "Sample Ledger Rules", license: "private" }],
  campaignFields: { tier: { type: "int", label: "Tier", min: 1, max: 4, default: 1, cite: "Base p.2" } },
  entities: [
    {
      id: "hero",
      label: "Hero",
      base: "actor",
      fields: {
        ...Object.fromEntries(
          [...Object.values(attributes), ...Object.values(skills), ...Object.values(mods)].map((id) => [id, int(id)]),
        ),
        armourRating: int("Armour"),
        powered: int("Powered"),
        speed: int("Speed"),
        species: { type: "text", label: "Species", visibility: "party" },
        archetype: { type: "text", label: "Archetype", visibility: "party" },
        keywords: { type: "list", label: "Keywords", visibility: "party" },
        xp: int("XP"),
        guardSet: { type: "int", label: "Guard set by the GM", visibility: "party" },
      },
      derived: [
        {
          id: "guard",
          label: "Guard",
          expr: "armourRating + mod.guard",
          visibility: "party" as const,
          override: "guardSet",
        },
      ],
    },
    ...LEDGER_KINDS.map((k) => ({
      id: SAMPLE_LEDGER_KINDS[k],
      label: k,
      base: "item" as const,
      ...(k === "wargear" && {
        fields: {
          slot: { type: "text" as const, label: "Slot", visibility: "party" as const },
          rating: { type: "int" as const, label: "Rating", visibility: "party" as const },
          loads: { type: "text" as const, label: "Loads", visibility: "party" as const },
        },
      }),
    })),
    {
      id: "supply",
      label: "Supply",
      base: "item",
      fields: { rating: { type: "int", label: "Rating", visibility: "party" } },
    },
  ],
  codex: {
    kinds: { item: { fields: { of: { type: "ref", label: "Gear", entity: "wargear", visibility: "gm" } } } },
  },
  items: SAMPLE_LEDGER_ITEMS,
  resources: [
    { id: "wealth", label: "Wealth", scope: "entity", entities: ["hero"], cite: "Base p.8" },
    { id: "corruption", label: "Corruption", scope: "entity", cite: "Base p.21" },
    {
      id: "coin",
      label: "Coin",
      scope: "entity",
      entities: ["hero"],
      start: "5",
      visibility: "party",
      editableBy: "ownerSpendOnly",
      cite: "Base p.9",
    },
  ],
  tests: {
    procure: {
      kind: "sumVsTarget",
      label: "Procure",
      dice: "1d20",
      target: "ctx.dn",
      modifier: "ctx.bonus",
      inputs: { dn: "int", bonus: "int" },
      inputLabels: { dn: "Number to beat", bonus: "Push" },
      entities: ["hero"],
      cite: "Base p.43",
    },
  },
  // Out of play for good: what leaves a hero out of the Ascension count.
  health: { states: [{ id: "lost", label: "Lost", when: "res.corruption >= 10", entities: ["hero"] }] },
  build: {
    strategy: "ledger",
    actor: "hero",
    params: SAMPLE_PARAMS_INPUT,
    kinds: SAMPLE_LEDGER_KINDS,
    sheet: {
      attributes,
      skills,
      mods,
      armourRating: "armourRating",
      powered: "powered",
      speed: "speed",
      species: "species",
      archetype: "archetype",
      keywords: "keywords",
      wealth: "wealth",
      corruption: "corruption",
    },
    tier: "tier",
    xp: "xp",
    ascension: { xp: 20, cite: "Base p.30" },
    gone: ["lost"],
    award: { max: 50, suggested: [5, 10, 20], cite: "Base p.31" },
    keep: { fields: ["armourRating"], resources: ["wealth"] },
    cite: "Base p.1",
  },
};
