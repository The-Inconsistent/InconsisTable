import { z } from "zod";

import { MAX_SIDES, parseDice } from "./dice/dice.ts";
import {
  ConditionDuration,
  ConditionStacking,
  CreationKind,
  EditableBy,
  EffectMode,
  EffectPhase,
  EntityBase,
  License,
  PoolFlag,
  ResetEvent,
  ResourceScope,
  ScalarType,
  ScoreMethodKind,
  TieRule,
  Visibility,
} from "./enums.ts";
import { MAX_EXPR_LENGTH } from "./expr/expr.ast.ts";
import { own } from "./own.ts";
import { formatPath, type Problem } from "./problem.ts";

/** Manifests are user-written imports stored as JSONB: bound them before anything else reads them. */
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_FIELDS = 2000;

export const Id = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, "use camelCase letters and digits");
/** Field ids may be dotted (`attr.str`), which nests them in the expression scope (`attr[ctx.ability]`). */
export const FieldId = z
  .string()
  .max(120)
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, "use dotted camelCase segments");
export const RulesetId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use kebab-case");
export const SemVer = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, "use a semver version such as 1.2.0");
// ponytail: checks the shape of npm-style ranges only (`^1.2.0`, `>=1.0.0 <2.0.0`, `1.x`, `||`); matching a range
// against the core version comes with the ruleset importer.
const COMPARATOR = String.raw`(\^|~|>=|<=|>|<|=)?(\d+|x|\*)(\.(\d+|x|\*)){0,2}(-[0-9A-Za-z.-]+)?`;
export const SemVerRange = z
  .string()
  .max(128)
  .regex(
    new RegExp(`^\\s*${COMPARATOR}(\\s+${COMPARATOR})*(\\s*\\|\\|\\s*${COMPARATOR}(\\s+${COMPARATOR})*)*\\s*$`),
    "use a semver range",
  );
/** Source and printed page, e.g. "Sample p.12". */
export const Cite = z.string().min(1).max(40);
export const ExprSource = z.string().min(1).max(MAX_EXPR_LENGTH);
export const DiceNotation = z
  .string()
  .min(1)
  .max(200)
  .superRefine((v, ctx) => {
    const parsed = parseDice(v);
    if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.error });
  });

export const Source = z.object({
  id: Id,
  title: z.string().min(1).max(200),
  license: License,
  /** PDF page = printed page + pageOffset. */
  pageOffset: z.int().min(-1000).max(1000).optional(),
});
export type Source = z.infer<typeof Source>;

const fieldBase = {
  label: z.string().min(1).max(80),
  visibility: Visibility.default("gm"),
  editableBy: EditableBy.default("gm"),
  cite: Cite.optional(),
};

export const FieldDef = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("int"), min: z.int().optional(), max: z.int().optional() }),
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.int().min(1).max(10_000).optional() }),
  z.object({ ...fieldBase, type: z.literal("enum"), values: z.array(Id).min(1).max(200) }),
  z.object({ ...fieldBase, type: z.literal("bool") }),
  /** A reference to another actor or entry of the given entity type. */
  z.object({ ...fieldBase, type: z.literal("ref"), entity: Id }),
  // ponytail: a list holds text items only; typed lists (of refs, of ints) when a ruleset needs them.
  z.object({ ...fieldBase, type: z.literal("list"), maxItems: z.int().min(1).max(500).optional() }),
]);
export type FieldDef = z.infer<typeof FieldDef>;

export const DerivedDef = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  expr: ExprSource,
  visibility: Visibility.default("gm"),
  cite: Cite.optional(),
});
export type DerivedDef = z.infer<typeof DerivedDef>;

export const EntityType = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  base: EntityBase,
  fields: z.record(FieldId, FieldDef).default({}),
  derived: z.array(DerivedDef).default([]),
});
export type EntityType = z.infer<typeof EntityType>;

