// Writes what the TypeScript ledger builder answers (packages/rules-engine/src/build), for its Go twin
// (internal/engine/ledger) to match. Generated on every `bun run test:go`, never committed. Every input comes from the
// invented game of the build fixtures (ADR 0001).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BuildParams } from "../../../packages/rules-engine/src/build/params.ts";
import {
  AdvancedBuild,
  Amount,
  BuildChoice,
  buildSchemas,
  RankAmount,
  Scaled,
  UpgradeMod,
  WargearItem,
  Weapon,
  WeaponMod,
  XpCost,
} from "../../../packages/rules-engine/src/build/schemas.ts";
import {
  SAMPLE_CREATION_RAW,
  SAMPLE_PARAMS_INPUT,
  SAMPLE_WARGEAR_RAW,
} from "../../../packages/rules-engine/src/build/fixtures/sample-ledger.ts";

const OUT = join(import.meta.dirname, "../internal/engine/testdata/ledger.json");

type Json = unknown;
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

// ── params: the sample game, and variants of it on the same catalogue ──

const P = SAMPLE_PARAMS_INPUT;
const PARAMS: Obj[] = [
  P,
  {
    ...P,
    startingXp: { perTier: 100, cite: "Other p.1" },
    attributeXp: { table: [0, 0, 5, 11, 20, 33, 50], cite: "Other p.2" },
    wealth: { ...P.wealth, xp: 3 },
  },
  { ...P, treeOfLearning: { enabled: false, cite: "Base p.7" } },
  { ...P, sources: { ...P.sources, list: [P.sources.list[0], { id: "extra", cite: "Extra", official: true }] } },
  { ...P, rarity: { ...P.rarity, order: [...P.rarity.order].reverse() } },
];
const PARSED = PARAMS.map((p) => BuildParams.parse(p));

// Each key dropped, nulled and given the wrong kind, an unknown key, and the keys in reverse: what zod strips, fills and
// refuses on any object.
function mutations(x: Json): Json[] {
  if (!isObj(x)) return [];
  const out: Json[] = [{ ...x, junk: 1 }, Object.fromEntries(Object.entries(x).reverse())];
  for (const k of Object.keys(x)) {
    const { [k]: _, ...rest } = x;
    out.push(rest, { ...x, [k]: null }, { ...x, [k]: typeof x[k] === "string" ? 7 : "x" });
  }
  return out;
}

function paramsVectors() {
  const inputs: Json[] = [
    ...PARAMS,
    { ...P, links: { influence: "XXX", poweredArmour: "MGT" } },
    { ...P, vocabulary: { ...P.vocabulary, mods: [{ key: "guard" }] } },
    { ...P, movementTrait: "(" },
    { ...P, tiers: { min: 3, max: 2 } },
    { ...P, rarity: { ...P.rarity, refused: ["Nope"] } },
    { ...P, vocabulary: { ...P.vocabulary, wargearKinds: ["weapon"] } },
    { ...P, vocabulary: { ...P.vocabulary, skills: [{ name: "Brawl", attribute: "XXX" }] } },
    { ...P, advanced: { ...P.advanced, wargear: { rows: [], cite: "x" } } },
    { ...P, attributeXp: { table: [0], cite: "x" } },
    ...mutations(P),
    ...Object.keys(P).flatMap((k) => mutations(P[k as keyof typeof P]).map((m) => ({ ...P, [k]: m }))),
  ];
  return inputs.map((input) => {
    const r = BuildParams.safeParse(input);
    return r.success ? { input, ok: true, parsed: r.data } : { input, ok: false };
  });
}

// ── parse: every schema buildSchemas returns, and the plain ones beside them ──

