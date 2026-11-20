import {
  buildReady,
  meets,
  outOfReach,
  resolveBuild,
  type BuildCatalogue,
  type BuildChoicePrompt,
  type BuildCtx,
  type BuildParams,
  type BuildProblem,
  type BuildStep,
  type CharacterBuildInput,
  type LedgerCreation,
  type LedgerRequirement,
  type LedgerRow,
  type PendingChoice,
  type ResolvedBuild,
  type Who,
} from "@inconsistable/rules-engine";

// The ledger builder's screens (docs/adr/0011, stage 4): what a tap writes into the build document, and how the
// resolved build is arranged for display. Pure: the screens call these and pass the result to `onChange`.

// The engine's input type, with the Background spelled out: the schema builds that object from the params' column names,
// so its input type is only `{}`. One row name per column, and which column's bonus applies.
export type LedgerBackground = { tableId: string; bonus?: string | undefined; [row: string]: string | undefined };
export type LedgerBuild = Omit<CharacterBuildInput, "background"> & { background?: LedgerBackground | undefined };
export type LedgerPlay = NonNullable<Parameters<typeof resolveBuild>[0]["play"]>;

// The builder's steps in order. `BUILD_STEPS` is not exported by the engine, so the order is held here and checked
// against `BuildStep` by the `satisfies`: a step added there fails to compile here.
const STEP_ORDER = {
  tier: 0,
  archetype: 1,
  customise: 2,
  faction: 3,
  ascension: 4,
  detail: 5,
  advance: 6,
} as const satisfies Record<BuildStep, number>;
export const LEDGER_STEPS = Object.keys(STEP_ORDER) as BuildStep[];

// What a purchase lands on: the creation budget, or the XP earned in play (`build.advancement`).
export const LAYERS = ["creation", "advancement"] as const;
export type Layer = (typeof LAYERS)[number];
export const RATING_KINDS = ["attributes", "skills"] as const;
export type RatingKind = (typeof RATING_KINDS)[number];

// A build resolves once it names an Archetype or Advanced Creation (the schema refuses neither).
export const started = (b: LedgerBuild) => b.archetypeId !== undefined || b.advanced !== undefined;