export const Resource = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  scope: ResourceScope,
  /** Entity types that carry an `entity`-scoped resource; every `actor`-based type when omitted. */
  entities: z.array(Id).optional(),
  min: ExprSource.default("0"),
  max: ExprSource.optional(),
  /** false: the value may run past max (a damage track that counts overflow). */
  capped: z.boolean().default(true),
  /** `to` may name `max` and `min`, the resource's own bounds. */
  resetOn: z.array(z.object({ event: ResetEvent, to: ExprSource })).default([]),
  visibility: Visibility.default("gm"),
  editableBy: EditableBy.default("gm"),
});
export type Resource = z.infer<typeof Resource>;

export const Effect = z.object({
  /** A field id for phase `base`, `derived.<id>` for phase `derived`. */
  path: z.string().min(1).max(130),
  mode: EffectMode,
  value: ExprSource,
  phase: EffectPhase.default("base"),
  priority: z.int().optional(),
  when: ExprSource.optional(),
  /** Inherits its condition's cite when omitted. */
  cite: Cite.optional(),
});
export type Effect = z.infer<typeof Effect>;

export const Condition = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  effects: z.array(Effect).max(50).default([]),
  stacking: ConditionStacking.default("none"),
  maxStacks: z.int().min(1).max(100).optional(),
  duration: ConditionDuration,
  /** Who sees that an actor has it. Fail-closed like everything else. */
  visibility: Visibility.default("gm"),
});
export type Condition = z.infer<typeof Condition>;

export const RuleOption = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  default: z.boolean().default(false),
});
export type RuleOption = z.infer<typeof RuleOption>;

// What every kind of Test declares: the number it is compared with, how a tie goes, and what the GM fills in to call it.
const testBase = {
  target: ExprSource,
  ties: TieRule.default("meetOrBeat"),
  /** Values the caller supplies when the Test is called, read as `ctx.<id>` (e.g. `ctx.dc`, `ctx.ability`). */
  inputs: z.record(Id, ScalarType).default({}),
  /** The allowed values of a text input; the call form shows a picker and the server refuses anything else. */
  inputOptions: z.record(Id, z.array(z.string().min(1).max(60)).min(1).max(50)).default({}),
  cite: Cite.optional(),
};

/**
 * Degrees of success (house decision #42): beat the target by `step` for one level up, miss it by `step` for one level
 * down. `naturalShift`: a natural highest face of the single die moves the result one level up, the lowest one down.
 */
export const Degrees = z.object({
  step: z.int().min(1).max(20),
  naturalShift: z.boolean().default(false),
  cite: Cite.optional(),
});
export type Degrees = z.infer<typeof Degrees>;

/** Roll dice, add a modifier, compare with a target. Also the params of the `dice.sumVsTarget` primitive. */
export const SumVsTarget = z.object({
  ...testBase,
  kind: z.literal("sumVsTarget"),
  /** Plain `NdX`: the primitive sums the faces it is given. */
  dice: DiceNotation,
  modifier: ExprSource.default("0"),
  /** Allows advantage and disadvantage: roll the die twice, keep the higher or the lower. */
  advantage: z.boolean().default(false),
  /** Natural results that make the outcome `critical`. */
  critOn: z.array(z.int().min(1)).max(20).optional(),
  /** Four outcomes instead of two (`criticalSuccess | success | failure | criticalFailure`). Excludes `critOn`. */
  degrees: Degrees.optional(),
});
export type SumVsTarget = z.infer<typeof SumVsTarget>;

/** A run of faces of one die, both ends included. */
export const FaceRange = z.object({ from: z.int().min(1).max(MAX_SIDES), to: z.int().min(1).max(MAX_SIDES) });
export type FaceRange = z.infer<typeof FaceRange>;

/**
 * A Dice pool: roll as many dice as the character's values say, count the faces that score, compare the score with
 * the target (the difficulty number). Also the params of the `dice.poolSuccesses` primitive.
 */
