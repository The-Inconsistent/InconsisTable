import {
  describeFilter,
  describeGrant,
  keywordsOnly,
  label,
  amount,
  capital,
  norm,
  ownerReqs,
  successors,
} from "./labels.ts";
import { isOfficial, sourceCite, sourceName, vocabOf, type BuildParams } from "./params.ts";
import { buyableKeywords, meets, wargearMatches, type BuildCtx } from "./requirements.ts";
import {
  Scaled,
  type Amount,
  buildSchemas,
  type Archetype,
  type BackgroundRowEntry,
  type BackgroundTable,
  type CharacterBuildInput,
  type Creation,
  type Grant,
  type Requirement,
  type Rule,
  type WargearItem,
  type WargearWeapon,
  type WeaponEffect,
  type XpCost,
} from "./schemas.ts";
import {
  purchaseKey,
  type BuildCatalogue,
  type BuildChoicePrompt,
  type BuildEffect,
  type BuildProblem,
  type BuildStep,
  type ChoicePick,
  type GearItem,
  type LedgerRow,
  type PendingChoice,
  type Purchase,
  type ResolvedBuild,
} from "./types.ts";
import { advancedWargearProblems, gearLine, sheetWeapon } from "./wargear.ts";

type Attribute = string;
type Skill = string;

// A rolled amount is played at the table, not added up here.
const numeric = (a: Amount): Scaled | undefined =>
  typeof a === "number" ||
  (typeof a === "object" && !("roll" in a) && Object.values(a).every((v) => typeof v === "number"))
    ? (a as Scaled)
    : undefined;

const rowsOf = (t: BackgroundTable, row: string) => (t[row] ?? []) as BackgroundRowEntry[];
const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((r) => [r.id, r]));
const indexes = new WeakMap<Creation, ReturnType<typeof indexOf>>();
function indexOf(c: Creation) {
  return {
    archetypes: byId(c.archetypes),
    species: byId(c.species),
    factions: byId(c.factions),
    subFactions: byId(c["sub-factions"]),
    keywords: new Map(c.keywords.map((k) => [k.name, k])),
    backgrounds: byId(c.backgrounds),
    optionGroups: byId(c["option-groups"]),
    talents: byId(c.talents),
    packages: byId(c.packages),
    disciplines: byId(c.disciplines),
    powers: byId(c.powers),
    languages: byId(c.languages),
  };
}
const index = (c: Creation) => indexes.get(c) ?? (indexes.set(c, indexOf(c)), indexes.get(c)!);

// ── the character as it is built up ──────────────────────────────────────────────────────────────────────────────────

type Origin = { path: string; step: BuildStep; cite: string; tiersAscended: number; granted: boolean };
type Deferred = {
  reqs: Requirement[];
  what: string;
  origin: Origin;
  severity: "error" | "gm";
  tier?: number;
  choice?: string;
};

type Sheet = {
  base: { attributes: Record<Attribute, number>; skills: Partial<Record<Skill, number>> };
  keywords: string[];
  abilities: { name: string; summary?: string; page?: string }[];
  talents: Map<string, { id: string; name: string; summary?: string; page: string; choices: (string | undefined)[] }>;
  powers: Set<string>;
  disciplines: Set<string>;
  only: Set<string> | null;
  mods: Record<string, number>;
  wealth: number;
  corruption: number; // what the build gives; play adds the rest
  gear: GearItem[];
  weapons: { name: string; weapon: WargearWeapon }[];
  // Standing weapon effects held (Auspex ruling §11.68), with the record's path, so a `granted` one finds its weapon
  weaponEffects: { effect: WeaponEffect; source: string; cite?: string; path: string; choice?: string }[];
  languageGrants: (number | { skill: Skill })[];
  influenceAttribute?: Attribute;
  xpDiscounts: { talents: Map<string, number>; disciplines: { id: string | undefined; multiplier: number }[] };
  neverKeywords: Set<string>;
  optionAccess: Set<string>;
  subFactionIds: string[];
};