// Resolves on the device. A build the engine refuses (a malformed document) is the error text, never a throw.
export function resolveDraft({
  params,
  catalogue,
  build,
  play,
}: {
  params: BuildParams;
  catalogue: BuildCatalogue;
  build: LedgerBuild;
  play?: LedgerPlay | undefined;
}): { resolved: ResolvedBuild | null; error: string | null } {
  if (!started(build)) return { resolved: null, error: null };
  try {
    return { resolved: resolveBuild({ params, catalogue, build, play }), error: null };
  } catch (e) {
    return { resolved: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export const isReady = (r: ResolvedBuild | null) => r !== null && buildReady(r);

// ── lookups ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type ById<T> = ReadonlyMap<string, T>;
export type Lookups = { [K in keyof LedgerCreation]: ById<LedgerCreation[K][number]> };
const lookupCache = new WeakMap<LedgerCreation, Lookups>();
// The catalogue's records by id, once per catalogue.
export function lookupsOf(creation: LedgerCreation): Lookups {
  const hit = lookupCache.get(creation);
  if (hit) return hit;
  const made = Object.fromEntries(
    Object.entries(creation).map(([k, list]) => [k, new Map(list.map((r) => [r.id, r]))]),
  ) as unknown as Lookups; // each list keyed by its own ids: the mapped type is what Object.fromEntries can't infer
  lookupCache.set(creation, made);
  return made;
}

// A record's cite: its source's cite and the page, as the engine writes it.
export const recordCite = (params: BuildParams, r: { source: string; page: number }) =>
  `${params.sources.list.find((s) => s.id === r.source)?.cite ?? r.source}${params.sources.pageSep}${r.page}`;

const isOfficial = (params: BuildParams, source: string) =>
  params.sources.list.find((s) => s.id === source)?.official ?? false;
// A record the campaign lets in: official, or homebrew where the campaign allows it, or already taken.
export const offered = ({
  params,
  catalogue,
  source,
  taken = false,
}: {
  params: BuildParams;
  catalogue: BuildCatalogue;
  source: string;
  taken?: boolean;
}) => taken || catalogue.homebrew || isOfficial(params, source);

// ── steps ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// The steps a seat sees. Ascension shows when the build ascends at creation or in play; Advance only in play. A player
// whose character is in play buys with earned XP only (the GM-side seat still sees every step), as in Auspex.
export function stepsFor({
  build,
  lookups,
  play,
  gm,
}: {
  build: LedgerBuild;
  lookups: Lookups;
  play?: LedgerPlay | undefined;
  gm: boolean;
}): BuildStep[] {
  const { atCreation, ascending } = ascensionOf({ build, lookups, play });
  if (play && !gm) return ascending ? ["ascension", "advance"] : ["advance"];
  return LEDGER_STEPS.filter((s) => (s !== "ascension" || atCreation || ascending) && (s !== "advance" || !!play));
}

// The step the builder opens on. A new build: the Tier. One begun: the first step, in order, with something left for
// this seat (a player doesn't count what waits for the GM's tick), else its purchases.
export function openingStep({
  build,
  resolved,
  steps,
  gm,
}: {
  build: LedgerBuild;
  resolved: ResolvedBuild | null;
  steps: readonly BuildStep[];
  gm: boolean;
}): BuildStep {
  if (!started(build)) return "tier";
  const owes = (s: BuildStep) =>
    !!resolved &&
    (resolved.pending.some((p) => p.step === s) ||
      resolved.problems.some((p) => p.step === s && (gm || p.severity !== "gm")));
  return steps.find(owes) ?? "customise";
}

export type StepIssues = {
  pending: PendingChoice[]; // answered by the step's own controls (no `pick`)
  choices: BuildChoicePrompt[]; // every grant choice of the step, answered or not
  problems: BuildProblem[];
  left: number; // pending choices and problems: what the step navigation counts
};
// The resolved build's choices and problems, by the step that settles them.
export function issuesByStep(r: ResolvedBuild | null): Record<BuildStep, StepIssues> {
  const out = Object.fromEntries(
    LEDGER_STEPS.map((s) => [s, { pending: [], choices: [], problems: [], left: 0 } satisfies StepIssues]),
  ) as unknown as Record<BuildStep, StepIssues>; // one entry per step, built from LEDGER_STEPS
  if (!r) return out;
  for (const p of r.pending) {
    out[p.step].left++;
    if (!p.pick) out[p.step].pending.push(p);
  }
  for (const c of r.choices) out[c.step].choices.push(c);
  for (const p of r.problems) {
    out[p.step].left++;
    out[p.step].problems.push(p);
  }
  return out;
}

// ── the ledger ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type LedgerGroup = { step: BuildStep; rows: LedgerRow[]; xp: number };
export type SessionGroup = { session: number | null; rows: LedgerRow[]; xp: number };
const total = (rows: LedgerRow[]) => rows.reduce((n, r) => n + r.xp, 0);
// Creation rows by step, in the builder's order; rows bought in play by session, latest first, unrecorded last.
export function ledgerGroups(ledger: LedgerRow[]): { creation: LedgerGroup[]; sessions: SessionGroup[] } {
  const creation = LEDGER_STEPS.map((step) => {
    const rows = ledger.filter((l) => !l.pool && l.step === step);
    return { step, rows, xp: total(rows) };
  }).filter((g) => g.rows.length > 0);
  const bySession = new Map<number | null, LedgerRow[]>();
  for (const l of ledger.filter((x) => x.pool === "advancement")) {
    const k = l.session ?? null;
    bySession.set(k, [...(bySession.get(k) ?? []), l]);
  }
  const sessions = [...bySession.entries()]
    .map(([session, rows]) => ({ session, rows, xp: total(rows) }))
    .toSorted((a, b) => (a.session === null ? 1 : b.session === null ? -1 : b.session - a.session));
  return { creation, sessions };
}

// ── lists ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// Why a record can't be taken. `out`: a requirement no purchase can meet (the engine's `outOfReach`); `unmet`: what
// `meets` says is still missing, which a purchase can fix (the engine flags it as a problem once taken); `gm`: what
// only the GM can judge.
export type Reach = { out: boolean; unmet: string[]; gm: string[] };
export function reachOf({
  requires,
  who,
  ctx,
}: {
  requires: readonly LedgerRequirement[] | undefined;
  who: Who | null;
  ctx: BuildCtx | null;
}): Reach {
  const reach: Reach = { out: !!who && outOfReach(requires, who), unmet: [], gm: [] };
  if (!ctx) return reach;
  for (const r of requires ?? []) {
    const why = meets(r, ctx);
    if (typeof why === "string") reach.unmet.push(why);
    else if (why !== true) reach.gm.push(why.gm);
  }
  return reach;
}

// ponytail: `resolveBuild` doesn't return the context it checks requirements against, so the lists preview `meets` on
// one rebuilt from the sheet (granted Talents by name, gear by name, Influence as Attribute plus bonus), upgrade: have
// the engine return its `BuildCtx` with the result. The engine's own check comes back as problems either way.
export function ctxFor({
  params,
  catalogue,
  lookups,
  build,
  resolved,
}: {
  params: BuildParams;
  catalogue: BuildCatalogue;
  lookups: Lookups;
  build: LedgerBuild;
  resolved: ResolvedBuild | null;
}): BuildCtx | null {
  if (!resolved) return null;
  const sheet = resolved.sheet;
  const talentIdByName = new Map(catalogue.creation.talents.map((t) => [t.name, t.id]));
  const talentIds = [
    ...(build.talents ?? []).map((t) => t.id),
    ...(build.advancement?.talents ?? []).map((t) => t.id),
    ...sheet.talents.flatMap((t) => talentIdByName.get(t.name) ?? []),
  ];
  const powerIds = [...new Set([...(build.powers ?? []), ...(build.advancement?.powers ?? [])])];
  const fills = Object.values(build.fills ?? {}).flatMap((f) => ("id" in f ? [f.id] : []));
  return {
    params,
    attributes: sheet.attributes,
    skills: sheet.skills,
    keywords: new Set(resolved.who.keywords),
    species: resolved.who.species ?? [],
    archetypeId: resolved.who.archetypeId,
    subFactionIds: new Set(fills),
    talents: new Set(talentIds),
    talentCategories: talentIds.flatMap((id) => lookups.talents.get(id)?.category ?? []),
    powers: powerIds.flatMap((id) => {
      const p = lookups.powers.get(id);
      return p ? [{ id, disciplineId: p.disciplineId }] : [];
    }),
    gear: sheet.gear.map((line) => ({ name: gearName(line), qty: 1, scope: "character" as const, from: "sheet" })),
    wargear: catalogue.wargear,
    options: build.options ?? [],
    influence: (sheet.attributes[params.links.influence] ?? 0) + (sheet.mods.influence ?? 0),
    rank: resolved.advancement?.rank ?? 1,
    tier: resolved.advancement?.tier ?? build.tier,
  };
}

// A sheet gear line is the item's name, then its cite in brackets (the engine's `gearLine`).
export const gearName = (line: string) => line.split(" (")[0] ?? line;

export const REACH_FILTERS = ["open", "all"] as const;
export type ReachFilter = (typeof REACH_FILTERS)[number];
export type ListRow = { id: string; name: string; search: string; taken: boolean; reach: Reach };
// Rows matching the search (name, cite and whatever else the row put in `search`). "open" hides what is out of reach,
// except what is already taken.
export function filterRows<R extends ListRow>({
  rows,
  query,
  reach,
}: {
  rows: readonly R[];
  query: string;
  reach: ReachFilter;
}): R[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (reach === "all" || r.taken || !r.reach.out) &&
      (q === "" || r.name.toLowerCase().includes(q) || r.search.toLowerCase().includes(q)),
  );
}

// ── what a step offers ──────────────────────────────────────────────────────────────────────────────────────────────

const archetypeOf = ({ build, lookups }: { build: LedgerBuild; lookups: Lookups }) =>
  build.archetypeId ? lookups.archetypes.get(build.archetypeId) : undefined;

// The faction step's choices, as Auspex offers them: each [PLACEHOLDER] keyword (still open, or filled) with the
// sub-factions of its type; the Background tables and option groups this character's faction, species or sub-factions
// own (a faction's `backgroundsFrom` opens another faction's tables); tables with no rows are left out.
export function factionOffers({
  params,
  catalogue,
  lookups,
  build,
  resolved,
}: {
  params: BuildParams;
  catalogue: BuildCatalogue;
  lookups: Lookups;
  build: LedgerBuild;
  resolved: ResolvedBuild;
}) {
  const fills = build.fills ?? {};
  const marker = params.keywords.placeholderMarker;
  const keywordByName = new Map(catalogue.creation.keywords.map((k) => [k.name, k]));
  const placeholders = [
    ...new Set([...resolved.sheet.keywords.filter((k) => k.startsWith(marker)), ...Object.keys(fills)]),
  ].map((keyword) => {
    const record = keywordByName.get(keyword);
    const fill = fills[keyword];
    const filledId = fill && "id" in fill ? fill.id : undefined;
    const subFactions = catalogue.creation["sub-factions"].filter(
      (s) =>
        s.type === record?.placeholder && offered({ params, catalogue, source: s.source, taken: s.id === filledId }),
    );
    return { keyword, record, subFactions, writeIn: !!record?.writeIn || subFactions.length === 0, fill };
  });
  const species = resolved.who.species ?? [];
  const factionId = archetypeOf({ build, lookups })?.factionId ?? build.advanced?.factionId;
  const subFactionIds = Object.values(fills).flatMap((f) => ("id" in f ? [f.id] : []));
  type Owner = LedgerCreation["backgrounds"][number]["owner"];
  const owns = (o: Owner) =>
    ("factionId" in o && o.factionId === factionId) ||
    ("speciesId" in o && species.includes(o.speciesId)) ||
    ("speciesIds" in o && o.speciesIds.some((s) => species.includes(s))) ||
    ("subFactionId" in o && subFactionIds.includes(o.subFactionId));
  const from = (factionId ? lookups.factions.get(factionId)?.backgroundsFrom : undefined) ?? [];
  const rowsOf = (t: LedgerCreation["backgrounds"][number], row: string) => (Array.isArray(t[row]) ? t[row] : []);
  const tables = catalogue.creation.backgrounds.filter(
    (t) =>
      (owns(t.owner) || ("factionId" in t.owner && from.includes(t.owner.factionId))) &&
      params.vocabulary.backgroundRows.some((row) => rowsOf(t, row).length > 0) &&
      offered({ params, catalogue, source: t.source, taken: build.background?.tableId === t.id }),
  );
  const groups = catalogue.creation["option-groups"].filter(
    (g) =>
      owns(g.owner) &&
      offered({ params, catalogue, source: g.source, taken: (build.options ?? []).some((o) => o.groupId === g.id) }),
  );
  return { placeholders, tables, groups };
}

// A Background table's rows of one column, as the catalogue holds them.
export type BackgroundChoice = { name: string; summary?: string | undefined; bonus?: string | undefined };
export const backgroundRows = (table: LedgerCreation["backgrounds"][number], row: string): BackgroundChoice[] =>
  Array.isArray(table[row]) ? (table[row] as BackgroundChoice[]) : []; // a column the params name, parsed as rows

// Whether the build ascends at creation (an Archetype below the Tier, or Advanced Creation) or in play.
export function ascensionOf({
  build,
  lookups,
  play,
}: {
  build: LedgerBuild;
  lookups: Lookups;
  play?: LedgerPlay | undefined;
}) {
  const arch = archetypeOf({ build, lookups });
  return {
    atCreation: build.advanced !== undefined || (!!arch && arch.tier < build.tier),
    ascending: !!play && play.tier > build.tier,
    // Archetype Ascension in play: an Archetype of the same faction, above the creation Tier, up to the Tier now
    archetypes:
      play && arch
        ? [...lookups.archetypes.values()].filter(
            (a) => a.factionId === arch.factionId && a.id !== arch.id && a.tier > build.tier && a.tier <= play.tier,
          )
        : [],
  };
}

// ── edits: each takes the build and returns the next one ──────────────────────────────────────────────────────────────

const toggle = <T>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

// Picking an Archetype (or Advanced Creation) starts the build again from its Tier: what was bought belonged to the
// last one. The GM's part and the languages stay, as in Auspex.
export function pickArchetype({ build, id }: { build: LedgerBuild; id: string }): LedgerBuild {
  if (build.archetypeId === id) return build;
  return { tier: build.tier, archetypeId: id, gm: build.gm, languages: build.languages };
}
export function startAdvanced({ build }: { build: LedgerBuild }): LedgerBuild {
  if (build.advanced) return build;
  return { tier: build.tier, advanced: { wargear: [] }, gm: build.gm, languages: build.languages };
}
export const pickSpecies = ({ build, id }: { build: LedgerBuild; id: string }): LedgerBuild => ({
  ...build,
  speciesId: id,
});
export const setTier = ({ build, tier }: { build: LedgerBuild; tier: number }): LedgerBuild => ({ ...build, tier });

// Advanced Creation: the optional Faction. Changing it clears the Background and drops what the old Faction owned:
// the fills of its placeholder keywords (and of the any-keyword placeholders once a Faction is set), and the options
// its groups, or a dropped sub-faction's, gave.
export function setAdvancedFaction({
  build,
  params,
  lookups,
  factionId,
}: {
  build: LedgerBuild;
  params: BuildParams;
  lookups: Lookups;
  factionId: string | undefined;
}): LedgerBuild {
  const old = build.advanced?.factionId;
  if (!build.advanced || old === factionId) return build;
  const oldKeywords = new Set(old ? (lookups.factions.get(old)?.keywords ?? []) : []);
  const any = new Set([params.keywords.any, params.keywords.anyTwo]);
  const drop = (k: string) => oldKeywords.has(k) || (!!factionId && any.has(k));
  const entries = Object.entries(build.fills ?? {});
  const dropped = new Set(entries.flatMap(([k, f]) => (drop(k) && "id" in f ? [f.id] : [])));
  const options = (build.options ?? []).filter((o) => {
    const owner = lookups["option-groups"].get(o.groupId)?.owner;
    if (!owner) return true;
    return (
      !("factionId" in owner && owner.factionId === old) &&
      !("subFactionId" in owner && dropped.has(owner.subFactionId))
    );
  });
  return {
    ...build,
    advanced: { ...build.advanced, factionId },
    background: undefined,
    fills: Object.fromEntries(entries.filter(([k]) => !drop(k))),
    options,
  };
}
export function toggleAbilityOf({ build, id }: { build: LedgerBuild; id: string }): LedgerBuild {
  if (!build.advanced) return build;
  return { ...build, advanced: { ...build.advanced, abilityOf: build.advanced.abilityOf === id ? undefined : id } };
}
export function toggleAdvancedWargear({ build, id }: { build: LedgerBuild; id: string }): LedgerBuild {
  if (!build.advanced) return build;
  return { ...build, advanced: { ...build.advanced, wargear: toggle(build.advanced.wargear ?? [], id) } };
}

type Purchases = {
  attributes: Partial<Record<string, number>>;
  skills: Partial<Record<string, number>>;
  talents: { id: string; choice?: string | undefined }[];
  powers: string[];
  packages: string[];
};
export function purchasesOf({ build, layer }: { build: LedgerBuild; layer: Layer }): Purchases {
  const from = layer === "creation" ? build : (build.advancement ?? {});
  return {
    attributes: from.attributes ?? {},
    skills: from.skills ?? {},
    talents: from.talents ?? [],
    powers: from.powers ?? [],
    packages: from.packages ?? [],
  };
}
const withPurchases = ({
  build,
  layer,
  patch,
}: {
  build: LedgerBuild;
  layer: Layer;
  patch: Partial<Purchases>;
}): LedgerBuild =>
  layer === "creation" ? { ...build, ...patch } : { ...build, advancement: { ...build.advancement, ...patch } };

// A rating's row: the rating on the sheet, whether this layer can raise or return it, and the next point's price.
// Raising sets the layer's target to one above the sheet; returning is allowed only where this layer bought the
// rating, as in Auspex. The cap is the species maximum where one is set, else the price table's top.
export function ratingRow({
  params,
  build,
  layer,
  kind,
  key,
  value,
  speciesMax,
}: {
  params: BuildParams;
  build: LedgerBuild;
  layer: Layer;
  kind: RatingKind;
  key: string;
  value: number;
  speciesMax?: number | undefined;
}) {
  const table = kind === "attributes" ? params.attributeXp.table : params.skillXp.table;
  const top = table.length - 1;
  const cap = Math.min(top, speciesMax ?? top);
  const mine = purchasesOf({ build, layer })[kind][key] ?? 0;
  const floor = kind === "attributes" ? 1 : 0;
  const next = value < top ? table[value + 1]! - table[value]! : null;
  return { value, cap, canRaise: value < cap, canReturn: mine >= value && value > floor, next };
}
export function setRating({
  build,
  layer,
  kind,
  key,
  to,
}: {
  build: LedgerBuild;
  layer: Layer;
  kind: RatingKind;
  key: string;
  to: number;
}): LedgerBuild {
  const { [key]: _was, ...rest } = purchasesOf({ build, layer })[kind];
  const floor = kind === "attributes" ? 1 : 0;
  return withPurchases({ build, layer, patch: { [kind]: to > floor ? { ...rest, [key]: to } : rest } });
}

// A tap on a Talent in the list: takes it, or gives it back unless another copy of it is allowed ("perChoice").
export function tapTalent({
  build,
  layer,
  id,
  repeatable,
}: {
  build: LedgerBuild;
  layer: Layer;
  id: string;
  repeatable: boolean | "perChoice";
}): LedgerBuild {
  const talents = purchasesOf({ build, layer }).talents;
  const held = talents.some((t) => t.id === id);
  const next = held && repeatable !== "perChoice" ? talents.filter((t) => t.id !== id) : [...talents, { id }];
  return withPurchases({ build, layer, patch: { talents: next } });
}
export function removeTalentAt({ build, layer, index }: { build: LedgerBuild; layer: Layer; index: number }) {
  const talents = purchasesOf({ build, layer }).talents.filter((_, i) => i !== index);
  return withPurchases({ build, layer, patch: { talents } });
}
// A bracketed Talent's pick ("Talent (choice)"); empty clears it.
export function setTalentChoice({
  build,
  layer,
  index,
  choice,
}: {
  build: LedgerBuild;
  layer: Layer;
  index: number;
  choice: string;
}): LedgerBuild {
  const talents = purchasesOf({ build, layer }).talents.map((t, i) =>
    i === index ? { id: t.id, ...(choice.trim() ? { choice: choice.trim() } : {}) } : t,
  );
  return withPurchases({ build, layer, patch: { talents } });
}
export const togglePower = ({ build, layer, id }: { build: LedgerBuild; layer: Layer; id: string }) =>
  withPurchases({ build, layer, patch: { powers: toggle(purchasesOf({ build, layer }).powers, id) } });
export const togglePackage = ({ build, layer, id }: { build: LedgerBuild; layer: Layer; id: string }) =>
  withPurchases({ build, layer, patch: { packages: toggle(purchasesOf({ build, layer }).packages, id) } });

// At creation one Ascension Package at most: a new pick replaces the old, a second tap gives it back.
export function pickAscension({
  build,
  id,
  isAscension,
}: {
  build: LedgerBuild;
  id: string;
  isAscension: (id: string) => boolean;
}): LedgerBuild {
  const packages = build.packages ?? [];
  const had = packages.includes(id);
  return { ...build, packages: [...packages.filter((p) => !isAscension(p)), ...(had ? [] : [id])] };
}
// In play, one Ascension Package per Tier ascended (less one for an Archetype Ascension): a pick past that replaces the
// latest one chosen.
export function pickPlayAscension({
  build,
  id,
  isAscension,
  play,
}: {
  build: LedgerBuild;
  id: string;
  isAscension: (id: string) => boolean;
  play: LedgerPlay;
}): LedgerBuild {
  const list = build.advancement?.packages ?? [];
  if (list.includes(id)) return togglePackage({ build, layer: "advancement", id });
  const slots = play.tier - build.tier - (build.advancement?.archetypeAscension ? 1 : 0);
  const chosen = list.filter(isAscension);
  const drop = chosen.length >= slots ? chosen.at(-1) : undefined;
  return withPurchases({
    build,
    layer: "advancement",
    patch: { packages: [...list.filter((p) => p !== drop), id] },
  });
}
export function toggleArchetypeAscension({ build, archetypeId }: { build: LedgerBuild; archetypeId: string }) {
  const now = build.advancement?.archetypeAscension?.archetypeId;
  return {
    ...build,
    advancement: { ...build.advancement, archetypeAscension: now === archetypeId ? undefined : { archetypeId } },
  } satisfies LedgerBuild;
}

// What fills a [PLACEHOLDER] keyword: a sub-faction, a written-in name, or nothing.
export function setFill({
  build,
  keyword,
  fill,
}: {
  build: LedgerBuild;
  keyword: string;
  fill: { id: string } | { writeIn: string } | null;
}): LedgerBuild {
  const { [keyword]: _was, ...rest } = build.fills ?? {};
  return { ...build, fills: fill ? { ...rest, [keyword]: fill } : rest };
}
// A written-in keyword in the form the schema takes: upper case, letters, digits, apostrophes, spaces and hyphens.
export const writeInKeyword = (text: string) => text.toUpperCase().replace(/[^A-Z0-9' -]/g, "");

export function pickBackgroundTable({ build, tableId }: { build: LedgerBuild; tableId: string }): LedgerBuild {
  return build.background?.tableId === tableId ? build : { ...build, background: { tableId } };
}
export function pickBackgroundRow({ build, row, name }: { build: LedgerBuild; row: string; name: string }) {
  if (!build.background) return build;
  return { ...build, background: { ...build.background, [row]: name } } satisfies LedgerBuild;
}
export function pickBackgroundBonus({ build, row }: { build: LedgerBuild; row: string }): LedgerBuild {
  if (!build.background) return build;
  return { ...build, background: { ...build.background, bonus: row } };
}
// An option of a group: taken or given back. The order is kept: an option's price depends on how many came before it.
export function toggleOption({ build, groupId, name }: { build: LedgerBuild; groupId: string; name: string }) {
  const options = build.options ?? [];
  const has = options.some((o) => o.groupId === groupId && o.name === name);
  return {
    ...build,
    options: has ? options.filter((o) => !(o.groupId === groupId && o.name === name)) : [...options, { groupId, name }],
  } satisfies LedgerBuild;
}

export const LANGUAGE_WAYS = ["picks", "bought"] as const;
export type LanguageWay = (typeof LANGUAGE_WAYS)[number];
// A language taken free ("picks"), bought, or dropped (null): it is in one list at most. `name` is the language's id,
// or the name a player writes in for one the table doesn't list (the GM ticks it).
export function setLanguage({
  build,
  name,
  way,
}: {
  build: LedgerBuild;
  name: string;
  way: LanguageWay | null;
}): LedgerBuild {
  const picks = (build.languages?.picks ?? []).filter((l) => l !== name);
  const bought = (build.languages?.bought ?? []).filter((l) => l !== name);
  if (way === "picks") picks.push(name);
  if (way === "bought") bought.push(name);
  return { ...build, languages: { picks, bought } };
}
export const toggleLearnedLanguage = ({ build, name }: { build: LedgerBuild; name: string }): LedgerBuild => ({
  ...build,
  advancement: { ...build.advancement, languages: toggle(build.advancement?.languages ?? [], name) },
});
export const setWealth = ({ build, params, to }: { build: LedgerBuild; params: BuildParams; to: number }) =>
  ({ ...build, wealth: Math.max(0, Math.min(params.wealth.maxBought, to)) }) satisfies LedgerBuild;

// A tap on one answer of a grant's choice. Option choices store the option's index, the rest the id or name. A tapped
// answer is taken back; with one to choose a new tap replaces it, with more the oldest drops once the count is reached.
export function answerChoice({
  build,
  prompt,
  value,
}: {
  build: LedgerBuild;
  prompt: Pick<BuildChoicePrompt, "path" | "choose" | "answer">;
  value: number | string;
}): LedgerBuild {
  const now = prompt.answer;
  const next = now.includes(value)
    ? now.filter((v) => v !== value)
    : prompt.choose <= 1
      ? [value]
      : [...now, value].slice(-prompt.choose);
  return { ...build, choices: { ...build.choices, [prompt.path]: next } };
}
// An optional choice answered with nothing: declined.
export const declineChoice = ({ build, path }: { build: LedgerBuild; path: string }): LedgerBuild => ({
  ...build,
  choices: { ...build.choices, [path]: [] },
});

// ── the GM's part ───────────────────────────────────────────────────────────────────────────────────────────────────

const gmOf = (b: LedgerBuild) => b.gm ?? {};
// Ticks (or unticks) a question only the GM can judge, by its path.
export const toggleApproval = ({ build, path }: { build: LedgerBuild; path: string }): LedgerBuild => ({
  ...build,
  gm: { ...gmOf(build), approved: toggle(gmOf(build).approved ?? [], path) },
});
export const setGmSpecies = ({ build, id }: { build: LedgerBuild; id: string | undefined }): LedgerBuild => ({
  ...build,
  gm: { ...gmOf(build), species: id },
});
export const toggleGmKeyword = ({ build, keyword }: { build: LedgerBuild; keyword: string }): LedgerBuild => ({
  ...build,
  gm: { ...gmOf(build), keywords: toggle(gmOf(build).keywords ?? [], keyword) },
});
export function setGmMod({ build, key, value }: { build: LedgerBuild; key: string; value: number | null }) {
  const { [key]: _was, ...rest } = gmOf(build).mods ?? {};
  return {
    ...build,
    gm: { ...gmOf(build), mods: value === null ? rest : { ...rest, [key]: value } },
  } satisfies LedgerBuild;
}
const gearOf = (b: LedgerBuild) => gmOf(b).gear ?? {};
export const toggleGmGearRemove = ({ build, name }: { build: LedgerBuild; name: string }): LedgerBuild => ({
  ...build,
  gm: { ...gmOf(build), gear: { ...gearOf(build), remove: toggle(gearOf(build).remove ?? [], name) } },
});
export function toggleGmGearAdd({ build, item }: { build: LedgerBuild; item: { name: string; wargearId: string } }) {
  const add = gearOf(build).add ?? [];
  const has = add.some((g) => g.wargearId === item.wargearId);
  return {
    ...build,
    gm: {
      ...gmOf(build),
      gear: { ...gearOf(build), add: has ? add.filter((g) => g.wargearId !== item.wargearId) : [...add, item] },
    },
  } satisfies LedgerBuild;
}