export const PoolSuccesses = z.object({
  ...testBase,
  kind: z.literal("poolSuccesses"),
  /** How many dice the character rolls, special dice included. */
  pool: ExprSource,
  /** Dice added to or taken from the pool by the call; the pool never drops below zero. */
  modifier: ExprSource.default("0"),
  /** Sides of every die of the pool. */
  die: z.int().min(2).max(MAX_SIDES),
  /** The faces that score and what one die showing them is worth. Bands never overlap. */
  bands: z
    .array(z.object({ id: Id, ...FaceRange.shape, worth: z.int().min(1).max(10) }))
    .min(1)
    .max(10),
  /** Dice of the pool read one by one, whose faces flag the roll. They score like every other die. */
  special: z
    .object({
      label: z.string().min(1).max(40),
      count: z.int().min(1).max(10),
      flags: z.partialRecord(PoolFlag, FaceRange).default({}),
    })
    .optional(),
  /** The band whose dice may be shifted, as long as the roll still passes without them. */
  shift: Id.optional(),
});
export type PoolSuccesses = z.infer<typeof PoolSuccesses>;

/** One result a reported Test can have. Listed best first. */
export const ReportedOutcome = z.object({ id: Id, label: z.string().min(1).max(60), cite: Cite.optional() });
export type ReportedOutcome = z.infer<typeof ReportedOutcome>;

/**
 * A Test the table rolls and works out itself (house decision #41): the manifest only names the outcomes, best first,
 * and the reporter picks one. No target, no modifier, no maths; the server checks the id is listed and records it.
 */
export const ReportedTest = z.object({
  kind: z.literal("reported"),
  outcomes: z.array(ReportedOutcome).min(2).max(8),
  /** Values the caller supplies when the Test is called (a name the GM wants on the card), as for the other kinds. */
  inputs: z.record(Id, ScalarType).default({}),
  inputOptions: z.record(Id, z.array(z.string().min(1).max(60)).min(1).max(50)).default({}),
  cite: Cite.optional(),
});
export type ReportedTest = z.infer<typeof ReportedTest>;

export const DiceMechanic = z.discriminatedUnion("kind", [SumVsTarget, PoolSuccesses, ReportedTest]);
export type DiceMechanic = z.infer<typeof DiceMechanic>;

/** Highest score acts first. Also the params of the `initiative.ranked` primitive. */
export const RankedInitiative = z.object({
  strategy: z.literal("ranked"),
  /** Without dice; `dice` is rolled (or reported) and added. */
  score: ExprSource,
  dice: DiceNotation.optional(),
  /** Compared in order, highest first, when scores tie. Still tied: actor id order. */
  tiebreak: z.array(ExprSource).max(5).default([]),
  rerollEachRound: z.boolean().default(false),
  cite: Cite.optional(),
});
export type RankedInitiative = z.infer<typeof RankedInitiative>;

/** Play goes round the table from the first player; nothing is scored. Also the params of `initiative.seated`. */
export const SeatedInitiative = z.object({
  strategy: z.literal("seated"),
  /** fixed: always the first seat. rotate: one place along the order each round. manual: a seat sets it. */
  firstPlayer: z.enum(["fixed", "rotate", "manual"]),
  cite: Cite.optional(),
});
export type SeatedInitiative = z.infer<typeof SeatedInitiative>;

/** One step of a round, played in turn or by everyone at once (house decision #37). */
export const Phase = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  mode: z.enum(["turns", "simultaneous"]),
  cite: Cite.optional(),
});
export type Phase = z.infer<typeof Phase>;

export const ScoreOrder = z.enum(["high", "low"]);
export const GameOutcome = z.enum(["win", "lose"]);
export type GameOutcome = z.infer<typeof GameOutcome>;

/**
 * How a game is scored and when it may end (design §4.8, house decisions #38-#40). `score`, tiebreaks and `when` read
 * one actor's scope; `endWhen` also reads `round`. A trigger is met when it holds for any combatant.
 */