// Resolves a build against a catalogue: the sheet it makes, what it costs (the ledger), what is still to choose
// (`pending`), what is wrong (`problems`, a `gm` one cleared by its path in `build.gm.approved`) and what the sheet has
// no field for (`effects`). Pure: it reads its arguments and nothing else, so two `params` on one catalogue give two
// ledgers. Ported from Auspex's builder with the same steps, orders and paths; every number, name and cite comes from
// `params`.
//
// Throws: `CharacterBuild.parse` rejects a build that is not shaped right (and so does `CharacterStats.parse` for the
// sheet it writes), as the source does; a caller that takes input from outside parses with `buildSchemas(params)` first.
//
// `play`: a character already in play: the campaign's Tier now and the XP it has earned. Without it, the build is priced
// as at creation. `xpAtAscension` is the character's XP when the group last Ascended, which a server's eligibility check
// reads; the build itself only prices what is bought. `packageWaived`: a Milestone Ascension may excuse the Ascension
// Package, so don't ask for one.
export function resolveBuild({
  params,
  catalogue,
  build: input,
  play,
}: {
  params: BuildParams;
  catalogue: BuildCatalogue;
  build: CharacterBuildInput;
  play?: { tier: number; xpEarned: number; xpAtAscension?: number; packageWaived?: boolean };
}): ResolvedBuild {
  const { CharacterBuild, CharacterStats } = buildSchemas(params);
  const vocab = vocabOf(params);
  const ATTRIBUTES = vocab.attributes;
  const SKILL_NAMES = vocab.skills;
  const ATTRIBUTE_NAMES = vocab.attributeNames;
  const official = (source: string) => isOfficial(params, source);
  const cite = (r: { source: string; page: number }) => sourceCite(params, r);
  const rankOf = (xp: number) => Math.min(params.rank.top, 1 + Math.floor(xp / params.rank.xpPerRank));
  // Raising a Skill with XP to R needs R Skills with points, that one included.
  const treeOfLearning = (skills: Partial<Record<string, number>>, skill: string, to: number) =>
    !params.treeOfLearning.enabled || Object.entries({ ...skills, [skill]: to }).filter(([, v]) => v! > 0).length >= to;
  const movementPattern = new RegExp(params.movementTrait);
  const movement = (armour: { traits: string[] }) =>
    Number(armour.traits.map((t) => movementPattern.exec(t)?.[1]).find(Boolean) ?? 0);
  const bonusName = (b: string) => params.vocabulary.mods.find((m) => m.key === b)?.label ?? capital(b);
  const build = CharacterBuild.parse(input);
  const ix = index(catalogue.creation);
  const tier = build.tier; // the Tier the character was made at
  const nowTier = Math.max(tier, play?.tier ?? tier);
  // Rank 1 at creation, also after a Creation Ascension; then one more per `xpPerRank` XP earned.
  const rank = play ? rankOf(play.xpEarned) : 1;
  const advanced = build.advanced;
  // No Archetype Ability, so the Tier × 10 bonus (Auspex ruling §11.127) is part of the budget.
  const budget =
    (build.budget ?? tier * params.startingXp.perTier) + (advanced ? tier * params.advanced.bonusXpPerTier : 0);
  const ledger: LedgerRow[] = [];
  const pending: PendingChoice[] = [];
  const choices: BuildChoicePrompt[] = [];
  const problems: BuildProblem[] = [];
  const effects: BuildEffect[] = [];
  const deferred: Deferred[] = [];
  const later: { grant: Grant; origin: Origin }[] = []; // grants gated on requirements, applied once the rest is known
  const approved = new Set(build.gm.approved);

  const problem = (p: BuildProblem) => {
    if (p.severity === "gm" && p.path && approved.has(p.path)) return;
    problems.push(p);
  };
  // The purchase history is a label on an advancement row and nothing else: no price, no problem and no sheet field
  // reads it, so a build resolves identically with and without it (§11.69). `~n` keeps two identical purchases apart.
  const copies = new Map<string, number>();
  const dated = (p: Purchase) => {
    const base = purchaseKey(p);
    const n = (copies.get(base) ?? 0) + 1;
    copies.set(base, n);
    const key = n > 1 ? `${base}~${n}` : base;
    return { key, session: build.advancement.boughtIn[key] };
  };
  const allowed = (r: { name: string; source: string; page: number }, step: BuildStep) => {
    if (catalogue.homebrew || official(r.source)) return true;
    problem({
      step,
      severity: "error",
      what: `${r.name} is homebrew (${sourceName(params, r.source)}), and this campaign allows none`,
      cite: cite(r),
    });
    return false;
  };
  const ownRules = <R extends Rule>(rules: R[]) =>
    rules.filter((r) => catalogue.homebrew || !r.source || official(r.source));

  const s: Sheet = {
    base: { attributes: Object.fromEntries(ATTRIBUTES.map((a) => [a, 1])) as Record<Attribute, number>, skills: {} },
    keywords: [],
    abilities: [],
    talents: new Map(),
    powers: new Set(),
    disciplines: new Set(),
    only: null,
    mods: {},
    wealth: tier * params.wealth.startingPerTier,
    corruption: 0,
    gear: [],
    weapons: [],
    weaponEffects: [],
    languageGrants: [],
    xpDiscounts: { talents: new Map(), disciplines: [] },
    neverKeywords: new Set(),
    optionAccess: new Set(),
    subFactionIds: [],
  };
  const addKeyword = (k: string) => {
    if (!s.keywords.includes(k)) s.keywords.push(k);
  };
  const addWeaponEffects = (
    list: WeaponEffect[] | undefined,
    at: { source: string; cite?: string; path: string; choice?: string },
  ) => list?.forEach((effect) => s.weaponEffects.push({ effect, ...at }));
  const addMods = (m: Partial<Record<string, Scaled>> | undefined, o: Origin) => {
    for (const [k, v] of Object.entries(m ?? {})) {
      s.mods[k] = (s.mods[k] ?? 0) + scaled(v!, o);
    }
  };
  const scaled = (v: Scaled, o: Origin): number => {
    if (typeof v === "number") return v;
    if ("perTier" in v) return v.perTier * o.tiersAscended;
    if ("timesTier" in v) return v.timesTier * nowTier;
    if ("perRank" in v) return v.perRank * rank + (v.plus ?? 0);
    return rank + v.rankPlus;
  };
  const addRule = (r: Rule, o: Origin) => {
    const page = r.page
      ? r.source
        ? cite({ source: r.source, page: r.page })
        : `${o.cite.split(" p.")[0]} p.${r.page}`
      : o.cite;
    s.abilities.push({ name: r.name, summary: r.summary, page });
    addMods(r.mods, o);
    addWeaponEffects(r.weapons, { source: r.name, cite: page, path: `${o.path}/${norm(r.name)}` });
    r.grants?.forEach((g, i) => grant(g, { ...o, path: `${o.path}/${norm(r.name)}/${i}` }));
  };

  const choiceFor = (path: string) => build.choices[path];
  const ask = (c: PendingChoice) => void pending.push(c);
  // A choice answered in `choices[path]`: always listed for the builder, and pending until `done`.
  const choose = (c: PendingChoice & { pick: ChoicePick }, done: boolean) => {
    choices.push({ ...c, answer: choiceFor(c.path) ?? [] });
    if (!done) pending.push(c);
  };

  // XP of a Talent, power or package at creation. "× the new Tier" is the campaign Tier.
  const price = (x: XpCost, { path, step, what }: { path: string; step: BuildStep; what: string }): number => {
    if (typeof x === "number") return x;
    if ("perTier" in x) return x.perTier * tier;
    if ("atCreation" in x) return x.atCreation;
    if ("base" in x) {
      problem({
        step,
        severity: "gm",
        path: `${path}/xp`,
        what: `${what} costs ${x.base} XP plus ${x.plus}: the GM adds it`,
      });
      return x.base;
    }
    const pick = choiceFor(`${path}/xp`)?.[0];
    const c = typeof pick === "number" ? x.byChoice[pick] : undefined;
    choose(
      {
        path: `${path}/xp`,
        step,
        what: `${what}: which price applies`,
        choose: 1,
        options: x.byChoice.map((b) => `${b.xp} XP: ${b.when}`),
        pick: { kind: "option" },
      },
      !!c,
    );
    return c?.xp ?? x.byChoice[0]!.xp;
  };

  // Ratings as they stand: granted, or bought up to (the ledger prices the difference once the grants are all in).
  const ratings = () => ({
    attributes: Object.fromEntries(
      ATTRIBUTES.map((a) => [
        a,
        Math.max(s.base.attributes[a]!, build.attributes[a] ?? 0, build.advancement.attributes[a] ?? 0),
      ]),
    ) as Record<Attribute, number>,
    skills: Object.fromEntries(
      SKILL_NAMES.map((k) => [
        k,
        Math.max(s.base.skills[k] ?? 0, build.skills[k] ?? 0, build.advancement.skills[k] ?? 0),
      ]).filter(([, v]) => (v as number) > 0),
    ) as Partial<Record<Skill, number>>,
  });

  // A Talent on the sheet, bought or granted, with its own mods and grants (once, however it arrives).
  const addTalent = (talentId: string, o: Origin, choice?: string) => {
    const t = ix.talents.get(talentId);
    if (!t) return problem({ step: o.step, severity: "error", what: `Unknown talent ${talentId}` });
    const have = s.talents.get(t.id);
    if (have) {
      if (o.granted) return;
      if (t.repeatable === false || (t.repeatable === "perChoice" && have.choices.includes(choice)))
        return problem({ step: o.step, severity: "error", what: `${t.name} is already taken`, cite: cite(t) });
      have.choices.push(choice);
      return;
    }
    if (t.options && o.granted && !choice) {
      const path = `${o.path}/choice`;
      const i = choiceFor(path)?.[0];
      choice = typeof i === "number" ? t.options[i] : undefined;
      choose(
        {
          path,
          step: o.step,
          what: `${t.name}: choose one`,
          choose: 1,
          options: t.options,
          cite: cite(t),
          pick: { kind: "option" },
        },
        !!choice,
      );
    }
    if ((t.repeatable === "perChoice" || t.options) && !choice && !o.granted)
      problem({ step: o.step, severity: "error", what: `${t.name}: choose what it applies to`, cite: cite(t) });
    if (t.options && choice && !t.options.some((x) => x.toLowerCase() === choice!.toLowerCase()))
      problem({
        step: o.step,
        severity: "error",
        what: `${t.name}: choose one of ${t.options.join(", ")}`,
        cite: cite(t),
      });
    s.talents.set(t.id, { id: t.id, name: t.name, summary: t.summary, page: cite(t), choices: [choice] });
    const to: Origin = { ...o, path: `talent/${t.id}`, cite: cite(t) };
    // A granted Talent whose requirements aren't met is the GM's to tick, not a refusal (Auspex ruling §11.53).
    deferred.push({ reqs: t.requires, what: t.name, origin: o, severity: o.granted ? "gm" : "error", choice });
    addMods(t.mods, to);
    addWeaponEffects(t.weapons, {
      source: choice ? `${t.name} (${choice})` : t.name,
      cite: cite(t),
      path: to.path,
      choice,
    });
    t.grants?.forEach((g, i) => grant(g, { ...to, path: `${to.path}/${i}` }));
  };

  const addItem = (item: WargearItem, o: Origin) => void s.gear.push({ ...item, from: o.path });

  // ── grants ──
  // `gated`: a grant with its own requirements waits in `later` until the character is known, then comes back gated.
  function grant(g: Grant, o: Origin, gated = false): void {
    if (!gated && "requires" in g && g.requires) return void later.push({ grant: g, origin: o });
    if ("all" in g) return g.all.forEach((x, i) => grant(x, { ...o, path: `${o.path}/${i}` }));
    if ("choose" in g && "from" in g) {
      const n = scaled(g.choose, o);
      const answer = (choiceFor(o.path) ?? []).filter((x): x is number => typeof x === "number" && x < g.from.length);
      choose(
        {
          path: o.path,
          step: o.step,
          what: g.optional ? `Choose up to ${n}` : `Choose ${n}`,
          choose: n,
          options: g.from.map(label),
          cite: o.cite,
          pick: { kind: "option" },
        },
        answer.length >= n || (g.optional && !!choiceFor(o.path)), // an optional choice answered [] is declined
      );
      if (!g.repeat && new Set(answer).size !== answer.length)
        problem({ step: o.step, severity: "error", what: "The same option was chosen twice", cite: o.cite });
      return answer.slice(0, n).forEach((j, k) => grant(g.from[j]!, { ...o, path: `${o.path}/${k}` }));
    }
    if ("choose" in g && "rating" in g) {
      const picked = (choiceFor(o.path) ?? []).filter(
        (x): x is Skill => typeof x === "string" && SKILL_NAMES.includes(x),
      );
      const bad = picked.filter((k) => g.skills && !g.skills.includes(k));
      if (bad.length)
        problem({
          step: o.step,
          severity: "error",
          what: `${bad.join(", ")} is not one of the Skills offered`,
          cite: o.cite,
        });
      const from = g.skills ?? SKILL_NAMES;
      choose(
        {
          path: o.path,
          step: o.step,
          what: `Raise ${g.choose} Skill${g.choose > 1 ? "s" : ""} to ${g.rating}`,
          choose: g.choose,
          options: [],
          of: from.join(", "),
          cite: o.cite,
          pick: { kind: "skill", from },
        },
        picked.length >= g.choose,
      );
      for (const k of picked.slice(0, g.choose)) s.base.skills[k] = Math.max(s.base.skills[k] ?? 0, g.rating);
      return;
    }
    if ("choose" in g && "fromDisciplines" in g) {
      const n = scaled(g.choose, o);
      const picked = (choiceFor(o.path) ?? []).filter((x): x is string => typeof x === "string");
      for (const p of picked.slice(0, n)) {
        const pw = ix.powers.get(p);
        if (!pw || ![pw.disciplineId, ...pw.alsoIn].some((d) => g.fromDisciplines.includes(d)))
          problem({
            step: o.step,
            severity: "error",
            what: `${pw?.name ?? p} is not in ${g.fromDisciplines.join(", ")}`,
            cite: o.cite,
          });
        else s.powers.add(pw.id);
      }
      choose(
        {
          path: o.path,
          step: o.step,
          what: g.random ? `Roll ${n} powers` : `Choose ${n} powers`,
          choose: n,
          options: [],
          of: `powers of ${g.fromDisciplines.join(", ")}`,
          cite: o.cite,
          pick: { kind: "power", disciplines: g.fromDisciplines },
        },
        picked.length >= n,
      );
      return;
    }
    if ("talent" in g) return addTalent(g.talent, { ...o, granted: true });
    if ("keyword" in g) return addKeyword(g.keyword);
    if ("keywords" in g) return g.keywords.forEach(addKeyword);
    if ("power" in g) return void s.powers.add(g.power);
    if ("wargear" in g) return addItem(g.wargear, o);
    if ("bundle" in g) return g.bundle.forEach((x) => addItem(x, o));
    if ("pick" in g) {
      const path = o.path;
      const n = scaled(g.pick, o);
      const picked = (choiceFor(path) ?? []).filter((x): x is string => typeof x === "string");
      for (const wid of picked.slice(0, n)) {
        const w = catalogue.wargear.get(wid);
        if (!w || !wargearMatches(w, g.wargearOf, { tier, newTier: tier }, params))
          problem({
            step: o.step,
            severity: "error",
            what: `${w?.name ?? wid} doesn't qualify for this pick`,
            cite: o.cite,
          });
        else addItem({ name: w.name, qty: 1, wargearId: w.id, scope: "character" }, o);
      }
      if (g.wargearOf.upgrade || g.wargearOf.condition)
        problem({
          step: o.step,
          severity: "gm",
          path: `${path}/condition`,
          what: `Wargear pick: ${g.wargearOf.upgrade ?? g.wargearOf.condition}`,
          cite: o.cite,
        });
      choose(
        {
          path,
          step: o.step,
          what: `Pick ${n} wargear`,
          choose: n,
          options: [],
          of: describeFilter(g.wargearOf),
          cite: o.cite,
          pick: { kind: "wargear", filter: g.wargearOf },
        },
        picked.length >= n,
      );
      return;
    }
    if ("weapon" in g) {
      const { name, range, ...w } = g.weapon;
      return void s.weapons.push({ name, weapon: { ...w, range } });
    }
    if ("wealth" in g) {
      const n = numeric(g.wealth);
      return void (n === undefined
        ? effects.push({ what: `Wealth ${amount(g.wealth)}`, cite: o.cite })
        : (s.wealth += scaled(n, o)));
    }
    if ("influence" in g) return void (s.mods.influence = (s.mods.influence ?? 0) + scaled(g.influence, o));
    if ("mods" in g) {
      const { armourRating, ...rest } = g.mods;
      if (armourRating !== undefined) s.mods.armourRating = (s.mods.armourRating ?? 0) + scaled(armourRating, o);
      return addMods(rest, o);
    }
    if ("attribute" in g) {
      const which = g.attribute;
      let targets: Attribute[];
      if (which === "lowest") {
        const min = Math.min(...ATTRIBUTES.map((a) => s.base.attributes[a]!));
        targets = ATTRIBUTES.filter((a) => s.base.attributes[a] === min).slice(0, 1);
      } else if (which === "any" || Array.isArray(which)) {
        const picked = (choiceFor(o.path) ?? []).filter(
          (x): x is Attribute => typeof x === "string" && ATTRIBUTES.includes(x),
        );
        const ok = picked.filter((a) => which === "any" || which.includes(a)).slice(0, 1);
        const from = which === "any" ? [...ATTRIBUTES] : which;
        choose(
          {
            path: o.path,
            step: o.step,
            what: "Choose an Attribute",
            choose: 1,
            options: [],
            of: which === "any" ? "any Attribute" : which.join(", "),
            cite: o.cite,
            pick: { kind: "attribute", from },
          },
          ok.length > 0,
        );
        targets = ok;
      } else targets = [which];
      for (const a of targets) {
        if (g.add !== undefined) s.base.attributes[a] = s.base.attributes[a]! + g.add;
        if (g.to !== undefined) s.base.attributes[a] = Math.max(s.base.attributes[a]!, g.to);
      }
      return;
    }
    if ("skills" in g && "add" in g)
      return g.skills.forEach((k) => (s.base.skills[k] = (s.base.skills[k] ?? 0) + g.add));
    if ("languages" in g) {
      s.languageGrants.push(
        typeof g.languages === "object" && "skill" in g.languages ? g.languages : scaled(g.languages, o),
      );
      if (g.xenos) effects.push({ what: "One of the granted languages is an alien one", cite: o.cite });
      return;
    }
    if ("disciplineAccess" in g) return g.disciplineAccess.forEach((d) => s.disciplines.add(d));
    // falls through: the limit is still listed in effects
    if ("onlyDisciplines" in g && (!g.untilTier || nowTier < g.untilTier)) s.only = new Set(g.onlyDisciplines);
    if ("chooseDisciplines" in g) {
      // Under `onlyDisciplines` the Species' choice is what's left of those; an archetype that grants its one discipline
      const only = s.only && [...s.only].filter((d) => !s.disciplines.has(d) && (!g.from || g.from.includes(d)));
      if (only?.length === 0) return;
      const from = only ?? g.from;
      const picked = (choiceFor(o.path) ?? []).filter(
        (x): x is string => typeof x === "string" && ix.disciplines.has(x),
      );
      const ok = picked.filter((d) => !from || from.includes(d)).slice(0, g.chooseDisciplines);
      ok.forEach((d) => s.disciplines.add(d));
      choose(
        {
          path: o.path,
          step: o.step,
          what: `Choose ${g.chooseDisciplines} Discipline${g.chooseDisciplines > 1 ? "s" : ""}`,
          choose: g.chooseDisciplines,
          options: [],
          of: from?.join(", ") ?? "any Discipline you may learn",
          cite: o.cite,
          pick: { kind: "discipline", from: from ?? null },
        },
        ok.length >= g.chooseDisciplines,
      );
      return;
    }
    if ("optionAccess" in g) return void s.optionAccess.add(g.optionAccess);
    if ("neverKeyword" in g) return void s.neverKeywords.add(g.neverKeyword);
    if ("loseKeyword" in g) {
      const k = g.loseKeyword === params.keywords.any ? (choiceFor(o.path)?.[0] as string | undefined) : g.loseKeyword;
      if (g.loseKeyword === params.keywords.any)
        choose(
          {
            path: o.path,
            step: o.step,
            what: "Choose the Keyword you lose",
            choose: 1,
            options: [],
            of: "one of your Keywords",
            cite: o.cite,
            pick: { kind: "keyword" },
          },
          !!k,
        );
      if (k) s.keywords = s.keywords.filter((x) => x !== k);
      return;
    }
    if ("influenceAttribute" in g) return void (s.influenceAttribute = g.influenceAttribute);
    if ("xpDiscount" in g) {
      const d = g.xpDiscount;
      if ("talent" in d) return void s.xpDiscounts.talents.set(d.talent, d.xp);
      const disc = d.discipline ?? (choiceFor(o.path)?.[0] as string | undefined);
      if (!d.discipline)
        choose(
          {
            path: o.path,
            step: o.step,
            what: "Choose the Discipline you learn cheaper",
            choose: 1,
            options: [],
            of: "a Discipline",
            cite: o.cite,
            pick: { kind: "discipline", from: null },
          },
          !!disc,
        );
      return void s.xpDiscounts.disciplines.push({ id: disc, multiplier: d.multiplier });
    }
    if ("story" in g) return problem({ step: o.step, severity: "gm", path: o.path, what: g.story, cite: o.cite });
    // Corruption the build gives is counted. A rolled amount is the table's to roll, and a loss the GM's to take, so
    // both stay listed.
    const fixedCorruption = "corruption" in g ? Scaled.safeParse(g.corruption) : null;
    const gained = fixedCorruption?.success ? scaled(fixedCorruption.data, o) : 0;
    if (gained > 0) return void (s.corruption += gained);
    // Everything else happens in play, not on the sheet: list it so the builder shows it.
    effects.push({ what: describeGrant(g), cite: o.cite });
  }

  // ── species and archetype (or Advanced Creation: a species and no archetype) ──
  const arch = build.archetypeId === undefined ? undefined : ix.archetypes.get(build.archetypeId);
  if (!advanced && !arch) {
    problem({ step: "archetype", severity: "error", what: `Unknown archetype ${build.archetypeId}` });
    return {
      sheet: CharacterStats.parse({}),
      budget,
      spent: 0,
      ledger,
      pending,
      choices,
      problems,
      effects,
      advancement: null,
      who: { species: null, archetypeId: build.archetypeId ?? null, keywords: [], buyable: [] },
    };
  }
  const originOf = (a: Archetype): Origin => ({
    path: `archetype/${a.id}`,
    step: "archetype",
    cite: cite(a),
    tiersAscended: 0,
    granted: true,
  });
  if (arch) {
    allowed(arch, "archetype");
    if (arch.tier > tier)
      problem({
        step: "archetype",
        severity: "error",
        what: `${arch.name} is Tier ${arch.tier}, above the campaign's Tier ${tier}`,
        cite: params.cites.archetypeTier,
      });
    ledger.push({
      what: `${arch.name} (archetype, with its species)`,
      xp: arch.xp,
      cite: cite(arch),
      step: "archetype",
    });
  }

  const speciesId =
    build.gm.species ?? build.speciesId ?? (arch && arch.speciesIds.length === 1 ? arch.speciesIds[0] : undefined);
  if (!speciesId)
    ask({
      path: arch ? `archetype/${arch.id}/species` : "advanced/species",
      step: "archetype",
      what: "Choose a species",
      choose: 1,
      options: arch
        ? arch.speciesIds.map((x) => ix.species.get(x)?.name ?? x)
        : catalogue.creation.species.filter((x) => catalogue.homebrew || official(x.source)).map((x) => x.name),
      cite: arch ? undefined : params.cites.advancedCreation,
    });
  else if (arch && !build.gm.species && !arch.speciesIds.includes(speciesId))
    problem({
      step: "archetype",
      severity: "error",
      what: `${arch.name} is not open to ${ix.species.get(speciesId)?.name ?? speciesId}`,
      cite: cite(arch),
    });
  const species = speciesId ? ix.species.get(speciesId) : undefined;
  if (speciesId && !species) problem({ step: "archetype", severity: "error", what: `Unknown species ${speciesId}` });
  // Advanced Creation pays the species' own XP; an archetype's cost has it inside.
  if (advanced && species)
    ledger.push({
      what: `${species.name} (species)`,
      xp: species.xp,
      cite: `${cite(species)}, ${params.cites.advancedCreation}`,
      step: "archetype",
    });

  // The archetype's printed ratings already include the species'; what it doesn't print, the species gives.
  // Advanced Creation starts every Attribute at 1 and every Skill at 0, and the species' own ratings, which
  // its XP paid for, stand (Auspex ruling §11.126).
  for (const a of ATTRIBUTES) s.base.attributes[a] = arch?.attributes[a] ?? species?.attributes[a] ?? 1;
  for (const k of SKILL_NAMES) {
    const v = arch?.skills[k] ?? species?.skills[k];
    if (v) s.base.skills[k] = v;
  }
  if (species) {
    allowed(species, "archetype");
    const so: Origin = {
      path: `species/${species.id}`,
      step: "archetype",
      cite: cite(species),
      tiersAscended: 0,
      granted: true,
    };
    ownRules(species.abilities).forEach((r) => addRule(r, so));
    // Species Keywords are Advanced Creation's (Auspex ruling §11.141): an archetype prints its own, so its species'
    // keyword grants are skipped for it. The fixed ones stand beside a Faction, and the choices are asked only without one (§11.142).
    if (advanced) species.keywords.forEach(addKeyword);
    const asksKeywords = !!advanced && !advanced.factionId;
    species.grants.forEach((g, i) => {
      if (keywordsOnly(g) && !asksKeywords) return; // `i` stays the grant's index, so answers keep their paths
      grant(g, { ...so, path: `${so.path}/${i}` });
    });
  }
  if (arch) {
    const origin = originOf(arch);
    arch.keywords.forEach(addKeyword);
    ownRules(arch.abilities).forEach((r) => addRule(r, origin));
    arch.grants.forEach((g, i) => grant(g, { ...origin, path: `${origin.path}/${i}` }));
    arch.wargear.forEach((g, i) => grant(g, { ...origin, path: `${origin.path}/wargear/${i}` }));
    if (arch.influence) s.mods.influence = (s.mods.influence ?? 0) + arch.influence;
    deferred.push({ reqs: arch.requires, what: arch.name, origin, severity: "error" });
  }
  if (advanced) {
    const ao: Origin = {
      path: "advanced",
      step: "archetype",
      cite: params.cites.advancedCreation,
      tiersAscended: 0,
      granted: true,
    };
    // The optional Faction: the Keywords its record names; its Background tables and option groups are the
    // FACTION step's, offered by `factionId` as an archetype's are by its own (§11.140).
    if (advanced.factionId) {
      const faction = ix.factions.get(advanced.factionId);
      if (!faction)
        problem({
          step: "archetype",
          severity: "error",
          what: `Unknown faction ${advanced.factionId}`,
          cite: ao.cite,
        });
      else if (allowed(faction, "archetype")) {
        faction.keywords.forEach(addKeyword);
        effects.push({
          what: `${faction.name} Faction${faction.keywords.length ? `: ${faction.keywords.join(", ")}` : ""}`,
          cite: cite(faction),
        });
      }
    }
    // A bought Archetype Ability brings the ability alone: no Keywords, kit or Influence (§11.131). The GM must agree.
    if (advanced.abilityOf) {
      const from = ix.archetypes.get(advanced.abilityOf);
      if (!from)
        problem({
          step: "archetype",
          severity: "error",
          what: `Unknown archetype ${advanced.abilityOf}`,
          cite: ao.cite,
        });
      else if (allowed(from, "archetype")) {
        const path = `advanced/ability/${from.id}`;
        ledger.push({
          what: `${from.name} Archetype Ability`,
          xp: from.tier * params.advanced.abilityXpPerTier,
          cite: `${params.cites.advancedCreation}, ${cite(from)}`,
          step: "archetype",
        });
        problem({
          step: "archetype",
          severity: "gm",
          path,
          what: `Archetype Ability of ${from.name}: the GM agrees`,
          cite: params.cites.advancedCreation,
        });
        ownRules(from.abilities).forEach((r) => addRule(r, { ...ao, path, cite: cite(from) }));
      }
    }
    // The kit that replaces an Archetype's. Common clothing and a trinket come with it, and the sheet has no
    // line for either.
    const kit = advanced.wargear.map((w) => ({ id: w, w: catalogue.wargear.get(w) }));
    for (const { id: wid, w } of kit) {
      if (!w)
        problem({
          step: "archetype",
          severity: "error",
          what: `Unknown wargear ${wid}`,
          cite: params.cites.advancedWargear,
        });
      // An upgrade is fitted to a weapon or armour, not carried as a piece of the kit.
      else if (w.kind === "upgrade")
        problem({
          step: "archetype",
          severity: "error",
          what: `${w.name} is an upgrade, not Wargear`,
          cite: params.cites.advancedWargear,
        });
      else if (allowed(w, "archetype"))
        addItem(
          { name: w.name, qty: 1, wargearId: w.id, scope: "character" },
          { ...ao, path: `advanced/wargear/${w.id}` },
        );
    }
    for (const p of advancedWargearProblems(
      params,
      kit.flatMap((k) => (k.w ? [k.w] : [])),
      tier,
    ))
      problem({
        step: "archetype",
        severity: p.gm ? "gm" : "error",
        path: p.gm ? `advanced/wargear/${norm(p.what)}`.slice(0, 200) : undefined,
        what: p.what,
        cite: params.cites.advancedWargear,
      });
    effects.push({
      what: "Common clothing and one trinket from the Trinkets Table",
      cite: params.cites.advancedWargear,
    });
  }

  // ── packages: one Creation Ascension Package when the archetype's Tier is below the campaign's, and any
  // Advancement Packages bought at creation ──
  // An Advanced character has no Archetype Tier to ascend from: an Ascension Package bought at creation is the GM's to
  // allow (Auspex ruling §11.132), one at most.
  const tiersAscended = arch ? Math.max(0, tier - arch.tier) : 0;
  const ascensions = build.packages.filter((p) => ix.packages.get(p)?.kind === "ascension");
  if (arch && tiersAscended > 0 && ascensions.length === 0)
    ask({
      path: "ascension",
      step: "ascension",
      what: `Buy one Ascension Package (Tier ${arch.tier} → ${tier})`,
      choose: 1,
      options: [],
      of: "Ascension Packages",
      cite: params.cites.creationAscension,
    });
  if (ascensions.length > (tiersAscended > 0 || advanced ? 1 : 0))
    problem({
      step: "ascension",
      severity: "error",
      what: tiersAscended
        ? "Creation Ascension takes one Ascension Package"
        : arch
          ? `${arch.name} is already Tier ${tier}: no Creation Ascension`
          : "Advanced Creation takes one Ascension Package",
      cite: advanced ? params.cites.advancedCreation : params.cites.creationAscension,
    });
  const packageNames: string[] = [];
  for (const pid of build.packages) {
    const p = ix.packages.get(pid);
    if (!p) {
      problem({ step: "customise", severity: "error", what: `Unknown package ${pid}` });
      continue;
    }
    const step: BuildStep = p.kind === "ascension" ? "ascension" : "customise";
    if (!allowed(p, step)) continue;
    const po: Origin = {
      path: `package/${p.id}`,
      step,
      cite: cite(p),
      // An Advanced build's Ascension Package counts as one Tier Ascended for its "per Tier" grants (§11.132).
      tiersAscended: p.kind === "ascension" ? (advanced ? 1 : tiersAscended) : 0,
      granted: true,
    };
    if (advanced && p.kind === "ascension")
      problem({
        step,
        severity: "gm",
        path: `advanced/${po.path}`,
        what: `${p.name}: the GM agrees to an Ascension Package at Advanced Creation`,
        cite: params.cites.advancedCreation,
      });
    ledger.push({
      what: `${p.name} (${p.kind} package)`,
      xp: price(p.xp, { path: po.path, step, what: p.name }),
      cite: cite(p),
      step,
    });
    packageNames.push(p.name);
    s.mods.influence =
      (s.mods.influence ?? 0) +
      (typeof p.influence === "number" ? p.influence : p.influence.perTier * po.tiersAscended);
    p.grants.forEach((g, i) => grant(g, { ...po, path: `${po.path}/${i}` }));
    addWeaponEffects(p.weapons, { source: p.name, cite: cite(p), path: po.path });
    // Checked after the grants: `atCreationWith` turns on the kindred chosen (Auspex ruling §11.61).
    if (p.notAtCreation && !(p.atCreationWith && s.keywords.includes(p.atCreationWith)))
      problem({
        step,
        severity: "error",
        what: `${p.name} can't be taken at creation${p.atCreationWith ? `, except to gain ${p.atCreationWith}` : ""}`,
        cite: cite(p),
      });
    // An Ascension Package's requirements are met before Ascending, at the archetype's Tier (Auspex ruling §11.54).
    deferred.push({
      reqs: p.requires,
      what: p.name,
      origin: po,
      severity: "error",
      tier: p.kind === "ascension" ? (arch?.tier ?? tier) : tier,
    });
    if (p.becomesArchetypeId)
      effects.push({
        what: `Becomes ${ix.archetypes.get(p.becomesArchetypeId)?.name ?? p.becomesArchetypeId}`,
        cite: cite(p),
      });
  }

  // ── packages bought in play: Advancement Packages, and a single Ascension Package each time the group Ascends
  // (Auspex ruling §11.55). `campaign.ascend` raises the Tier by one, so each Tier since creation is one Ascension, and
  // the packages fill them in the order they were bought, each priced and checked at its own step. An Archetype
  // Ascension takes the step to its own Tier, so the packages skip that one. ──
  // ponytail: one Ascension per Tier, not a record of each; a Tier raised by more than one at once (campaign.update) reads
  // as one Ascension per Tier. Record each Ascension if a table does that.
  const ascendedTiers = nowTier - tier; // the Ascensions since creation; 0 when the group hasn't Ascended
  const archTo = build.advancement.archetypeAscension
    ? ix.archetypes.get(build.advancement.archetypeAscension.archetypeId)
    : undefined;
  const archStep = archTo && archTo.tier > tier && archTo.tier <= nowTier ? archTo.tier - tier : 0;
  // The Ascensions a package can take, oldest first: step n goes from Tier `tier + n - 1` to `tier + n`.
  const packageSteps = Array.from({ length: ascendedTiers }, (_, i) => i + 1).filter((n) => n !== archStep);
  let ascensionsTaken = 0; // Ascension Packages bought in play, one per Ascension
  for (const pid of build.advancement.packages) {
    const p = ix.packages.get(pid);
    if (!p) {
      problem({ step: "advance", severity: "error", what: `Unknown package ${pid}` });
      continue;
    }
    if (!allowed(p, p.kind === "ascension" ? "ascension" : "advance")) continue;
    // The Tier this package's Ascension reached; an Advancement Package's "new Tier" is the Tier now.
    let reached = nowTier;
    if (p.kind === "ascension") {
      const step = packageSteps[ascensionsTaken];
      ascensionsTaken += 1;
      if (ascendedTiers === 0)
        problem({
          step: "ascension",
          severity: "error",
          what: `${p.name}: the group is still Tier ${nowTier}, so there has been no Ascension`,
          cite: params.cites.creationAscension,
        });
      else if (step === undefined)
        problem({
          step: "ascension",
          severity: "error",
          what: `${p.name}: each Ascension takes one Ascension Package or an Archetype Ascension, and the group has Ascended ${ascendedTiers} time${ascendedTiers === 1 ? "" : "s"} since Tier ${tier}`,
          cite: params.cites.ascensionSteps,
        });
      else reached = tier + step;
    }
    const po: Origin = {
      path: `advance/package/${p.id}`,
      step: p.kind === "ascension" ? "ascension" : "advance",
      cite: cite(p),
      tiersAscended: p.kind === "ascension" ? 1 : 0,
      granted: true,
    };
    // "× the new Tier" is the Tier its Ascension reached, so a package bought earlier keeps its price.
    ledger.push({
      what: `${p.name} (${p.kind} package)`,
      xp:
        typeof p.xp === "object" && "perTier" in p.xp
          ? p.xp.perTier * reached
          : price(p.xp, { path: po.path, step: "advance", what: p.name }),
      cite: cite(p),
      step: "advance",
      pool: "advancement",
      ...dated({ kind: "package", id: p.id }),
    });
    packageNames.push(p.name);
    s.mods.influence =
      (s.mods.influence ?? 0) +
      (typeof p.influence === "number" ? p.influence : p.influence.perTier * po.tiersAscended);
    p.grants.forEach((g, i) => grant(g, { ...po, path: `${po.path}/${i}` }));
    addWeaponEffects(p.weapons, { source: p.name, cite: cite(p), path: po.path });
    deferred.push({
      reqs: p.requires,
      what: p.name,
      origin: po,
      // An Ascension Package's requirements are met before Ascending, at the Tier the character leaves (§11.54).
      severity: "error",
      tier: p.kind === "ascension" ? reached - 1 : nowTier,
    });
    if (p.becomesArchetypeId)
      effects.push({
        what: `Becomes ${ix.archetypes.get(p.becomesArchetypeId)?.name ?? p.becomesArchetypeId}`,
        cite: cite(p),
      });
  }

  // ── Archetype Ascension (Auspex ruling §11.67): at an Ascension, in place of an Ascension Package, the
  // character takes an Archetype of their own Faction at the Tier Ascended to. It grants that Archetype's abilities,
  // Keywords, Wargear and Influence — and none of its Attribute or Skill ratings, which XP has to buy (below).
  // Everything the old Archetype gave stays, so the old one is applied above and never replaced. ──
  let ascendedTo: Archetype | undefined;
  const archAscension = build.advancement.archetypeAscension;
  if (archAscension) {
    const to = ix.archetypes.get(archAscension.archetypeId);
    if (!to) problem({ step: "ascension", severity: "error", what: `Unknown archetype ${archAscension.archetypeId}` });
    else if (allowed(to, "ascension")) {
      const path = `advance/archetype/${to.id}`;
      if (ascendedTiers === 0)
        problem({
          step: "ascension",
          severity: "error",
          what: `${to.name}: the group is still Tier ${nowTier}, so there has been no Ascension`,
          cite: params.cites.creationAscension,
        });
      if (rank < params.archetypeAscension.minRank)
        problem({
          step: "ascension",
          severity: "error",
          what: `Archetype Ascension needs Rank ${params.archetypeAscension.minRank}; ${play?.xpEarned ?? 0} XP earned is Rank ${rank}`,
          cite: params.cites.archetypeAscensionRank,
        });
      // An Advanced character has no Archetype, so no Faction to stay in (§11.133).
      if (!arch || to.factionId !== arch.factionId)
        problem({
          step: "ascension",
          severity: "error",
          what: arch
            ? `${to.name} is not an Archetype of ${arch.name}'s Faction`
            : `${to.name}: an Advanced character has no Archetype to ascend from`,
          cite: params.cites.archetypeAscension,
        });
      // The Tier of one of the group's Ascensions since creation, which is the one this takes.
      if (ascendedTiers > 0 && !archStep)
        problem({
          step: "ascension",
          severity: "error",
          what: `${to.name} is Tier ${to.tier}, not a Tier the group Ascended to (${tier + 1}–${nowTier})`,
          cite: params.cites.archetypeAscension,
        });
      if (speciesId && !build.gm.species && !to.speciesIds.includes(speciesId))
        problem({
          step: "ascension",
          severity: "error",
          what: `${to.name} is not open to ${species?.name ?? speciesId}`,
          cite: cite(to),
        });
      // The new Archetype is for a story reason, with the GM's agreement (§11.67).
      problem({
        step: "ascension",
        severity: "gm",
        path,
        what: `Archetype Ascension to ${to.name}: the GM agrees`,
        cite: params.cites.archetypeAscension,
      });
      // 0 XP of its own: what it costs is the Ascension slot it takes and the ratings bought to match. It
      // is on the ledger so the history can date it and ADVANCE says what the Ascension went on (§11.69).
      ledger.push({
        what: `${to.name} (Archetype Ascension)`,
        xp: 0,
        cite: params.cites.archetypeAscension,
        step: "ascension",
        pool: "advancement",
        ...dated({ kind: "ascension", archetypeId: to.id }),
      });
      const ao: Origin = { path, step: "ascension", cite: cite(to), tiersAscended: 1, granted: true };
      to.keywords.forEach(addKeyword);
      ownRules(to.abilities).forEach((r) => addRule(r, ao));
      to.grants.forEach((g, i) => grant(g, { ...ao, path: `${ao.path}/${i}` }));
      to.wargear.forEach((g, i) => grant(g, { ...ao, path: `${ao.path}/wargear/${i}` }));
      if (to.influence) s.mods.influence = (s.mods.influence ?? 0) + to.influence;
      deferred.push({ reqs: to.requires, what: to.name, origin: ao, severity: "error", tier: to.tier });
      packageNames.push(to.name); // the sheet names both: the character keeps what the old Archetype gave
      ascendedTo = to;
    }
  }

  // Each Ascension's second step: an Ascension Package or an Archetype Ascension, unless the GM waived it on a
  // Milestone Ascension (step 2), which is always the latest one.
  const open = packageSteps[ascensionsTaken];
  if (open !== undefined && !(play?.packageWaived && open === ascendedTiers))
    ask({
      path: "advance/ascension",
      step: "ascension",
      what: `Buy one Ascension Package (Tier ${tier + open - 1} → ${tier + open})`,
      choose: 1,
      options: [],
      of: "Ascension Packages",
      cite: params.cites.creationAscension,
    });

  // ── background: three rows, one bonus (Auspex ruling §11.22) ──
  const bg = build.background;
  if (!bg)
    ask({
      path: "background",
      step: "faction",
      what: "Choose a Background table",
      choose: 1,
      options: [],
      of: "your faction's, species' or sub-faction's",
      cite: params.cites.background,
    });
  else {
    const table = ix.backgrounds.get(bg.tableId);
    if (!table) problem({ step: "faction", severity: "error", what: `Unknown background table ${bg.tableId}` });
    else if (allowed(table, "faction")) {
      const to: Origin = {
        path: `background/${table.id}`,
        step: "faction",
        cite: cite(table),
        tiersAscended: 0,
        granted: true,
      };
      const chosen: string[] = [];
      for (const row of params.vocabulary.backgroundRows) {
        if (!rowsOf(table, row).length) continue;
        const name = bg[row];
        const r = name ? rowsOf(table, row).find((x) => x.name === name) : undefined;
        if (!name)
          ask({
            path: `${to.path}/${row}`,
            step: "faction",
            what: `Choose a${row === "origin" || row === "accomplishment" ? "n" : ""} ${capital(row)}`,
            choose: 1,
            options: rowsOf(table, row).map((x) => x.name),
            cite: to.cite,
          });
        else if (!r)
          problem({
            step: "faction",
            severity: "error",
            what: `${table.name} has no ${capital(row)} "${name}"`,
            cite: to.cite,
          });
        else {
          chosen.push(`${capital(row)} ${r.name}`);
          if (r.requires)
            deferred.push({ reqs: r.requires, what: `${capital(row)} ${r.name}`, origin: to, severity: "error" });
          if (bg.bonus === row) {
            if (r.bonus === "wealth") s.wealth += params.background.bonusAmount;
            else if (r.bonus === "corruption") s.corruption += params.background.bonusAmount;
            else if (r.bonus) s.mods[r.bonus] = (s.mods[r.bonus] ?? 0) + params.background.bonusAmount;
            r.grants?.forEach((g, i) => grant(g, { ...to, path: `${to.path}/${row}/${i}` }));
          }
        }
      }
      if (!bg.bonus)
        ask({
          path: `${to.path}/bonus`,
          step: "faction",
          what: "Choose which one Background bonus applies",
          choose: 1,
          options: [...params.vocabulary.backgroundRows],
          cite: params.cites.backgroundBonus,
        });
      if (chosen.length) {
        const b = bg.bonus ? rowsOf(table, bg.bonus).find((x) => x.name === bg[bg.bonus!]) : undefined;
        s.abilities.push({
          name: "Background",
          summary: `${chosen.join("; ")}.${b?.bonus ? ` Bonus: +${params.background.bonusAmount} ${bonusName(b.bonus)} (${capital(bg.bonus!)}).` : ""}`,
          page: to.cite,
        });
      }
      deferred.push({ reqs: ownerReqs(table.owner), what: table.name, origin: to, severity: "error" });
    }
  }

  const taken = new Map<string, number>();
  for (const [i, pick] of build.options.entries()) {
    const group = ix.optionGroups.get(pick.groupId);
    const opt = group?.options.find((x) => x.name === pick.name);
    if (!group || !opt) {
      problem({ step: "faction", severity: "error", what: `Unknown option ${pick.groupId}: ${pick.name}` });
      continue;
    }
    if (!allowed(group, "faction")) continue;
    const n = taken.get(group.id) ?? 0;
    taken.set(group.id, n + 1);
    const go: Origin = {
      path: `option/${group.id}/${i}`,
      step: "faction",
      cite: cite(group),
      tiersAscended: 0,
      granted: true,
    };
    const max = group.pick === "tier" ? tier : group.pick === "any" ? Infinity : group.pick;
    if (n + 1 > max)
      problem({ step: "faction", severity: "error", what: `${group.name}: at most ${max}`, cite: go.cite });
    if (opt.notAtCreation)
      problem({ step: "faction", severity: "error", what: `${opt.name} can't be taken at creation`, cite: go.cite });
    ledger.push({
      what: `${opt.name} (${group.name})`,
      xp: group.xp[Math.min(n, group.xp.length - 1)]!,
      cite: go.cite,
      step: "faction",
    });
    if (!s.optionAccess.has(group.id))
      deferred.push({ reqs: ownerReqs(group.owner), what: group.name, origin: go, severity: "error" });
    deferred.push({ reqs: opt.requires, what: opt.name, origin: go, severity: "error" });
    addRule(opt, go);
  }

  // ── what fills each [PLACEHOLDER], once every keyword is known ──
  const skipsGeneSeed = () => s.keywords.includes(params.keywords.geneSeedSkip);
  const filled = new Set<string>();
  for (const k of [...s.keywords]) {
    if (!k.startsWith(params.keywords.placeholderMarker)) continue;
    const kw = ix.keywords.get(k);
    const fill = build.fills[k];
    const fo: Origin = {
      path: `fill/${norm(k)}`,
      step: "faction",
      cite: kw ? cite(kw) : params.keywords.placeholderCite,
      tiersAscended: 0,
      granted: true,
    };
    const replace = (to: string) => {
      // "Any 2 Keywords" are two different ones (§11.133); a repeat would be listed once.
      if (k === params.keywords.anyTwo && s.keywords.includes(to))
        problem({
          step: "faction",
          severity: "error",
          what: `${k} repeats ${to}: the two Keywords differ`,
          cite: params.cites.advancedCreation,
        });
      filled.add(k);
      s.keywords = s.keywords.map((x) => (x === k ? to : x));
    };
    if (!fill) {
      const options = catalogue.creation["sub-factions"].filter(
        (x) => x.type === kw?.placeholder && (catalogue.homebrew || official(x.source)),
      );
      ask({
        path: fo.path,
        step: "faction",
        what: `Choose your ${k}`,
        choose: 1,
        options: [],
        of: kw?.writeIn
          ? `${options.map((x) => x.name).join(", ")}, or your own`
          : options.map((x) => x.name).join(", "),
        cite: fo.cite,
      });
    } else if ("writeIn" in fill) {
      if (!kw?.writeIn)
        problem({
          step: "faction",
          severity: "gm",
          path: fo.path,
          what: `${k} can't be written in; choose one the books print`,
          cite: params.cites.writeInKeyword,
        });
      replace(fill.writeIn);
    } else {
      const sf = ix.subFactions.get(fill.id);
      if (!sf || sf.type !== kw?.placeholder) {
        problem({
          step: "faction",
          severity: "error",
          what: `${sf?.name ?? fill.id} doesn't fill ${k}`,
          cite: fo.cite,
        });
        continue;
      }
      if (!allowed(sf, "faction")) continue;
      replace(sf.keyword);
      s.subFactionIds.push(sf.id, ...successors(sf, ix.subFactions));
      deferred.push({ reqs: sf.requires, what: sf.name, origin: fo, severity: "error" });
      const so: Origin = { ...fo, path: `subfaction/${sf.id}`, cite: cite(sf) };
      const founder = !sf.traits.length && sf.successorOf ? ix.subFactions.get(sf.successorOf) : undefined;
      for (const t of ownRules(founder?.traits ?? sf.traits))
        if (!(t.geneSeed && skipsGeneSeed() && !founder)) addRule(t, founder ? { ...so, cite: cite(founder) } : so);
    }
  }

  // ── GM rulings on this character ──
  build.gm.keywords.forEach(addKeyword);
  if (build.gm.species) effects.push({ what: `Species ${species?.name ?? build.gm.species} by the GM's ruling` });
  const removals = build.gm.gear.remove.map(norm);
  s.gear = s.gear.filter((g) => !removals.includes(norm(g.name)));
  build.gm.gear.add.forEach((g) =>
    addItem(g, { path: "gm", step: "archetype", cite: params.cites.gm, tiersAscended: 0, granted: true }),
  );

  // ── talents bought: at creation, then with the XP earned in play ──
  const pools = [
    { step: "customise" as BuildStep, pool: undefined, talents: build.talents, powers: build.powers },
    {
      step: "advance" as BuildStep,
      pool: "advancement" as const,
      talents: build.advancement.talents,
      powers: build.advancement.powers,
    },
  ];
  for (const { step, pool, talents } of pools)
    for (const t of talents) {
      const rec = ix.talents.get(t.id);
      if (!rec) {
        problem({ step, severity: "error", what: `Unknown talent ${t.id}` });
        continue;
      }
      if (!allowed(rec, step)) continue;
      const path = `${pool ? "advance/" : ""}talent/${rec.id}`;
      if (s.talents.has(rec.id) && rec.repeatable === false) {
        problem({ step, severity: "error", what: `${rec.name} is already taken`, cite: cite(rec) });
        continue;
      }
      ledger.push({
        what: `${rec.name}${t.choice ? ` (${t.choice})` : ""}`,
        xp: s.xpDiscounts.talents.get(rec.id) ?? price(rec.xp, { path, step, what: rec.name }),
        cite: cite(rec),
        step,
        pool,
        ...(pool ? dated({ kind: "talent", id: rec.id, choice: t.choice }) : {}),
      });
      addTalent(rec.id, { path, step, cite: cite(rec), tiersAscended: 0, granted: false }, t.choice);
    }

  const seen = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const k of [...s.keywords]) {
      const kw = ix.keywords.get(k);
      if (!kw || seen.has(k)) continue;
      seen.add(k);
      changed = true;
      kw.grants.forEach((g, i) =>
        grant(g, { path: `keyword/${kw.id}/${i}`, step: "customise", cite: cite(kw), tiersAscended: 0, granted: true }),
      );
    }
  }
  for (const k of s.neverKeywords)
    if (s.keywords.includes(k))
      problem({ step: "archetype", severity: "error", what: `This character can never have ${k}` });

  for (const { grant: g, origin } of later) {
    const reqs = ("requires" in g ? g.requires : undefined) ?? [];
    const c = ctx();
    if (reqs.every((r) => meets(r, c) === true)) grant(g, origin, true);
  }

  // ── powers bought: from a discipline the character may learn, at creation, then in play ──
  for (const { step, pool, powers } of pools)
    for (const pid of powers) {
      const p = ix.powers.get(pid);
      if (!p) {
        problem({ step, severity: "error", what: `Unknown power ${pid}` });
        continue;
      }
      if (!allowed(p, step)) continue;
      if (s.powers.has(p.id)) {
        problem({ step, severity: "error", what: `${p.name} is already known`, cite: cite(p) });
        continue;
      }
      const discs = [p.disciplineId, ...p.alsoIn];
      const known = discs.find((d) => s.disciplines.has(d) && (!s.only || s.only.has(d)));
      if (!known)
        problem({
          step,
          severity: "error",
          what: `${p.name} is from a Discipline you can't learn (${discs.join(", ")})`,
          cite: cite(p),
        });
      const disc = ix.disciplines.get(known ?? p.disciplineId);
      const discount = s.xpDiscounts.disciplines.find((d) => d.id && discs.includes(d.id))?.multiplier ?? 1;
      ledger.push({
        what: `${p.name} (power)`,
        xp: Math.ceil(
          (pool && typeof p.xp === "object" && "later" in p.xp
            ? p.xp.later
            : price(p.xp, { path: `power/${p.id}`, step, what: p.name })) * discount,
        ),
        cite: cite(p),
        step,
        pool,
        ...(pool ? dated({ kind: "power", id: p.id }) : {}),
      });
      s.powers.add(p.id);
      const po: Origin = { path: `power/${p.id}`, step, cite: cite(p), tiersAscended: 0, granted: false };
      deferred.push({ reqs: [...(disc?.requires ?? []), ...p.requires], what: p.name, origin: po, severity: "error" });
    }

  // ── ratings bought with XP ──
  const attributes = { ...s.base.attributes };
  const skills = { ...s.base.skills };
  for (const [a, to] of Object.entries(build.attributes) as [Attribute, number][]) {
    const from = s.base.attributes[a]!;
    if (to <= from) continue;
    attributes[a] = to;
    ledger.push({
      what: `${ATTRIBUTE_NAMES[a]} ${from} → ${to}`,
      xp: params.attributeXp.table[to]! - params.attributeXp.table[from]!,
      cite: params.attributeXp.cite,
      step: "customise",
    });
  }
  for (const [k, to] of Object.entries(build.skills) as [Skill, number][]) {
    const from = s.base.skills[k] ?? 0;
    if (to <= from) continue;
    skills[k] = to;
    ledger.push({
      what: `${k} ${from} → ${to}`,
      xp: params.skillXp.table[to]! - params.skillXp.table[from]!,
      cite: params.skillXp.cite,
      step: "customise",
    });
  }
  // In play: ratings raised from where creation left them, one row per rating point, which is how they are bought
  // and what the history is keyed by (§11.69). The XP is unchanged: the tables are cumulative.
  for (const [a, to] of Object.entries(build.advancement.attributes) as [Attribute, number][]) {
    const from = attributes[a]!;
    if (to <= from) continue;
    attributes[a] = to;
    for (let r = from + 1; r <= to; r++)
      ledger.push({
        what: `${ATTRIBUTE_NAMES[a]} ${r - 1} → ${r}`,
        xp: params.attributeXp.table[r]! - params.attributeXp.table[r - 1]!,
        cite: params.attributeXp.cite,
        step: "advance",
        pool: "advancement",
        ...dated({ kind: "attribute", attribute: a, rating: r }),
      });
  }
  const created = { ...skills };
  for (const [k, to] of Object.entries(build.advancement.skills) as [Skill, number][]) {
    const from = skills[k] ?? 0;
    if (to <= from) continue;
    skills[k] = to;
    for (let r = from + 1; r <= to; r++)
      ledger.push({
        what: `${k} ${r - 1} → ${r}`,
        xp: params.skillXp.table[r]! - params.skillXp.table[r - 1]!,
        cite: params.skillXp.cite,
        step: "advance",
        pool: "advancement",
        ...dated({ kind: "skill", skill: k, rating: r }),
      });
  }
  // Species maximums, for every rating however it was reached.
  for (const a of ATTRIBUTES) {
    const max = species?.max?.[a];
    if (max !== undefined && attributes[a]! > max)
      problem({
        step: "customise",
        severity: "error",
        what: `${ATTRIBUTE_NAMES[a]} ${attributes[a]} is over the ${species!.name} maximum of ${max}`,
        cite: params.cites.speciesMax,
      });
  }
  // The Tree of Learning, only for Skills raised with XP (Auspex ruling §11.52).
  for (const [k, to] of Object.entries(build.skills) as [Skill, number][])
    if (to > (s.base.skills[k] ?? 0) && !treeOfLearning(skills, k, to))
      problem({
        step: "customise",
        severity: "error",
        what: `${k} ${to} needs ${to} Skills with points (the Tree of Learning)`,
        cite: params.treeOfLearning.cite,
      });
  for (const [k, to] of Object.entries(build.advancement.skills) as [Skill, number][])
    if (to > (created[k] ?? 0) && !treeOfLearning(skills, k, to))
      problem({
        step: "advance",
        severity: "error",
        what: `${k} ${to} needs ${to} Skills with points (the Tree of Learning)`,
        cite: params.treeOfLearning.cite,
      });

  // Archetype Ascension: XP is spent until the Attributes and Skills equal or exceed the new Archetype's. The new
  // Archetype grants none of them, so the difference is bought above.
  if (ascendedTo) {
    const want = ascendedTo;
    const short = [
      ...ATTRIBUTES.filter((a) => attributes[a]! < (want.attributes[a] ?? 0)).map(
        (a) => `${ATTRIBUTE_NAMES[a]} ${attributes[a]} of ${want.attributes[a]}`,
      ),
      ...(Object.entries(want.skills) as [Skill, number][])
        .filter(([k, v]) => (skills[k] ?? 0) < v)
        .map(([k, v]) => `${k} ${skills[k] ?? 0} of ${v}`),
    ];
    if (short.length)
      problem({
        step: "ascension",
        severity: "error",
        what: `${want.name} needs ${short.join(", ")}`,
        cite: params.cites.archetypeAscension,
      });
  }

  // ── languages (Auspex ruling §11.48) ──
  const qualifying = catalogue.creation.languages.filter((l) => l.keywords.some((k) => s.keywords.includes(k)));
  const allowance =
    (qualifying.length ? params.languages.freeFromKeywords : 0) +
    s.languageGrants.reduce<number>((n, g) => n + (typeof g === "number" ? g : (skills[g.skill] ?? 0)), 0);
  const { picks, bought } = build.languages;
  if (picks.length > allowance)
    problem({
      step: "detail",
      severity: "error",
      what: `${picks.length} free languages; you have ${allowance}`,
      cite: params.languages.cite,
    });
  if (
    qualifying.length &&
    picks.length &&
    !picks.some((p) => qualifying.some((l) => l.id === p)) &&
    s.languageGrants.length === 0
  )
    problem({
      step: "detail",
      severity: "error",
      what: `Your free language comes from your Keywords: ${qualifying.map((l) => l.name).join(" or ")}`,
      cite: params.languages.cite,
    });
  if (picks.length < allowance)
    ask({
      path: "languages",
      step: "detail",
      what: `Choose ${allowance - picks.length} free language${allowance - picks.length > 1 ? "s" : ""}`,
      choose: allowance - picks.length,
      options: [],
      of: qualifying.map((l) => l.name).join(", ") || "any language",
      cite: params.languages.cite,
    });
  const learned = build.advancement.languages;
  for (const l of [...picks, ...bought, ...learned])
    if (!ix.languages.has(l))
      problem({
        step: "detail",
        severity: "gm",
        path: `language/${norm(l)}`,
        what: `A language the table doesn't list: ${l}`,
        cite: params.cites.writeInLanguage,
      });
  for (const l of bought)
    ledger.push({
      what: `${ix.languages.get(l)?.name ?? l} (language)`,
      xp: params.languages.xp,
      cite: params.languages.cite,
      step: "detail",
    });
  for (const l of learned)
    ledger.push({
      what: `${ix.languages.get(l)?.name ?? l} (language)`,
      xp: params.languages.xp,
      cite: params.languages.cite,
      step: "advance",
      pool: "advancement",
      ...dated({ kind: "language", name: l }),
    });
  const dupes = [...picks, ...bought, ...learned].filter((l, i, all) => all.indexOf(l) !== i);
  if (dupes.length) problem({ step: "detail", severity: "error", what: `${dupes.join(", ")} taken twice` });

  // ── Wealth bought (§11.51) ──
  if (build.wealth)
    ledger.push({
      what: `Wealth +${build.wealth}`,
      xp: build.wealth * params.wealth.xp,
      cite: params.wealth.cite,
      step: "detail",
    });
  s.wealth += build.wealth;

  // ── requirements, against the finished character ──
  function ctx(): BuildCtx {
    return {
      params,
      ...ratings(),
      keywords: new Set([...s.keywords, ...filled]),
      species: species ? [species.id, ...species.countsAs] : [],
      archetypeId: (ascendedTo ?? arch)?.id ?? null, // after an Archetype Ascension, the Archetype the character is now
      subFactionIds: new Set(s.subFactionIds),
      talents: new Set(s.talents.keys()),
      talentCategories: [...s.talents.keys()].map((t) => ix.talents.get(t)?.category ?? "talent"),
      powers: [...s.powers].map((p) => ix.powers.get(p)).filter((p) => p !== undefined),
      gear: s.gear,
      wargear: catalogue.wargear,
      options: build.options,
      influence:
        (s.influenceAttribute
          ? ratings().attributes[s.influenceAttribute]!
          : ratings().attributes[params.links.influence]!) -
        1 +
        (s.mods.influence ?? 0),
      rank,
      tier: nowTier,
    };
  }
  const final = ctx();
  for (const d of deferred)
    for (const r of d.reqs) {
      const why = meets(r, { ...final, tier: d.tier ?? nowTier, chosen: d.choice });
      if (why === true) continue;
      const gmOnly = typeof why === "object";
      const path =
        `${d.origin.path}/requires/${r.kind === "gm" ? r.id : norm(JSON.stringify(r, (k, x: unknown) => (k === "label" ? undefined : x)))}`.slice(
          0,
          200,
        );
      problem({
        step: d.origin.step,
        severity: gmOnly || d.severity === "gm" ? "gm" : "error",
        path,
        what: gmOnly ? `${d.what}: ${why.gm}` : `${d.what}${d.severity === "gm" ? " (granted)" : ""}: ${why}`,
        cite: d.origin.cite,
      });
    }

  // ── the sheet ──
  const spent = ledger.filter((r) => !r.pool).reduce((n, r) => n + r.xp, 0);
  const advanceSpent = ledger.filter((r) => r.pool).reduce((n, r) => n + r.xp, 0);
  const earned = play?.xpEarned ?? 0;
  if (advanceSpent > earned)
    problem({
      step: "advance",
      severity: "error",
      what: `${advanceSpent - earned} XP more than the ${earned} earned in play`,
      cite: params.cites.advancementXp,
    });
  if (spent > budget)
    problem({
      step: "customise",
      severity: "error",
      what: `${spent - budget} XP over the budget of ${budget}`,
      cite: params.startingXp.cite,
    });

  const armourItems = s.gear.map((g) => ({ g, w: g.wargearId ? catalogue.wargear.get(g.wargearId) : undefined }));
  // Worn armour: the best AR the character owns; only one suit counts at a time.
  const worn = armourItems.filter((x) => x.w?.armour).sort((a, b) => b.w!.armour!.ar - a.w!.armour!.ar)[0];
  const armour = worn
    ? {
        name: worn.g.name,
        ...worn.w!.armour!,
        ar: worn.w!.armour!.ar + (s.mods.armourRating ?? 0),
        // As printed, with the build's upgrade ids beside it, the way a weapon carries them: whoever shows the sheet
        // applies them on the way out, so storing the result would double-apply (§11.65).
        wargearId: worn.w!.id,
        upgrades: worn.g.upgrades?.length ? [...worn.g.upgrades] : undefined,
      }
    : { name: "", ar: s.mods.armourRating ?? 0, invulnerable: false, powered: 0, traits: [] };
  const strength = attributes[params.links.poweredArmour]! + armour.powered;
  const weapons = [
    ...s.weapons.map((w) => sheetWeapon(params, w, strength)),
    ...armourItems
      .filter((x) => x.w?.weapon)
      .map(({ g, w }) => {
        const base = sheetWeapon(params, { name: g.name, weapon: w!.weapon! }, strength);
        // The profile is stored as printed, with the upgrade ids beside it; the reader applies them on the way out.
        // Storing the result instead would double-apply the moment anything derived from the ids as well.
        return {
          ...base,
          count: typeof g.qty === "number" && g.qty > 1 ? g.qty : base.count,
          traits: [...base.traits, ...(g.traitIds ?? [])],
          wargearId: w!.id,
          upgrades: g.upgrades?.length ? [...g.upgrades] : undefined,
        };
      }),
  ];
  // The weapon effects as the sheet keeps them: a Talent's chosen weapon becomes its name, a record's granted weapon its
  // catalogue ids. One whose weapon isn't there (the GM swapped it out) reaches nothing, so it isn't kept.
  const weaponEffects = s.weaponEffects.flatMap(({ effect, source, cite, path, choice }) => {
    const { chosen, granted, unarmed, ...fits } = effect.fits;
    // ponytail: no sheet line for unarmed strikes, so an unarmed effect stays in its Talent's text; a line if one appears
    if (unarmed) return [];
    if (chosen && !choice) return [];
    const wargearIds = granted
      ? armourItems
          .filter((x) => x.w?.weapon && (x.g.from === path || x.g.from.startsWith(`${path}/`)))
          .map((x) => x.w!.id)
      : undefined;
    if (wargearIds && !wargearIds.length) return [];
    return [
      {
        source: source.slice(0, 100),
        cite: cite?.slice(0, 40),
        fits: { ...fits, ...(chosen && { names: [choice!] }), ...(wargearIds && { wargearIds }) },
        mods: effect.mods,
      },
    ];
  });
  const gear = armourItems
    .filter((x) => !x.w?.weapon && x !== worn)
    .map(({ g, w }) => {
      const qty = g.qty === 1 ? "" : ` ×${g.qty}`;
      return w ? `${gearLine(params, w)}${qty}` : `${g.name}${qty}`;
    });
  const mods: Record<string, number> = {};
  for (const k of vocab.modKeys) if (s.mods[k]) mods[k] = s.mods[k];
  if (s.influenceAttribute)
    mods.influence = (mods.influence ?? 0) + attributes[s.influenceAttribute]! - attributes[params.links.influence]!;
  if (movement(armour)) mods.speed = (mods.speed ?? 0) + movement(armour);
  for (const [k, v] of Object.entries(build.gm.mods) as [keyof typeof mods, number][])
    if (v) mods[k] = (mods[k] ?? 0) + v;
  const powers = [...s.powers].flatMap((p) => ix.powers.get(p) ?? []);
  for (const pw of powers) s.abilities.push({ name: pw.name, summary: pw.summary, page: cite(pw) });

  const clip = (r: { name: string; summary?: string; page?: string }) => ({
    name: r.name.slice(0, 100),
    summary: r.summary?.slice(0, 300),
    page: r.page?.slice(0, 40),
  });
  const sheet = CharacterStats.parse({
    species: species?.name ?? "",
    archetype: [arch?.name ?? "Advanced", ...packageNames].join(" + ").slice(0, 100),
    keywords: s.keywords.slice(0, 20),
    attributes,
    skills: Object.fromEntries(Object.entries(skills).filter(([, v]) => v! > 0)),
    armour,
    speed: species?.speed ?? params.defaultSpeed,
    mods,
    abilities: s.abilities.slice(0, 30).map(clip),
    talents: [...s.talents.values()]
      .flatMap((t) =>
        t.choices.map((c) => ({ name: c ? `${t.name} (${c})` : t.name, summary: t.summary, page: t.page })),
      )
      .slice(0, 30)
      .map(clip),
    weapons: weapons.slice(0, 20),
    gear: gear.slice(0, 60).map((g) => g.slice(0, 200)),
    weaponEffects: weaponEffects.length ? weaponEffects.slice(0, 60) : undefined,
    powers: powers.length
      ? powers.slice(0, 30).map((pw) => ({
          name: pw.name.slice(0, 100),
          page: cite(pw).slice(0, 40),
          dn: typeof pw.dn === "number" ? pw.dn : pw.dn.slice(0, 60),
          activation: pw.activation.slice(0, 60),
          duration: pw.duration.slice(0, 60),
          range: pw.range.slice(0, 60),
          summary: pw.summary?.slice(0, 300),
        }))
      : undefined,
    wealth: s.wealth,
    corruption: s.corruption,
  });
  const advancement = play ? { budget: earned, spent: advanceSpent, rank, tier: nowTier } : null;
  const self = {
    species: species ? final.species : null,
    archetypeId: final.archetypeId,
    keywords: [...final.keywords],
  };
  const who = {
    ...self,
    buyable: buyableKeywords(
      [...catalogue.creation.talents, ...catalogue.creation.packages].filter(
        (r) => catalogue.homebrew || official(r.source),
      ),
      self,
      params,
    ),
  };
  return { sheet, budget, spent, ledger, pending, choices, problems, effects, advancement, who };
}