const SCALED: Json[] = [3, -2, 1.5, "3", null, [], {}, { perTier: 2 }, { timesTier: 1 }, { perRank: 1 }];
SCALED.push({ perRank: 1, plus: 2 }, { rankPlus: 1 }, { perTier: 2, timesTier: 3 }, { perTier: "d6" }, { plus: 1 });
SCALED.push({ perRank: 1, plus: 1.5 }, { rankPlus: 1, junk: true });
const AMOUNTS: Json[] = [...SCALED, "d6", "2d6+3", "d", "3d", { perTier: "d3" }, { roll: "d3", times: 2 }];
AMOUNTS.push({ roll: "d3", times: { perTier: 1 } }, { roll: 3, times: 2 }, { roll: "d3" }, { perTier: "d6", x: 1 });
const XP_COSTS: Json[] = [0, -1, 5, 2.5, { perTier: 0 }, { perTier: 2 }, { base: 3, plus: "a favour" }];
XP_COSTS.push({ base: 3, plus: "" }, { atCreation: 3, later: 6 }, { atCreation: 3 }, { later: 6, atCreation: 1 });
XP_COSTS.push(
  {
    byChoice: [
      { xp: 1, when: "a" },
      { xp: 2, when: "b" },
    ],
  },
  { byChoice: [{ xp: 1, when: "a" }] },
);
const WEAPON_MODS: Json[] = [
  { kind: "trait", traitId: "keen" },
  { kind: "trait", traitId: "keen", rating: 2 },
  { kind: "trait", traitId: "keen", rating: { perRank: 1, plus: 1 } },
  { kind: "trait", traitId: "" },
  { kind: "removeTrait", traitId: "slow", rating: 1 },
  { kind: "traitRating", traitId: "slow", delta: -1 },
  { kind: "damage", delta: { perRank: 2 } },
  { kind: "ed", delta: 1 },
  { kind: "ap", delta: -1 },
  { kind: "setAp", value: -2 },
  { kind: "setAp", value: 1 },
  { kind: "salvo", delta: 1 },
  { kind: "range", multiply: 1.5 },
  { kind: "range", multiply: 0 },
  { kind: "range", delta: 2, bands: [2, 4] },
  { kind: "range", bands: [] },
  { kind: "ar", delta: 1 },
  { kind: "ar", delta: 0.5 },
  { kind: "bonusDice", dice: 2, when: "in the dark" },
  { kind: "gm", what: "the GM's call" },
  { kind: "nope" },
  { delta: 1 },
];
const WEAPON = { name: "Stick", damage: 2, ed: "d3", range: [1], traits: ["Keen"] };
const WEAPONS: Json[] = [WEAPON, ...mutations(WEAPON), { ...WEAPON, range: [1, 2, 3, 4] }, { ...WEAPON, ap: 1 }];
WEAPONS.push({ ...WEAPON, salvo: null, countsStrength: true, mods: [{ kind: "ed", delta: 1 }], thrown: 2 });
const ITEMS: Json[] = [{ name: "Rope" }, { name: "Rope", qty: "d3" }, { name: "Rope", qty: 0 }, { name: "" }];
ITEMS.push({ name: "Bow", wargearId: "hunting-bow", upgrades: ["sight-lens"], traitIds: ["x"], scope: "group" });
ITEMS.push({ name: "Bow", mundane: true, upgrades: [], junk: 1 }, { name: "Bow", mundane: false });

const REQUIREMENTS: Json[] = [
  { kind: "attribute", attribute: "MGT", min: 3 },
  { kind: "attribute", attribute: "XXX", min: 3 },
  { kind: "attribute", attribute: "MGT", min: 7 },
  { kind: "skill", skill: "Lore", min: 2, label: "kept out" },
  { kind: "chosenAttribute", min: 2 },
  { kind: "chosenSkill", min: 2 },
  { kind: "influence", min: -1 },
  { kind: "keyword", anyOf: ["WARDEN", "[GUILD]"] },
  { kind: "keyword", anyOf: ["warden"] },
  { kind: "notKeyword", anyOf: ["DRIFTER"] },
  { kind: "species", anyOf: ["heron-kin"] },
  { kind: "species", anyOf: [] },
  { kind: "notSpecies", anyOf: ["stoneborn"] },
  { kind: "archetype", anyOf: ["lamplighter"] },
  { kind: "notArchetype", anyOf: ["wayfarer"] },
  { kind: "memorableInjuries", min: 1 },
  { kind: "memorableInjuries", max: 0 },
  { kind: "memorableInjuries" },
  { kind: "subFaction", anyOf: ["ironhand"] },
  { kind: "talent", anyOf: ["hardy"] },
  { kind: "notTalent", anyOf: ["hardy"] },
  { kind: "talentCategory", category: "gift", min: 1 },
  { kind: "talentCategory", category: "nope", min: 1 },
  { kind: "option", groupId: "marks", anyOf: ["Wing Mark"] },
  { kind: "power", anyOf: ["spark"] },
  { kind: "powerCount", min: 2 },
  { kind: "powerCount", min: 2, sameDiscipline: true },
  { kind: "wargear", anyOf: ["Rope"] },
  { kind: "wargearKeyword", anyOf: ["TOOL"] },
  { kind: "wargearCount", of: { kinds: ["weapon"], rarity: { atLeast: "Hard" } }, min: 1 },
  { kind: "wargearCount", of: { kinds: [] }, min: 1 },
  { kind: "rank", min: 2 },
  { kind: "tier", min: 2 },
  { kind: "tier", max: 9 },
  { kind: "tier" },
  { kind: "gm", id: "oath", label: "Swore an oath" },
  { kind: "gm", id: "oath" },
  {
    kind: "all",
    of: [
      { kind: "rank", min: 2 },
      { kind: "tier", min: 2 },
    ],
  },
  { kind: "all", of: [{ kind: "rank", min: 2 }] },
  {
    kind: "all",
    of: [
      { kind: "rank", min: 2 },
      { kind: "all", of: [] },
    ],
  },
  {
    kind: "either",
    of: [
      { kind: "rank", min: 2 },
      { kind: "all", of: [{ kind: "rank", min: 3 }, { kind: "tier" }] },
    ],
  },
  {
    kind: "either",
    of: [
      { kind: "rank", min: 2 },
      {
        kind: "all",
        of: [
          { kind: "rank", min: 3 },
          { kind: "tier", min: 2 },
        ],
      },
    ],
  },
  {
    kind: "either",
    of: [
      { kind: "rank", min: 2 },
      { kind: "either", of: [] },
    ],
  },
  { kind: "nope" },
  { min: 1 },
];