export const Scoring = z.object({
  /** coop: the whole table wins or loses together and nobody is ranked. */
  mode: z.enum(["compete", "coop"]).default("compete"),
  score: ExprSource,
  order: ScoreOrder.default("high"),
  tiebreaks: z
    .array(z.object({ expr: ExprSource, order: ScoreOrder }))
    .max(5)
    .default([]),
  endWhen: z
    .array(z.object({ when: ExprSource, outcome: GameOutcome.optional(), cite: Cite.optional() }))
    .max(10)
    .default([]),
  cite: Cite.optional(),
});
export type Scoring = z.infer<typeof Scoring>;

export const Initiative = z.discriminatedUnion("strategy", [RankedInitiative, SeatedInitiative]);
export type Initiative = z.infer<typeof Initiative>;

export const DeathSaves = z.object({
  successes: z.int().min(1).max(20),
  failures: z.int().min(1).max(20),
  /** How many failures a critical failure counts as. */
  criticalFailureCounts: z.int().min(1).max(20).default(1),
  /** When set, a critical success heals this much and ends dying; otherwise it counts as one success. */
  criticalSuccessHeals: z.int().min(1).optional(),
  /**
   * Failures a hit adds to an actor that is already dying (house decision #7: without this, a hit changes nothing).
   * A ruleset that counts a critical hit differently sets `failuresOnCriticalDamage`; it defaults to this value.
   */
  failuresOnDamage: z.int().min(1).max(20).optional(),
  failuresOnCriticalDamage: z.int().min(1).max(20).optional(),
});
export type DeathSaves = z.infer<typeof DeathSaves>;

export const HealthTrack = z.object({
  resource: Id,
  /** A resource that absorbs damage before this one (temporary hit points). */
  temp: Id.optional(),
  deathSaves: DeathSaves.optional(),
  /**
   * Instant death: damage left over once the track is at its minimum kills the actor when it is **at least** this
   * value (house decision #13). Read on the actor like a bound; write `max + 1` for a rule that says "exceeds".
   */
  instantDeathOverflow: ExprSource.optional(),
});
export type HealthTrack = z.infer<typeof HealthTrack>;

export const Health = z.object({
  tracks: z.array(HealthTrack).max(10).default([]),
  /** Display states such as "bloodied": `when` is a boolean expression over the actor. */
  states: z
    .array(z.object({ id: Id, label: z.string().min(1).max(80).optional(), when: ExprSource }))
    .max(20)
    .default([]),
  cite: Cite.optional(),
});
export type Health = z.infer<typeof Health>;

/** One house decision of the ruleset: where a book is ambiguous, what this ruleset does. Shown on RULES. */
export const Decision = z.object({
  id: Id,
  text: z.string().min(1).max(1000),
  cite: Cite.optional(),
});
export type Decision = z.infer<typeof Decision>;

const stepBase = {
  id: Id,
  /** The actor entity type the step builds. */
  actor: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  /** true: the builder may skip the step. */
  optional: z.boolean().default(false),
};

/** Scores handed out by the manifest's own table or budget; the numbers are the ruleset's, never the engine's. */
export const ScoreMethod = z.discriminatedUnion("kind", [
  /** Each listed value goes to exactly one of the step's fields. */
  z.object({ kind: z.literal(ScoreMethodKind.enum.table), values: z.array(z.int()).min(1).max(30) }),
  /** Every field scores within [min, max]; `costs` maps a score (as text) to its price, and the total stays in budget. */
  z.object({
    kind: z.literal(ScoreMethodKind.enum.pointBuy),
    budget: z.int().min(0).max(1000),
    min: z.int().min(-1000).max(1000),
    max: z.int().min(-1000).max(1000),
    costs: z.record(z.string().regex(/^-?\d+$/, "a score such as 8"), z.int().min(0).max(1000)),
  }),
]);
export type ScoreMethod = z.infer<typeof ScoreMethod>;

