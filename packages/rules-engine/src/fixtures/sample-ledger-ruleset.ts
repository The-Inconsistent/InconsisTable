import { SAMPLE_PARAMS_INPUT } from "../build/fixtures/sample-ledger.ts";
import { LEDGER_KINDS, type LedgerKind, type RulesetInput } from "../manifest.ts";

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

export const SAMPLE_LEDGER_RULESET: RulesetInput = {
  id: "sample-ledger",
  version: "0.1.0",
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
      },
    },
    ...LEDGER_KINDS.map((k) => ({ id: SAMPLE_LEDGER_KINDS[k], label: k, base: "item" as const })),
  ],
  resources: [
    { id: "wealth", label: "Wealth", scope: "entity", entities: ["hero"], cite: "Base p.8" },
    { id: "corruption", label: "Corruption", scope: "entity", cite: "Base p.21" },
  ],
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
    cite: "Base p.1",
  },
};