const FILTERS: Json[] = [
  {},
  { kinds: ["weapon", "armour"], weapon: "melee", categories: ["Arms"], nameIncludes: "axe", junk: 1 },
  { wargearKeywords: ["TOOL"], allKeywords: ["A", "B"], weaponTraits: ["Slow"], notWeaponTraits: ["Heavy (2)"] },
  { maxValue: 3 },
  { maxValue: { tierPlus: 1 } },
  { maxValue: { newTierPlus: -1 } },
  { maxValue: -1 },
  { rarity: {} },
  { rarity: { atMost: "Scarce", atLeast: "Common" } },
  { rarity: { atMost: "Nope" } },
  { upgrade: "a fitting", condition: "if the GM agrees" },
  { kinds: [] },
  { weapon: "thrown" },
];

// One of every grant, in the forms zod tells apart, and a few that land on another member than they look like.
export const GRANTS: Json[] = [
  { talent: "hardy" },
  { keyword: "SEER" },
  { keyword: "seer" },
  { keywords: ["SEER", "WARDEN"] },
  { keywords: ["SEER"] },
  { power: "spark" },
  { wargear: { name: "Rope", wargearId: "rope" } },
  { wargear: { name: "Rope" }, requires: [{ kind: "rank", min: 2 }] },
  { bundle: [{ name: "Rope" }, { name: "Brass Lens", wargearId: "lens", qty: 2 }] },
  { pick: 1, wargearOf: { kinds: ["equipment"] } },
  { pick: { perTier: 1 }, wargearOf: {}, requires: [{ kind: "keyword", anyOf: ["WARDEN"] }] },
  { weapon: { name: "Claws", damage: 1, ed: 1, range: [1] } },
  { weapon: { name: "Spit", damage: 1, ed: 1, range: [4, 8, 12], addStrength: true, thrown: 2 } },
  { weaponTrait: "Keen" },
  { trinkets: "d3" },
  { wealth: 2 },
  { wealth: { roll: "d3", times: 2 } },
  { influence: { perRank: 1 } },
  { corruption: 2 },
  { corruption: -1 },
  { corruption: "d6" },
  { faith: 1 },
  { languages: 1 },
  { languages: { skill: "Lore" }, xenos: true },
  { languages: { skill: "Nope" } },
  { memorableInjuries: 1 },
  { traumaticInjuries: { perTier: "d3" } },
  { mutations: 2 },
  { wrathPerSession: 1 },
  { wealthPerSession: { timesTier: 1 } },
  { ammoPer: "session", ammo: 2 },
  { ammoPer: "day", ammo: 2 },
  { mods: { guard: 1, armourRating: { perTier: 1 } } },
  { mods: { nope: 1 } },
  { attribute: "MGT", add: 1 },
  { attribute: ["MGT", "AGI"], to: 3 },
  { attribute: ["MGT"], add: 1 },
  { attribute: "any", add: 1 },
  { attribute: "lowest", add: 1, to: 9 },
  { chosenTrait: 1 },
  { skills: ["Lore"], add: 1 },
  { skills: ["Lore"], bonusDice: 1, when: "reading" },
  { optionAccess: "marks" },
  { neverKeyword: "SEER" },
  { never: "faith" },
  { gmRuin: { rankPlus: 1 } },
  { talentAccess: "gift", asKeyword: "SEER" },
  { disciplineAccess: ["tides"] },
  { loseKeyword: "[WILD]" },
  { influenceAttribute: "WIT" },
  { xpDiscount: { talent: "hardy", xp: 1 } },
  { xpDiscount: { discipline: "embers", multiplier: 0.5 } },
  { xpDiscount: { multiplier: 0.3 } },
  { xpDiscount: { multiplier: 1.5 } },
  { followers: 2, kind: "mob", threatId: "rats", variant: "big", threatOf: { keywords: ["VERMIN"] }, genericStats: 1 },
  { followers: 1, kind: "horde" },
  { bonusDice: 1, skills: ["Sneak"], when: "at night" },
  { chooseDisciplines: 1, from: ["embers", "tides"] },
  { chooseDisciplines: 0 },
  { onlyDisciplines: ["embers"], untilTier: 3 },
  { onlyDisciplines: ["embers"], untilTier: 1 },
  { noArmour: true },
  { noArmour: false },
  { choose: 2, fromDisciplines: ["embers"] },
  { choose: 1, fromDisciplines: ["embers"], random: true },
  { story: "Owes a debt" },
  { all: [{ keyword: "SEER" }, { faith: 1 }] },
  { all: [{ keyword: "SEER" }], requires: [{ kind: "keyword", anyOf: ["HARDENED"] }] },
  { all: [] },
  { choose: 2, rating: 2 },
  { choose: 1, rating: 9 },
  { choose: 1, rating: 2, skills: ["Lore", "Craft"] },
  { choose: 1, from: [{ keyword: "SEER" }, { all: [{ faith: 1 }] }] },
  { choose: { perTier: 1 }, from: [{ wealth: 1 }], optional: true, repeat: true },
  { choose: 1, from: [] },
  { choose: 1, from: [{ choose: 1, from: [{ faith: 1 }] }] },
  { choose: 1, rating: 2, from: [{ faith: 1 }] },
  { choose: 1, fromDisciplines: ["embers"], from: [{ faith: 1 }] },
  { talent: "hardy", keyword: "SEER" },
  {},
  "story",
];