export const CreationStep = z.discriminatedUnion("kind", [
  /** Pick pack entries of one entity type; `copy` moves a value of the chosen entry onto the actor. */
  z.object({
    ...stepBase,
    kind: z.literal(CreationKind.enum.choose),
    pick: Id,
    count: z.int().min(1).max(20).default(1),
    copy: z
      .array(z.object({ from: FieldId, to: FieldId }))
      .max(20)
      .default([]),
  }),
  z.object({
    ...stepBase,
    kind: z.literal(CreationKind.enum.assign),
    fields: z.array(FieldId).min(1).max(30),
    method: ScoreMethod,
  }),
  /** Free input for the listed fields, checked against their `FieldDef`. */
  z.object({ ...stepBase, kind: z.literal(CreationKind.enum.fields), fields: z.array(FieldId).min(1).max(50) }),
]);
export type CreationStep = z.infer<typeof CreationStep>;

/** A layout hint for the sheet: sections listing field, derived or resource paths. Never HTML. */
export const Layout = z.object({
  sections: z
    .array(z.object({ id: Id, label: z.string().min(1).max(80), show: z.array(z.string().max(130)).max(100) }))
    .max(50),
});
export type Layout = z.infer<typeof Layout>;

export const Ruleset = z.object({
  id: RulesetId,
  version: SemVer,
  core: SemVerRange,
  extends: z.object({ id: RulesetId, version: SemVer }).optional(),
  sources: z.array(Source).min(1).max(50),
  terms: z.record(Id, z.string().min(1).max(60)).default({}),
  options: z.array(RuleOption).max(200).default([]),
  entities: z.array(EntityType).min(1).max(50),
  resources: z.array(Resource).max(200).default([]),
  conditions: z.array(Condition).max(500).default([]),
  tests: z.record(Id, DiceMechanic).default({}),
  /** Absent: the game has no turn order, and `encounter.start` is refused. */
  initiative: Initiative.optional(),
  /** The steps a round runs in order. Absent: a round is one pass of the initiative order. */
  phases: z.array(Phase).min(1).max(12).optional(),
  /** Final scores, ranking and the end of the game. Absent: the game has no score to rank. */
  scoring: Scoring.optional(),
  health: Health.default({ tracks: [], states: [] }),
  /** Steps of the character builder, in order. Empty: the ruleset has no builder and actors are filled by hand. */
  creation: z.array(CreationStep).max(50).default([]),
  decisions: z.array(Decision).max(200).default([]),
  layout: z.record(Id, Layout).default({}),
});
export type Ruleset = z.infer<typeof Ruleset>;
export type RulesetInput = z.input<typeof Ruleset>;

/** Scope roots the expression language reserves; a field id may not start with one. */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set([
  "derived",
  "res",
  "party",
  "ctx",
  "max",
  "min",
  "true",
  "false",
]);

export type ValidateResult = { ok: true; ruleset: Ruleset } | { ok: false; problems: Problem[] };

export function byteSize(input: unknown): number | null {
  try {
    const json = JSON.stringify(input);
    return json === undefined ? null : new TextEncoder().encode(json).length;
  } catch {
    return null;
  }
}

function duplicates({ ids, path, out }: { ids: readonly string[]; path: string; out: Problem[] }): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) out.push({ path: `${path}[${i}].id`, message: `duplicate id "${id}"` });
    seen.add(id);
  });
}

/** Plain `NdX` (no keep, explode, success count or constants), which the sum primitive can check faces against. */
export function plainDice(notation: string): { count: number; sides: number } | null {
  const parsed = parseDice(notation);
  if (!parsed.ok || parsed.dice.terms.length !== 1) return null;
  const [t] = parsed.dice.terms;
  if (t === undefined || t.kind !== "dice" || typeof t.die !== "number") return null;
  if (t.keep !== null || t.explode || t.successAt !== null || t.sign !== 1) return null;
  return { count: t.count, sides: t.die };
}

/** Steps name real actor entities, pack entity types and fields, and no field has two writers. */
function creationProblems(r: Ruleset, out: Problem[]): void {
  const entities = new Map(r.entities.map((e) => [e.id, e]));
  const written = new Map<string, string>(); // "actor/field" → step id
  const claim = ({ actor, field, step, path }: { actor: string; field: string; step: string; path: string }) => {
    const key = `${actor}/${field}`;
    const prev = written.get(key);
    if (prev !== undefined) out.push({ path, message: `"${field}" is already set by step "${prev}"` });
    else written.set(key, step);
  };
  r.creation.forEach((step, i) => {
    const at = `creation[${i}]`;
    const actor = entities.get(step.actor);
    if (actor?.base !== "actor") {
      out.push({ path: `${at}.actor`, message: `"${step.actor}" is not an actor entity` });
      return;
    }
    const fieldOf = (id: string, path: string) => {
      const def = own(actor.fields, id);
      if (def === undefined) out.push({ path, message: `${actor.id} has no field "${id}"` });
      return def;
    };
    if (step.kind === "choose") {
      const picked = entities.get(step.pick);
      if (picked === undefined) out.push({ path: `${at}.pick`, message: `unknown entity "${step.pick}"` });
      if (step.copy.length > 0 && step.count !== 1)
        out.push({ path: `${at}.copy`, message: "copy needs count 1: with several picks it is ambiguous" });
      step.copy.forEach((c, j) => {
        const to = fieldOf(c.to, `${at}.copy[${j}].to`);
        const from = picked === undefined ? undefined : own(picked.fields, c.from);
        if (picked !== undefined && from === undefined)
          out.push({ path: `${at}.copy[${j}].from`, message: `${picked.id} has no field "${c.from}"` });
        if (from !== undefined && to !== undefined && from.type !== to.type)
          out.push({ path: `${at}.copy[${j}]`, message: `a ${from.type} field cannot fill a ${to.type} field` });
        claim({ actor: actor.id, field: c.to, step: step.id, path: `${at}.copy[${j}].to` });
      });
      return;
    }
    step.fields.forEach((id, j) => {
      const def = fieldOf(id, `${at}.fields[${j}]`);
      if (step.kind === "assign" && def !== undefined && def.type !== "int")
        out.push({ path: `${at}.fields[${j}]`, message: "a scored field must be an int" });
      claim({ actor: actor.id, field: id, step: step.id, path: `${at}.fields[${j}]` });
    });
    if (step.kind !== "assign") return;
    const m = step.method;
    if (m.kind === "table" && m.values.length !== step.fields.length)
      out.push({ path: `${at}.method.values`, message: `${m.values.length} values for ${step.fields.length} fields` });
    if (m.kind === "pointBuy") {
      if (m.max < m.min) out.push({ path: `${at}.method.max`, message: "max is below min" });
      // min and max are capped at ±1000 by the schema, so this loop is short.
      for (let score = m.min; score <= m.max; score++) {
        if (own(m.costs, String(score)) !== undefined) continue;
        out.push({ path: `${at}.method.costs`, message: `no cost for the score ${score}` });
        break;
      }
    }
  });
}

/** Every face range fits the die, bands never overlap, and `shift` names a band. */
function poolProblems({ t, path, out }: { t: PoolSuccesses; path: string; out: Problem[] }): void {
  const range = (f: FaceRange, at: string) => {
    if (f.to < f.from) out.push({ path: `${at}.to`, message: "to is below from" });
    if (f.to > t.die) out.push({ path: `${at}.to`, message: `a d${t.die} has no face ${f.to}` });
  };
  duplicates({ ids: t.bands.map((b) => b.id), path: `${path}.bands`, out });
  t.bands.forEach((b, i) => {
    range(b, `${path}.bands[${i}]`);
    const other = t.bands.findIndex((o, j) => j < i && o.from <= b.to && b.from <= o.to);
    if (other >= 0) out.push({ path: `${path}.bands[${i}]`, message: `overlaps bands[${other}]` });
  });
  for (const [flag, f] of Object.entries(t.special?.flags ?? {})) range(f, `${path}.special.flags.${flag}`);
  if (t.shift !== undefined && !t.bands.some((b) => b.id === t.shift))
    out.push({ path: `${path}.shift`, message: `no band "${t.shift}"` });
}