const S0 = buildSchemas(PARSED[0]!);
const RULE = { name: "Light Bones", summary: "Invented.", mods: { guard: 1 }, grants: [{ faith: 1 }] };
const EFFECT = { fits: { weapon: "melee", chosen: true }, mods: [{ kind: "damage", delta: 1 }] };
const SHEET = S0.CharacterStats.parse({});

type Schema = { safeParse: (x: unknown) => { success: boolean; data?: unknown } };
const PLAIN: Record<string, [Schema, Json[]]> = {
  Scaled: [Scaled, SCALED],
  Amount: [Amount, AMOUNTS],
  XpCost: [XpCost, XP_COSTS],
  UpgradeMod: [UpgradeMod, WEAPON_MODS],
  WeaponMod: [WeaponMod, WEAPON_MODS],
  RankAmount: [RankAmount, SCALED],
  Weapon: [Weapon, WEAPONS],
  WargearItem: [WargearItem, ITEMS],
  BuildChoice: [BuildChoice, [[], [0, "a"], [-1], [""], [1.5], Array(21).fill(0), "x"]],
  AdvancedBuild: [AdvancedBuild, [{}, { factionId: "wardens", wargear: ["rope"] }, { wargear: ["Rope"] }, null]],
};

// The inputs each params-built schema reads, by name.
function samples(): Record<string, Json[]> {
  const raw = SAMPLE_CREATION_RAW;
  const records = (list: unknown[]) => list.flatMap((r) => [r, ...mutations(r)]);
  return {
    Tier: [0, 1, 4, 5, 2.5, "2"],
    Source: ["base", "extra", "nope"],
    Rarity: ["Common", "Fabled", "common"],
    WargearKind: ["upgrade", "vehicle"],
    Mods: [{}, { guard: 1, maxHealth: -2 }, { guard: 1.5 }, { nope: 1, notice: 2 }],
    Bonus: ["guard", "notice", "wealth", "corruption", "influence"],
    BackgroundRow: ["roots", "dream", "origin"],
    TalentCategory: ["talent", "gift", "nope"],
    SubFactionType: ["guild", "any", "order"],
    WargearFilter: FILTERS,
    WeaponEffect: [EFFECT, ...mutations(EFFECT), { fits: { unarmed: true, granted: false }, mods: [] }],
    RequirementOne: REQUIREMENTS,
    Requirement: REQUIREMENTS,
    Grant: GRANTS,
    Rule: [RULE, ...mutations(RULE), { name: "x", weapons: [EFFECT], source: "extra", page: 3 }],
    Keyword: records(raw.keywords),
    Faction: records(raw.factions),
    SubFaction: records(raw["sub-factions"]),
    Species: records(raw.species),
    BackgroundTable: records(raw.backgrounds),
    OptionGroup: records(raw["option-groups"]),
    Archetype: records(raw.archetypes),
    Talent: records(raw.talents),
    Package: records(raw.packages),
    Discipline: records(raw.disciplines),
    PsychicPower: records(raw.powers),
    Language: records(raw.languages),
    WargearWeapon: SAMPLE_WARGEAR_RAW.flatMap((w) => ("weapon" in w ? [w.weapon, ...mutations(w.weapon)] : [])),
    Wargear: records(SAMPLE_WARGEAR_RAW),
    SheetWeaponEffect: [{ source: "x", fits: { names: ["a"], wargearIds: ["b"] }, mods: [EFFECT.mods[0]] }],
    CharacterStats: [
      {},
      SHEET,
      ...mutations(SHEET),
      { ammo: Object.fromEntries([...Array(13).keys()].map((i) => [`a${i}`, 1])) },
    ],
    Advancement: [
      {},
      { attributes: { AGI: 3, MGT: 2 }, boughtIn: { b: 1, a: 2 } },
      { talents: [{ id: "x", choice: "" }] },
    ],
    CharacterBuild: [
      { tier: 1, archetypeId: "lamplighter" },
      { tier: 1, advanced: {} },
      { tier: 1 },
      { tier: 1, archetypeId: "lamplighter", advanced: {} },
      { tier: 1, archetypeId: "lamplighter", wealth: 4 },
      { tier: 1, archetypeId: "lamplighter", fills: { "[GUILD]": { id: "ironhand" }, guild: { writeIn: "X" } } },
      { tier: 1, archetypeId: "lamplighter", background: { tableId: "warden-roots", roots: "Lowland", bonus: "x" } },
      {
        tier: 2,
        archetypeId: "lamplighter",
        skills: { Sneak: 2, Brawl: 1 },
        attributes: { PRE: 3, MGT: 2 },
        choices: { "z/1": [1], "a/2": ["x"] },
        gm: { gear: { add: [{ name: "Rope" }] }, mods: { guard: 1 } },
        background: { tableId: "warden-roots", dream: "x", roots: "y", bonus: "deed", junk: 1 },
        languages: {},
      },
    ].flatMap((b) => [b, ...mutations(b)]),
  };
}

function parseVectors() {
  const cases: { params: number; schema: string; input: Json; ok: boolean; output?: Json }[] = [];
  const add = (params: number, schema: string, s: Schema, input: Json) => {
    const r = s.safeParse(input);
    cases.push(r.success ? { params, schema, input, ok: true, output: r.data } : { params, schema, input, ok: false });
  };
  for (const [name, [s, inputs]] of Object.entries(PLAIN)) for (const x of inputs) add(0, name, s, x);
  for (const [i, p] of PARSED.entries()) {
    const S = buildSchemas(p) as unknown as Record<string, Schema>;
    // every params variant on the schemas whose shape it changes, the sample on all of them
    const names = i === 0 ? Object.keys(S) : ["CharacterBuild", "Source", "Rarity", "Wargear"];
    const all = samples();
    for (const name of names) for (const x of all[name] ?? []) add(i, name, S[name]!, x);
  }
  return cases;
}

const vectors = { params: PARAMS, paramsCases: paramsVectors(), parse: parseVectors() };

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors));
console.log(`ledger vectors: ${vectors.paramsCases.length} params, ${vectors.parse.length} parse`);