function semanticProblems(r: Ruleset): Problem[] {
  const out: Problem[] = [];
  // CLAUDE.md principle 1: every rule entry cites its printed page, unless the whole ruleset is homebrew.
  const homebrew = r.sources.every((s) => s.license === "homebrew");
  const needCite = (cite: string | undefined, path: string) => {
    if (!homebrew && cite === undefined) out.push({ path: `${path}.cite`, message: "a rule entry needs a cite" });
  };
  r.resources.forEach((x, i) => needCite(x.cite, `resources[${i}]`));
  r.options.forEach((x, i) => needCite(x.cite, `options[${i}]`));
  r.conditions.forEach((c, i) => {
    needCite(c.cite, `conditions[${i}]`);
    c.effects.forEach((e, j) => needCite(e.cite ?? c.cite, `conditions[${i}].effects[${j}]`));
  });
  for (const [id, t] of Object.entries(r.tests)) {
    needCite(t.cite, `tests.${id}`);
    if (t.kind === "sumVsTarget" && t.degrees) needCite(t.degrees.cite, `tests.${id}.degrees`);
    if (t.kind === "reported") t.outcomes.forEach((o, j) => needCite(o.cite, `tests.${id}.outcomes[${j}]`));
  }
  if (r.initiative) needCite(r.initiative.cite, "initiative");
  r.phases?.forEach((x, i) => needCite(x.cite, `phases[${i}]`));
  if (r.scoring) {
    needCite(r.scoring.cite, "scoring");
    r.scoring.endWhen.forEach((x, i) => needCite(x.cite, `scoring.endWhen[${i}]`));
    const { mode, endWhen } = r.scoring;
    endWhen.forEach((x, i) => {
      if (mode === "compete" && x.outcome !== undefined)
        out.push({ path: `scoring.endWhen[${i}].outcome`, message: "only a cooperative game has an outcome" });
      if (mode === "coop" && x.outcome === undefined)
        out.push({ path: `scoring.endWhen[${i}].outcome`, message: "a cooperative trigger names its outcome" });
    });
    if (mode === "coop" && !endWhen.some((x) => x.outcome === "win"))
      out.push({ path: "scoring.endWhen", message: "a cooperative game needs a trigger that wins" });
  }
  // Death saves and damage order are rules too.
  if (r.health.tracks.length > 0) needCite(r.health.cite, "health");
  r.creation.forEach((x, i) => needCite(x.cite, `creation[${i}]`));

  const fieldCount = r.entities.reduce((n, e) => n + Object.keys(e.fields).length + e.derived.length, 0);
  if (fieldCount > MAX_FIELDS)
    out.push({ path: "entities", message: `${fieldCount} fields, over the cap of ${MAX_FIELDS}` });

  if (r.extends?.id === r.id) out.push({ path: "extends.id", message: "a ruleset cannot extend itself" });
  duplicates({ ids: r.sources.map((s) => s.id), path: "sources", out });
  duplicates({ ids: r.entities.map((e) => e.id), path: "entities", out });
  duplicates({ ids: r.resources.map((x) => x.id), path: "resources", out });
  duplicates({ ids: r.conditions.map((x) => x.id), path: "conditions", out });
  duplicates({ ids: (r.phases ?? []).map((x) => x.id), path: "phases", out });
  duplicates({ ids: r.options.map((x) => x.id), path: "options", out });
  duplicates({ ids: r.creation.map((x) => x.id), path: "creation", out });
  duplicates({ ids: r.decisions.map((x) => x.id), path: "decisions", out });
  creationProblems(r, out);

  const entityIds = new Set(r.entities.map((e) => e.id));
  r.entities.forEach((e, i) => {
    duplicates({ ids: e.derived.map((d) => d.id), path: `entities[${i}].derived`, out });
    const ids = Object.keys(e.fields);
    for (const id of ids) {
      const path = `entities[${i}].fields.${id}`;
      const root = id.split(".")[0] ?? id;
      if (RESERVED_ROOTS.has(root)) out.push({ path, message: `"${root}" is reserved for expressions` });
      // `attr` and `attr.str` cannot both be fields: `attr` would be a value and a group at once.
      if (ids.some((other) => other.startsWith(`${id}.`)))
        out.push({ path, message: "is also a group of other fields" });
      const def = e.fields[id];
      if (def?.type === "ref" && !entityIds.has(def.entity)) {
        out.push({ path: `${path}.entity`, message: `unknown entity "${def.entity}"` });
      }
      if (def?.type === "int" && def.min !== undefined && def.max !== undefined && def.max < def.min) {
        out.push({ path: `${path}.max`, message: "max is below min" });
      }
    }
  });

  const resources = new Map(r.resources.map((x) => [x.id, x]));
  r.resources.forEach((x, i) => {
    x.entities?.forEach((id, j) => {
      if (!entityIds.has(id)) out.push({ path: `resources[${i}].entities[${j}]`, message: `unknown entity "${id}"` });
    });
    if (x.entities !== undefined && x.scope !== "entity") {
      out.push({ path: `resources[${i}].entities`, message: "only an entity-scoped resource names entities" });
    }
  });

  const trackResource = (id: string, path: string) => {
    const res = resources.get(id);
    if (res === undefined) out.push({ path, message: `unknown resource "${id}"` });
    else if (res.scope !== "entity") out.push({ path, message: `"${id}" must be an entity-scoped resource` });
  };
  r.health.tracks.forEach((t, i) => {
    trackResource(t.resource, `health.tracks[${i}].resource`);
    if (t.temp !== undefined) trackResource(t.temp, `health.tracks[${i}].temp`);
  });
  // One dying/stable/dead status per actor, so only one track can run death saves.
  if (r.health.tracks.filter((t) => t.deathSaves !== undefined).length > 1) {
    out.push({ path: "health.tracks", message: "only one track may have deathSaves" });
  }

  for (const [id, t] of Object.entries(r.tests)) {
    for (const key of Object.keys(t.inputOptions)) {
      if (t.inputs[key] !== "text")
        out.push({ path: `tests.${id}.inputOptions.${key}`, message: "options are only for text inputs" });
    }
    if (t.kind === "poolSuccesses") {
      poolProblems({ t, path: `tests.${id}`, out });
      continue;
    }
    if (t.kind === "reported") {
      const seen = new Set<string>();
      t.outcomes.forEach((o, j) => {
        if (seen.has(o.id)) out.push({ path: `tests.${id}.outcomes[${j}].id`, message: `duplicate outcome "${o.id}"` });
        seen.add(o.id);
      });
      continue;
    }
    const shape = plainDice(t.dice);
    if (shape === null) {
      out.push({ path: `tests.${id}.dice`, message: "sumVsTarget takes plain NdX dice" });
      continue;
    }
    if (t.advantage && shape.count !== 1) {
      out.push({ path: `tests.${id}.advantage`, message: "advantage needs a single die (1dX)" });
    }
    t.critOn?.forEach((n, j) => {
      if (n > shape.count * shape.sides)
        out.push({ path: `tests.${id}.critOn[${j}]`, message: `${n} cannot be rolled` });
    });
    if (t.degrees !== undefined) {
      if (t.critOn !== undefined) out.push({ path: `tests.${id}.critOn`, message: "degrees replace critOn" });
      if (t.degrees.naturalShift && shape.count !== 1) {
        out.push({ path: `tests.${id}.degrees.naturalShift`, message: "a natural shift needs a single die (1dX)" });
      }
    }
  }
  return out;
}

/**
 * Size caps, schema, then the rules a schema can't say: cites (unless homebrew), the field cap, unique ids and
 * references. Expressions are checked by `compileRuleset`, which runs this first.
 */
export function validateRuleset(input: unknown): ValidateResult {
  const size = byteSize(input);
  if (size === null) return { ok: false, problems: [{ path: "(root)", message: "not a JSON document" }] };
  if (size > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      problems: [{ path: "(root)", message: `${size} bytes, over the cap of ${MAX_MANIFEST_BYTES}` }],
    };
  }
  const parsed = Ruleset.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  const problems = semanticProblems(parsed.data);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, ruleset: parsed.data };
}
