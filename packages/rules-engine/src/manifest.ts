import { z } from "zod";

import { BuildParams } from "./build/params.ts";
import { MAX_SIDES, parseDice } from "./dice/dice.ts";
import {
  ConditionDuration,
  ConditionStacking,
  CodexEntryKind,
  CodexFieldVisibility,
  CreationKind,
  EditableBy,
  EffectMode,
  EnumTone,
  EffectPhase,
  EntityBase,
  License,
  PoolFlag,
  ReminderAt,
  ResetEvent,
  ResourceScope,
  ScalarType,
  ScoreMethodKind,
  TieRule,
  Visibility,
} from "./enums.ts";
import { MAX_EXPR_LENGTH } from "./expr/expr.ast.ts";
import { checkFieldValue } from "./field-value.ts";
import { own } from "./own.ts";
import { formatPath, type Problem } from "./problem.ts";
import { LAYOUT_TARGETS, MAX_PIP_STEPS, MAX_PIPS_PER_STEP, type WidgetSpec, widgetSpec } from "./widgets.ts";

/** Manifests are user-written imports stored as JSONB: bound them before anything else reads them. */
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_FIELDS = 2000;

export const Id = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9]*$/, "use camelCase letters and digits");
/** A pack entry's key, as pack.ts EntryKey has it (it imports this file, so the pattern is repeated here). */
export const PackKey = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+([-_.][a-z0-9]+)*$/, "use lowercase letters, digits and - _ .");
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
/**
 * What a definition means, in the importer's own words, never the book's (house decision #126): a new player taps the
 * name and reads it with the cite. At most 300 characters; 280 is the guidance, as for a pack's text (house decision #17).
 */
export const MAX_SUMMARY = 300;
export const Summary = z.string().trim().min(1).max(MAX_SUMMARY);
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
  summary: Summary.optional(),
};

/**
 * What the screens show for an enum's values (house decision #71), keyed by value id: `labels` the word (a value
 * without one shows as its id), `notes` a short line beside it, `tones` the Theme's good or bad treatment (house
 * decision #76). Optional on every enum.
 */
const enumWords = {
  labels: z.record(Id, z.string().min(1).max(60)).optional(),
  notes: z.record(Id, z.string().min(1).max(40)).optional(),
  tones: z.record(Id, EnumTone).optional(),
};
const intShape = { type: z.literal("int"), min: z.int().optional(), max: z.int().optional() };
const textShape = { type: z.literal("text"), maxLength: z.int().min(1).max(10_000).optional() };
const enumShape = { type: z.literal("enum"), values: z.array(Id).min(1).max(200), ...enumWords };
/** A reference to another actor or entry of the given entity type. */
const refShape = { type: z.literal("ref"), entity: Id };

export const FieldDef = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, ...intShape }),
  z.object({ ...fieldBase, ...textShape }),
  z.object({ ...fieldBase, ...enumShape }),
  z.object({ ...fieldBase, type: z.literal("bool") }),
  z.object({ ...fieldBase, ...refShape }),
  // ponytail: a list holds text items only; typed lists (of refs, of ints) when a ruleset needs them.
  z.object({
    ...fieldBase,
    type: z.literal("list"),
    maxItems: z.int().min(1).max(500).optional(),
    /** House decision #91: its items show as chips where Condition chips show, each ended by itself or all at once. */
    chips: z.boolean().optional(),
    /** House decision #91: where the screen's quick picks come from: the names of pack entries of this entity type. */
    picks: z.object({ entity: Id }).optional(),
  }),
]);
export type FieldDef = z.infer<typeof FieldDef>;

const campaignFieldBase = { label: z.string().min(1).max(80), cite: Cite.optional(), summary: Summary.optional() };
const CAMPAIGN_INT = z.int().min(-1000).max(1000);

/**
 * A value that belongs to the whole campaign (a tier, a chapter) and that many formulas read as `campaign.<id>`.
 * Only whole numbers, one of a few words, or a yes/no: no text, ref or list.
 */
export const CampaignField = z.discriminatedUnion("type", [
  z.object({
    ...campaignFieldBase,
    type: z.literal("int"),
    min: CAMPAIGN_INT,
    max: CAMPAIGN_INT,
    default: CAMPAIGN_INT,
  }),
  z.object({
    ...campaignFieldBase,
    type: z.literal("enum"),
    values: z.array(Id).min(1).max(20),
    ...enumWords,
    default: Id,
  }),
  z.object({ ...campaignFieldBase, type: z.literal("bool"), default: z.boolean() }),
]);
export type CampaignField = z.infer<typeof CampaignField>;

export const MAX_CAMPAIGN_FIELDS = 50;

const codexFieldBase = {
  label: z.string().min(1).max(80),
  visibility: CodexFieldVisibility.default("gm"),
  cite: Cite.optional(),
  summary: Summary.optional(),
};

// Ceilings of a `tags` and a `rows` field (house decision #89); a declaration's own `maxItems`, `maxRows` and a text
// column's `maxLength` may only tighten them. The field-value check and the Go twin read the same numbers.
export const MAX_TAGS = 30;
export const MAX_TAG_CHARS = 60;
export const MAX_ROWS = 30;
export const MAX_ROW_COLUMNS = 8;
export const MAX_CELL_CHARS = 500;
export const MAX_ROW_PREFILLS = 5;
export const MAX_CODEX_REMINDERS = 20;

/**
 * One column of a `rows` field (house decision #89): an entry field's types, plus `test`, a Test of the ruleset with
 * its inputs, the two things a scene's prepared Test line holds (`testId`, `inputs`).
 */
const columnBase = { id: Id, label: z.string().min(1).max(60) };
export const RowColumn = z.discriminatedUnion("type", [
  z.object({ ...columnBase, ...intShape }),
  z.object({ ...columnBase, type: z.literal("text"), maxLength: z.int().min(1).max(MAX_CELL_CHARS).optional() }),
  z.object({ ...columnBase, ...enumShape }),
  z.object({ ...columnBase, type: z.literal("bool") }),
  z.object({ ...columnBase, ...refShape }),
  z.object({ ...columnBase, type: z.literal("test") }),
]);
export type RowColumn = z.infer<typeof RowColumn>;

/**
 * How a pack entry of `entity` fills a new row (house decision #89): `name` the text column that takes the entry's
 * name, `values` a column id to the entity field whose value it takes. The row keeps the entry's key and cite.
 */
export const RowPrefill = z.object({
  entity: Id,
  name: Id.optional(),
  values: z.record(Id, FieldId).optional(),
});
export type RowPrefill = z.infer<typeof RowPrefill>;

/**
 * Tables whose rolled lines fill a text field, or an entry's title, in the GM's editor (house decision #97): each table
 * in order, the lines' labels joined by `join` (a space when it does not say). A prep aid: nothing is saved by a roll.
 */
export const FieldRoll = z.object({
  tables: z.array(Id).min(1).max(4),
  join: z.string().max(10).optional(),
});
export type FieldRoll = z.infer<typeof FieldRoll>;

/**
 * How a pack entry of `entity` makes a codex entry of a kind (house decision #97): the mapping a row's prefill has
 * (`name` a text field that also takes the entry's name, `values` a field id to the entity field it takes; the title
 * always takes the name), plus `children`, a ref field of the entity naming its own type, whose served entries come
 * along nested under it; and for a scene, `tests`, a list field of Test ids that become prepared Test lines with
 * `inputs` taken from the entity's fields, and `roster`, a list field of pack keys that become roster lines.
 */
export const EntryPrefill = RowPrefill.extend({
  children: FieldId.optional(),
  tests: z.object({ field: FieldId, inputs: z.record(Id, FieldId).optional() }).optional(),
  roster: FieldId.optional(),
});
export type EntryPrefill = z.infer<typeof EntryPrefill>;

/**
 * A field a kind of codex entry carries (ADR 0012 decision 2, house decision #71): an entity field's types and shapes,
 * seen by the GM side or the party; no `editableBy` (only the codex writers write it) and no list. Two types are the
 * codex's own (house decision #89): `tags`, short words suggested by pack entries' names or fixed options, written in
 * when `writeIn`; and `rows`, typed rows that a pack entry may fill (`from`) and a scene may pick (`pick`).
 */
export const CodexField = z.discriminatedUnion("type", [
  z.object({ ...codexFieldBase, ...intShape }),
  /** `roll`: tables the GM's editor rolls into it (house decision #97). */
  z.object({ ...codexFieldBase, ...textShape, roll: FieldRoll.optional() }),
  z.object({ ...codexFieldBase, ...enumShape }),
  z.object({ ...codexFieldBase, type: z.literal("bool") }),
  z.object({ ...codexFieldBase, ...refShape }),
  /** A link to another entry of the room, of the given kind (house decision #76); codex fields only. */
  z.object({ ...codexFieldBase, type: z.literal("entry"), kind: CodexEntryKind }),
  z.object({
    ...codexFieldBase,
    type: z.literal("tags"),
    maxItems: z.int().min(1).max(MAX_TAGS).optional(),
    /** Pack entry types whose served entries' names are offered. */
    entities: z.array(Id).min(1).max(10).optional(),
    /** Fixed words offered, stored as their id and shown by `labels`. */
    options: z.array(Id).min(1).max(200).optional(),
    labels: z.record(Id, z.string().min(1).max(MAX_TAG_CHARS)).optional(),
    /** Whether a word outside the suggestions may be written in. */
    writeIn: z.boolean().default(false),
  }),
  z.object({
    ...codexFieldBase,
    type: z.literal("rows"),
    columns: z.array(RowColumn).min(1).max(MAX_ROW_COLUMNS),
    maxRows: z.int().min(1).max(MAX_ROWS).optional(),
    from: z.array(RowPrefill).min(1).max(MAX_ROW_PREFILLS).optional(),
    /** A scene may pick this field's rows, each with one switch of this name (a prep `picks` line). */
    pick: z.object({ label: z.string().min(1).max(40) }).optional(),
  }),
]);
export type CodexField = z.infer<typeof CodexField>;

export const MAX_CODEX_FIELDS = 20;

/**
 * A line an entry's card shows while its values meet `if` (house decision #89): `if` a boolean over the kind's fields
 * as `fields.<id>`, `text` the ruleset's own short words. Only a seat that reads every field `if` reads is shown it.
 */
export const CodexReminder = z.object({
  id: Id,
  if: ExprSource,
  text: z.string().min(1).max(120),
  cite: Cite.optional(),
});
export type CodexReminder = z.infer<typeof CodexReminder>;

/** The fields each kind of codex entry carries. Absent: an entry is a title and two texts, as in a room without one. */
export const CodexBlock = z.object({
  kinds: z.partialRecord(
    CodexEntryKind,
    z.object({
      fields: z
        .record(Id, CodexField)
        .refine((o) => Object.keys(o).length <= MAX_CODEX_FIELDS, `at most ${MAX_CODEX_FIELDS} fields`),
      reminders: z.array(CodexReminder).max(MAX_CODEX_REMINDERS).optional(),
      /** The pack entry types an entry of this kind is made from, and how (house decision #97). */
      from: z.array(EntryPrefill).min(1).max(MAX_ROW_PREFILLS).optional(),
      /** Tables the GM's editor rolls into an entry's title (house decision #97). */
      titleRoll: FieldRoll.optional(),
      /** The fields an entry of this kind needs filled before it is ready for the table (house decision #107). */
      ready: z.array(Id).min(1).max(MAX_CODEX_FIELDS).optional(),
    }),
  ),
});
export type CodexBlock = z.infer<typeof CodexBlock>;
export type CodexKindDef = NonNullable<CodexBlock["kinds"][keyof CodexBlock["kinds"]]>;

export const DerivedDef = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  expr: ExprSource,
  visibility: Visibility.default("gm"),
  cite: Cite.optional(),
  summary: Summary.optional(),
  /**
   * An int field of the same entity that holds a GM's override (house decision #96): set, it replaces the worked-out
   * value; unset, the value is worked out. Absent: the value is never overridden.
   */
  override: FieldId.optional(),
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
  summary: Summary.optional(),
  scope: ResourceScope,
  /** Entity types that carry an `entity`-scoped resource; every `actor`-based type when omitted. */
  entities: z.array(Id).optional(),
  min: ExprSource.default("0"),
  max: ExprSource.optional(),
  /** false: the value may run past max (a damage track that counts overflow). */
  capped: z.boolean().default(true),
  /** `to` may name `max` and `min`, the resource's own bounds. */
  resetOn: z.array(z.object({ event: ResetEvent, to: ExprSource })).default([]),
  /** The value a new holder starts with; may name `max` and `min`, the resource's own bounds, like `resetOn[].to`. Absent: house decision #23. */
  start: ExprSource.optional(),
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
  summary: Summary.optional(),
  effects: z.array(Effect).max(50).default([]),
  stacking: ConditionStacking.default("none"),
  maxStacks: z.int().min(1).max(100).optional(),
  duration: ConditionDuration,
  /**
   * `ownTurnEnd` only (house decision #81): added during its holder's own turn, it survives that turn's end and ends at
   * the end of the next one; added at any other time it ends at the holder's next turn end, as without it.
   */
  from: z.literal("nextOwnTurn").optional(),
  /** Who sees that an actor has it. Fail-closed like everything else. */
  visibility: Visibility.default("gm"),
  /** A reminder line for the side running the fight while an actor holds it (house decision #81); both or neither. */
  at: ReminderAt.optional(),
  text: z.string().min(1).max(120).optional(),
  /** A boolean in the actor's scope: `condition.add` is refused on an actor it holds for (house decision #81). */
  immune: ExprSource.optional(),
});
export type Condition = z.infer<typeof Condition>;

/**
 * A line the side running a fight is reminded of (house decision #81), in the ruleset's own words. `if` is a boolean in
 * the scope of the combatant whose turn it is, which also reads `round`, `held` and `barred`; at `roundEnd` it is asked
 * of every combatant and the line names the ones it holds for. No `if`: the line always shows, naming nobody.
 */
export const Reminder = z.object({
  id: Id,
  at: ReminderAt,
  text: z.string().min(1).max(120),
  cite: Cite.optional(),
  if: ExprSource.optional(),
});
export type Reminder = z.infer<typeof Reminder>;

/** A rest event an actor takes no part in while one of these health states holds for it (house decision #81). */
export const RestRule = z.object({
  event: ResetEvent,
  refusedIn: z.array(Id).min(1).max(20),
  cite: Cite.optional(),
});
export type RestRule = z.infer<typeof RestRule>;

/**
 * The actor entity types a Test or a health state applies to (house decision #50). Absent: every actor type, and the
 * expressions are then checked against each of them.
 */
const ActorTypes = z.array(Id).min(1).max(50).optional();

export const RuleOption = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  default: z.boolean().default(false),
});
export type RuleOption = z.infer<typeof RuleOption>;

/**
 * What the screens call a Test, its inputs and a text input's options (house decision #77); without a word the id (or
 * the option itself) shows. Optional on every kind of Test. `inputLabels` names inputs, `inputOptionLabels` an input's
 * declared options.
 */
const testWords = {
  label: z.string().min(1).max(80).optional(),
  inputLabels: z.record(Id, z.string().min(1).max(60)).optional(),
  inputOptionLabels: z.record(Id, z.record(z.string().min(1).max(60), z.string().min(1).max(60))).optional(),
};

export const MAX_OFFERS = 10;
export const MAX_MARKS = 10;

/** One write an offer makes: to a shared pool, or to a resource of the taker, by an integer expression. */
export const OfferChange = z.object({ pool: Id.optional(), resource: Id.optional(), by: ExprSource });
export type OfferChange = z.infer<typeof OfferChange>;

/**
 * What a called Test's result offers the GM (house decision #80): when `when` holds for a taker's resolved report (read
 * as `result.*` and the call's `ctx.*`), one tap applies `changes` through the ordinary writes, once.
 */
export const TestOffer = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  when: ExprSource,
  changes: z.array(OfferChange).min(1).max(5),
  cite: Cite.optional(),
});
export type TestOffer = z.infer<typeof TestOffer>;

/**
 * A Test's marks and offers (house decision #80): a mark is a yes-or-no the GM sets when calling, read as `ctx.<id>`
 * like an input and never filled in by a taker; false when the call leaves it out.
 */
const testOutcomes = {
  marks: z
    .record(Id, z.object({ label: z.string().min(1).max(60), cite: Cite.optional() }))
    .refine((o) => Object.keys(o).length <= MAX_MARKS, `at most ${MAX_MARKS} marks`)
    .optional(),
  offers: z.array(TestOffer).max(MAX_OFFERS).optional(),
};

// What every kind of Test declares: the number it is compared with, how a tie goes, and what the GM fills in to call it.
const testBase = {
  target: ExprSource,
  ties: TieRule.default("meetOrBeat"),
  /** Values the caller supplies when the Test is called, read as `ctx.<id>` (e.g. `ctx.dc`, `ctx.ability`). */
  inputs: z.record(Id, ScalarType).default({}),
  /** The allowed values of a text input; the call form shows a picker and the server refuses anything else. */
  inputOptions: z.record(Id, z.array(z.string().min(1).max(60)).min(1).max(50)).default({}),
  entities: ActorTypes,
  cite: Cite.optional(),
  ...testWords,
  ...testOutcomes,
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
  entities: ActorTypes,
  cite: Cite.optional(),
  ...testWords,
  ...testOutcomes,
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

const SideCost = z.object({ pool: Id, amount: z.int().min(1).max(20) });
export type SideCost = z.infer<typeof SideCost>;

/**
 * Sides alternate and the side that is up chooses who acts (house decision #57). Also the params of
 * `initiative.sides`. A cost names a shared pool by resource id; its side is a key of the record.
 */
export const SidesInitiative = z.object({
  strategy: z.literal("sides"),
  /** Their order is the order they pick in at the start of a round. */
  sides: z
    .array(
      z.object({
        id: Id,
        label: z.string().min(1).max(40),
        /** Actor entity types that join this side by default. */
        entities: z.array(Id).max(20).optional(),
      }),
    )
    .min(2)
    .max(4),
  /** Health states that leave a combatant unable to act while it has any. */
  unableStates: z.array(Id).max(20).optional(),
  /** fixed: the first side picks first every round. rotate: that moves one place along the list each round. */
  firstSide: z.enum(["fixed", "rotate"]).default("fixed"),
  /** auto: the round wraps when no able member is left. manual: it waits for `newRound`. */
  roundEnd: z.enum(["auto", "manual"]).default("auto"),
  /** Present: the fight opens not begun, and no turn starts before `begin`. `note` is shown to the GM meanwhile. */
  setup: z.object({ cite: Cite.optional(), note: z.string().min(1).max(200).optional() }).optional(),
  /** A side with no cost cannot act out of turn. */
  outOfTurn: z.object({ cost: z.record(Id, SideCost), cite: Cite.optional() }).optional(),
  /** A member may end its turn holding an action. */
  hold: z.object({ cite: Cite.optional() }).optional(),
  /** A member can be marked as taking no turn through `throughRound`; a side may pay to lift it. */
  barred: z
    .object({
      throughRound: z.int().min(1).max(10).default(1),
      liftCost: z.record(Id, SideCost).default({}),
      cite: Cite.optional(),
    })
    .optional(),
  cite: Cite.optional(),
});
export type SidesInitiative = z.infer<typeof SidesInitiative>;

/** One step of a round, played in turn or by everyone at once (house decision #37). */
export const Phase = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  mode: z.enum(["turns", "simultaneous"]),
  cite: Cite.optional(),
});
export type Phase = z.infer<typeof Phase>;

/** Who learns what a table rolled or dealt (house decision #49): the GM side, the whole table, or the card's holder. */
export const TableVisibility = z.enum(["gm", "party", "owner"]);
export type TableVisibility = z.infer<typeof TableVisibility>;

/** The most kinds of held record a ruleset declares, and a kind's default and highest `max` (house decision #88). */
export const MAX_HELD_KINDS = 10;
export const HELD_DEFAULT_MAX = 20;

/**
 * A kind of record an actor gains in play (house decision #88): the pack entries of type `entry` an actor of the
 * `entities` types holds, by key, in its `list` field `field`. What they hold feeds its numbers as a chosen entry's
 * effects do (house decision #61). With `unseen`, seats other than the holder's and the GM side's see each one's
 * effects under that word, never its name, key or cite; its field is then `owner` or `gm`.
 */
export const HeldKind = z.object({
  label: z.string().min(1).max(60),
  entry: Id,
  field: FieldId,
  entities: z.array(Id).min(1).max(50),
  unseen: z.string().min(1).max(60).optional(),
  max: z.int().min(1).max(50).optional(),
  /**
   * A list field of the entry type naming the records a record brings with it (house decision #165): a grant also
   * grants each of them the actor does not hold yet, skipping the ones it holds; the record itself still refuses twice.
   */
  includes: FieldId.optional(),
  cite: Cite.optional(),
});
export type HeldKind = z.infer<typeof HeldKind>;

/** The most kinds of item a ruleset declares, and an actor's default cap per kind (house decision #95). */
export const MAX_ITEM_KINDS = 20;
export const ITEM_DEFAULT_MAX = 60;
/** The `cards` variants an item kind may be drawn in. */
export const ITEM_CARDS = ["weapons", "armour", "gear"] as const;

/**
 * The values of a `cards` variant a fitting's effect may change on its host (house decision #102), as `host.<value>`:
 * a weapon's numbers, an armour's rating. A gear line has none.
 */
export const CARD_VALUES: Readonly<Record<(typeof ITEM_CARDS)[number], readonly string[]>> = {
  weapons: ["damage", "ed", "ap", "salvo"],
  armour: ["ar"],
  gear: [],
};
export const HOST_PREFIX = "host.";

/** The host values a fitting of entry type `type` may change: the card values of every kind its kinds fit to. */
export function hostValuesOf({ items, type }: { items: ItemsBlock | undefined; type: string }): string[] {
  const kinds = items?.kinds ?? [];
  const hosts = kinds.filter((k) => k.entry === type).flatMap((k) => k.fits?.to ?? []);
  return [
    ...new Set(
      kinds.filter((k) => hosts.includes(k.id)).flatMap((k) => (k.card === undefined ? [] : CARD_VALUES[k.card])),
    ),
  ];
}

/**
 * A kind of item an actor holds in play (house decision #95): the pack entries of type `entry` (carrying `tag`, when
 * given; the first kind in the list that matches an entry is its kind) held by the `entities` actor types, one row per
 * item. `stacks`: a quantity, one row per entry or hand-written name, and a row whose quantity reaches 0 is gone;
 * `spend`: the holder may lower it (the GM sets it). `unique`: one of an entry per actor. `max`: how many an actor
 * holds. `fits`: an item of this kind is fitted to a held item of a kind in `to`, at most `max` on one host, one per
 * value of the entry's `slot` field, and an entry tagged `gmTag` fitted by the GM side only; its effects count only
 * while it is fitted. `card`: the `cards` variant that draws it.
 */
export const ItemKind = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  entry: Id,
  tag: z.string().min(1).max(40).optional(),
  entities: z.array(Id).min(1).max(50),
  card: z.enum(ITEM_CARDS).optional(),
  max: z.int().min(1).max(200).optional(),
  unique: z.boolean().optional(),
  stacks: z.boolean().optional(),
  spend: z.boolean().optional(),
  fits: z
    .object({
      to: z.array(Id).min(1).max(10),
      max: z.int().min(1).max(10),
      slot: FieldId.optional(),
      gmTag: z.string().min(1).max(40).optional(),
    })
    .optional(),
  cite: Cite.optional(),
});
export type ItemKind = z.infer<typeof ItemKind>;

/**
 * Items actors hold in play (house decision #95). `give`: the codex `item` field (a `ref`) that names the pack entry a
 * GIVE hands over, and the kind an item entry without one is given as, by its title.
 */
/** One labelled part of a number an acquisition works out (house decision #102): the breakdown shows each. */
export const AcquirePart = z.object({ label: z.string().min(1).max(60), value: ExprSource });
export type AcquirePart = z.infer<typeof AcquirePart>;

/** The offers an acquisition's call carries, beside the Test's own (house decision #102). */
export const ACQUIRE_OFFERS = { grant: "acquire", topUp: "acquireTopUp" } as const;

/**
 * Acquiring an item by a Test (house decision #102): the Test rolled, each of its inputs the sum of labelled parts
 * read over the asking actor's scope, `item` (the entry's declared fields and its `tags`) and `ctx` (the asker's
 * picks); `if` whether it may be asked; `limits` how many Tests of some kinds an actor takes in one session;
 * `topUp` the resource a failed roll may be topped up with, one per point short, at most `max`; `quantity` how many of
 * a counted kind it grants; `load` the counted item an entry's field names, granted with it.
 */
export const ItemAcquire = z.object({
  test: Id,
  /** The kinds that may be acquired; absent: every kind. */
  kinds: z.array(Id).min(1).max(MAX_ITEM_KINDS).optional(),
  inputs: z
    .record(Id, z.array(AcquirePart).min(1).max(6))
    .refine((o) => Object.keys(o).length <= 6, "at most 6 inputs"),
  picks: z
    .record(Id, z.object({ label: z.string().min(1).max(60), min: z.int().min(-1000).max(1000), max: ExprSource }))
    .refine((o) => Object.keys(o).length <= 3, "at most 3 picks")
    .optional(),
  if: ExprSource.optional(),
  limits: z
    .array(z.object({ kinds: z.array(Id).min(1).max(MAX_ITEM_KINDS), max: z.int().min(1).max(10) }))
    .max(10)
    .optional(),
  topUp: z.object({ resource: Id, max: ExprSource.optional() }).optional(),
  quantity: ExprSource.optional(),
  load: z.object({ field: FieldId, quantity: ExprSource }).optional(),
  cite: Cite.optional(),
});
export type ItemAcquire = z.infer<typeof ItemAcquire>;

export const ItemsBlock = z.object({
  kinds: z.array(ItemKind).min(1).max(MAX_ITEM_KINDS),
  give: z.object({ ref: Id, loose: Id }).optional(),
  acquire: ItemAcquire.optional(),
});
export type ItemsBlock = z.infer<typeof ItemsBlock>;

/** The most effects a row applies, inputs a lookup takes, and times one effect repeats (house decision #87). */
export const MAX_ROW_EFFECTS = 8;
export const MAX_LOOKUP_INPUTS = 6;
export const MAX_EFFECT_TIMES = 20;

const effectBase = {
  /** Boolean over the inputs (`ctx.<id>`) and the target: the effect applies only when it holds. */
  when: ExprSource.optional(),
  /** Integer over the inputs and the target: how many times the effect applies (default 1, at most 20). */
  times: ExprSource.optional(),
};

/**
 * One effect of a lookup row on the target actor (house decision #87), applied through the ordinary operation: a hit
 * through `health.harm`, a condition as `condition.add`, a resource of the target or a shared pool by delta. Every
 * amount is an integer expression over the inputs and the target.
 */
export const TableEffect = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("harm"), wounds: ExprSource.optional(), shock: ExprSource.optional(), ...effectBase }),
  z.object({ kind: z.literal("condition"), condition: Id, ...effectBase }),
  z.object({ kind: z.literal("resource"), resource: Id, by: ExprSource, ...effectBase }),
  z.object({ kind: z.literal("pool"), pool: Id, by: ExprSource, ...effectBase }),
  // Grants the target the pack entry `entry` (its key) as a record of kind `held` (house decision #88).
  z.object({ kind: z.literal("grant"), held: Id, entry: PackKey, ...effectBase }),
]);
export type TableEffect = z.infer<typeof TableEffect>;
export type TableEffectKind = TableEffect["kind"];

/** A value the GM sets before applying a lookup, read as `ctx.<id>`: a switch, or a stepper within its bounds. */
export const TableInput = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  type: z.enum(["bool", "int"]),
  min: z.int().min(-1000).max(1000).optional(),
  max: z.int().min(-1000).max(1000).optional(),
  /**
   * A die the GM rolls at the table and types (house decision #164), plain `NdX` ("1d3 more wounds"): a whole number
   * from N to N*X, which are its bounds in place of `min` and `max`. Only a lookup's input takes one.
   */
  dice: z.string().min(1).max(20).optional(),
  cite: Cite.optional(),
});
export type TableInput = z.infer<typeof TableInput>;

/** An input's bounds: its dice notation's range (house decision #164), else its own `min` and `max`. */
export function inputBounds(x: Pick<TableInput, "min" | "max" | "dice">): { min?: number; max?: number } {
  const d = x.dice === undefined ? null : plainDice(x.dice);
  if (d === null) return { min: x.min, max: x.max };
  return { min: d.count, max: d.count * d.sides };
}

/**
 * One line of a random table. With a `die` it owns the outcomes in `range` (both ends inclusive; the last line may
 * leave `to` out and read every total from `from` up); without one it has a `weight`. `count` is the copies it adds to
 * a deck that is dealt. A lookup's line may `apply` effects to a target, carry the importer's own short `note` and its
 * page, and name the table the GM goes to `next` (house decision #87).
 */
export const TableEntry = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  /** [from, to], both ends inclusive; [from] on the last line is open-ended. */
  range: z.array(z.int().min(-100_000).max(100_000)).min(1).max(2).optional(),
  weight: z.int().min(1).max(100).optional(),
  count: z.int().min(1).max(20).optional(),
  apply: z.array(TableEffect).min(1).max(MAX_ROW_EFFECTS).optional(),
  note: z.string().min(1).max(200).optional(),
  cite: Cite.optional(),
  next: Id.optional(),
});
export type TableEntry = z.infer<typeof TableEntry>;

/**
 * A random table (design §3.4): rolled on a `die` whose outcomes the ranges tile exactly, or by weight; or dealt
 * without replacement to characters. Never book text: the labels are the importer's own short words. A table with a
 * die may be a lookup (house decision #87): `typedOnly` takes the GM's typed result and is never rolled, `inputs` are
 * set before applying, `modifier` is added to the result before a line is read, and `entities` are the actor types it
 * applies to.
 */
export const RandomTable = z.object({
  title: z.string().min(1).max(80),
  die: DiceNotation.optional(),
  // Empty only in a seat's copy, which hides the entries of a table it may not read; a manifest needs at least one.
  entries: z.array(TableEntry).max(200),
  visibility: TableVisibility,
  cite: Cite.optional(),
  typedOnly: z.boolean().optional(),
  inputs: z.array(TableInput).min(1).max(MAX_LOOKUP_INPUTS).optional(),
  modifier: ExprSource.optional(),
  entities: z.array(Id).min(1).max(50).optional(),
});
export type RandomTable = z.infer<typeof RandomTable>;

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

export const Initiative = z.discriminatedUnion("strategy", [RankedInitiative, SeatedInitiative, SidesInitiative]);
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

/**
 * How one group of actor types takes a hit under `health.harm` (house decision #66). Every expression is read on the
 * actor before the hit; `felled.when` is read again with the new wounds to see whether the hit brought it down.
 */
export const HarmProfile = z.object({
  /** The actor types this profile applies to; a type sits in one profile at most. */
  entities: z.array(Id).min(1).max(50),
  /** Boolean: this actor never takes shock. */
  shockless: ExprSource.optional(),
  /** Already past its shock limit: the boolean holds, or the actor has any of the conditions. Its shock becomes wounds. */
  spent: z.object({ when: ExprSource.optional(), conditions: z.array(Id).max(20).optional() }).optional(),
  felled: z
    .object({
      /** Boolean: the actor is down. */
      when: ExprSource,
      /** An int field: one more for each wounding hit taken while down. */
      injuries: FieldId.optional(),
      /** Added when a hit brings the actor down. */
      condition: Id.optional(),
      /** Number: healing while down leaves wounds at most this. */
      healTo: ExprSource.optional(),
    })
    .optional(),
  /** Number: one hit's wounds above `over` destroys the actor outright, which sets the bool `field`. */
  destroyed: z.object({ over: ExprSource, field: FieldId }).optional(),
  /** true: `convert` moves wounds to the second track for this profile (house decision #84). Absent: it is refused. */
  convert: z.boolean().optional(),
});
export type HarmProfile = z.infer<typeof HarmProfile>;

/** Damage that counts up toward a limit, and mobs: one combatant standing for many members (house decision #66). */
export const Harm = z.object({
  cite: Cite.optional(),
  /** An entity-scoped resource, `capped: false`: damage taken, counting up; its max is the limit. */
  wounds: Id,
  /** A second count-up track, like `wounds`. */
  shock: Id.optional(),
  /** `members`: a capped resource, the members standing; `start`: an int field, how many it started with. */
  mob: z.object({ members: Id, start: FieldId }).optional(),
  profiles: z.array(HarmProfile).min(1).max(10),
});
export type Harm = z.infer<typeof Harm>;

export const Health = z.object({
  tracks: z.array(HealthTrack).max(10).default([]),
  /** Display states such as "bloodied": `when` is a boolean expression over the actor. */
  states: z
    .array(z.object({ id: Id, label: z.string().min(1).max(80).optional(), when: ExprSource, entities: ActorTypes }))
    .max(20)
    .default([]),
  cite: Cite.optional(),
  harm: Harm.optional(),
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

/**
 * The kinds of catalogue record the ledger builder reads, named as the keys of its `Creation` (build/schemas.ts), plus
 * `wargear`.
 */
export const LEDGER_KINDS = [
  "keywords",
  "factions",
  "sub-factions",
  "species",
  "backgrounds",
  "option-groups",
  "archetypes",
  "talents",
  "packages",
  "disciplines",
  "powers",
  "languages",
  "wargear",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** The kinds the resolved sheet names one record of (`sheet.archetype`, `sheet.species`): a library card's line. */
export const LIBRARY_LINE_KINDS = ["archetypes", "species"] as const satisfies readonly LedgerKind[];

const VocabName = z.string().min(1).max(60);

/**
 * The ledger builder picked for one actor type (docs/adr/0011, house decision #62): its parameters, the entity type
 * that holds each kind of catalogue record, and the fields and resources the resolved sheet lands in.
 */
export const LedgerBuild = z.object({
  strategy: z.literal("ledger"),
  /** The actor entity type it builds. */
  actor: Id,
  params: BuildParams,
  kinds: z.object(Object.fromEntries(LEDGER_KINDS.map((k) => [k, Id])) as Record<LedgerKind, typeof Id>),
  sheet: z.object({
    /** By the ids, names and keys of `params.vocabulary`: one field each. */
    attributes: z.record(VocabName, FieldId),
    skills: z.record(VocabName, FieldId),
    mods: z.record(VocabName, FieldId),
    armourRating: FieldId,
    powered: FieldId,
    speed: FieldId,
    species: FieldId,
    archetype: FieldId,
    keywords: FieldId,
    wealth: Id.optional(),
    corruption: Id.optional(),
  }),
  /** The campaign field the builder reads as the Tier. */
  tier: Id,
  /** The XP earned in play. */
  xp: FieldId.optional(),
  /**
   * The XP every character must earn in a Tier before the group may Ascend, which a milestone Ascension awards (house
   * decision #64). Absent: the ruleset has no Ascension.
   */
  ascension: z.object({ xp: z.int().min(1), cite: Cite }).optional(),
  /** Health states of `actor`: a character in any of them is left out of the Ascension count. Absent: none. */
  gone: z.array(Id).max(10).optional(),
  /** The XP a session's end may give, and the amounts the GM is offered. Absent: a session's end gives none. */
  award: z.object({ max: z.int().min(1).max(1000), suggested: z.array(z.int().min(0)).max(6), cite: Cite }).optional(),
  /**
   * What a build saved over a hand-made sheet keeps (house decision #96): fields of `actor` the build would write, and
   * resources it would start, left as they were set by hand. Absent: such a build is refused (`alreadyBuilt`).
   */
  keep: z
    .object({ fields: z.array(FieldId).max(50).default([]), resources: z.array(Id).max(20).default([]) })
    .optional(),
  /**
   * The kind of record whose chosen one names a finished character on its library card (house decision #187): the
   * archetype's name, or the species'. Absent: the card shows none.
   */
  libraryLine: z.enum(LIBRARY_LINE_KINDS).optional(),
  cite: Cite,
});
export type LedgerBuild = z.infer<typeof LedgerBuild>;

const LayoutPath = z.string().max(130);
/**
 * A row that names one of the platform's widgets (`WIDGETS`), bound to values by slot (house decision #83). Which
 * widget, variant and slots exist, and what each path names, is checked by `validateRuleset`.
 */
export const WidgetRow = z.object({
  widget: Id,
  variant: Id.optional(),
  label: z.string().min(1).max(80).optional(),
  bind: z.record(Id, z.union([LayoutPath, z.array(LayoutPath).min(1).max(40)])).default({}),
  /** A pips widget's rows: each a label and how many pips it holds. */
  steps: z
    .array(z.object({ label: z.string().min(1).max(40), size: z.int().min(1).max(MAX_PIPS_PER_STEP) }))
    .min(1)
    .max(MAX_PIP_STEPS)
    .optional(),
});
export type WidgetRow = z.infer<typeof WidgetRow>;
/** A field, derived or resource path drawn as a row of its own, or a widget. */
export const LayoutRow = z.union([LayoutPath, WidgetRow]);
export type LayoutRow = z.infer<typeof LayoutRow>;
const LayoutRows = z.array(LayoutRow).max(100);

/**
 * A layout hint for one entity type's screens: the sheet's sections, and the other targets of ADR 0010, decision 3,
 * each a list of rows. A target left out keeps the platform's fixed screen. Never HTML.
 */
export const Layout = z.object({
  sections: z.array(z.object({ id: Id, label: z.string().min(1).max(80), show: LayoutRows })).max(50),
  /** The phone on the seat's turn. */
  phoneTurn: LayoutRows.optional(),
  /** A combatant's row on the GM's tracker. */
  trackerRow: LayoutRows.optional(),
  /** The table screen (the TV). */
  screen: LayoutRows.optional(),
  /** The strip under the phone's header, on every tab (house decision #115). */
  phoneStrip: LayoutRows.optional(),
});
export type Layout = z.infer<typeof Layout>;

/** The table events that cancel a spend's pending asks (house decision #84). */
export const SpendClearEvent = z.enum(["sessionStart", "sessionEnd", "encounterEnd", "roundEnd"]);
export type SpendClearEvent = z.infer<typeof SpendClearEvent>;

/** What a spend's limit counts in (house decision #91). */
export const SpendLimitPer = z.enum(["round"]);
export type SpendLimitPer = z.infer<typeof SpendLimitPer>;

/** Input names a spend may not take: `ctx.self` and `ctx.fight` are the platform's. */
export const SPEND_CTX_ROOTS: ReadonlySet<string> = new Set(["self", "fight"]);

/**
 * One cost of a spend: a shared `pool` or an entity `resource` of the asking actor (exactly one), an integer
 * expression. `byRun`: a `run` op takes it itself (`seize`, `lift`), so `spend.do` only checks and shows it.
 */
export const SpendCost = z.object({
  pool: Id.optional(),
  resource: Id.optional(),
  amount: ExprSource,
  byRun: z.boolean().optional(),
});
export type SpendCost = z.infer<typeof SpendCost>;

/** One op a spend runs: an op of a primitive the ruleset declares, its input a value or an expression per key. */
export const SpendStep = z.object({
  primitive: z.string().min(1).max(64),
  op: z.string().min(1).max(64),
  /** A string is an expression (`ctx.self` is the asking actor's id); a number or boolean is taken as it is. */
  input: z.record(z.string().min(1).max(64), z.union([ExprSource, z.number(), z.boolean()])),
});
export type SpendStep = z.infer<typeof SpendStep>;

/**
 * A spend (house decision #84): what a player may ask the GM to do for a cost, or the GM does in one tap. Every
 * expression reads the asking actor's scope plus `ctx`: the spend's inputs, `ctx.self` and `ctx.fight`.
 */
export const Spend = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  /** The actor types that may spend it; absent: every actor type. */
  entities: z.array(Id).min(1).max(50).optional(),
  cost: z.array(SpendCost).max(5),
  /** Numbers the asker picks, each within [min, max], read as `ctx.<name>`. */
  inputs: z
    .record(Id, z.object({ label: z.string().min(1).max(60), min: z.int().min(0).max(1000), max: ExprSource }))
    .refine((o) => Object.keys(o).length <= 3, "at most 3 inputs")
    .optional(),
  /** Boolean: the spend is available now. */
  if: ExprSource.optional(),
  run: z.array(SpendStep).max(5).optional(),
  clearOn: z.array(SpendClearEvent).max(4).optional(),
  /**
   * House decision #91: at most `max` times per actor in one round of a running fight the actor is in; once more is
   * refused (`usedThisRound`). Outside a fight it is not counted: a spend only for fights says so in `if`.
   */
  limit: z.object({ per: SpendLimitPer, max: z.int().min(1).max(10) }).optional(),
  /**
   * House decision #91: the random table the screen offers next, for the same actor, and which of the spend's inputs
   * (the values) fill which of the table's inputs (the keys). Only the link: the table is opened, never rolled here.
   * `if` (house decision #169) reads what the spend's `if` reads: the table is offered only while it holds.
   */
  then: z.object({ table: Id, inputs: z.record(Id, Id).optional(), if: ExprSource.optional() }).optional(),
});
export type Spend = z.infer<typeof Spend>;

/**
 * One option a spawned actor may take (house decision #92), chosen at spawn and kept by the actor: `effects` are the
 * Condition effects' shape and run with them. `when` reads the spawn scope (the entry's values, `campaign`,
 * `party.seated`, `ctx.mob`): the entries it may be taken for.
 */
export const SpawnOption = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  /** The actor types it applies to; absent: every actor type. */
  entities: z.array(Id).min(1).max(50).optional(),
  when: ExprSource.optional(),
  effects: z.array(Effect).max(20).default([]),
});
export type SpawnOption = z.infer<typeof SpawnOption>;

/**
 * A change made once at spawn and fixed there (house decision #92): each `add` key is a field or a resource of the
 * spawned actor, its value an integer in the spawn scope. A field the entry does not list, or a resource the actor does
 * not get, stays absent. `option` makes it apply only when that option is chosen.
 */
export const SpawnAdjust = z.object({
  option: Id.optional(),
  entities: z.array(Id).min(1).max(50).optional(),
  when: ExprSource.optional(),
  add: z
    .record(z.string().min(1).max(130), ExprSource)
    .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 10, "1 to 10 values"),
  cite: Cite.optional(),
});
export type SpawnAdjust = z.infer<typeof SpawnAdjust>;

/**
 * A reading aid for sizing a fight (house decision #92): each line's `cost` reads an entry's values with `ctx.count`
 * and `ctx.mob`, its `budget` reads `campaign` and `party.seated`; a switch on sets each line's budget to its `by`,
 * which reads that budget as `ctx.budget`. It refuses and stores nothing.
 */
export const SpawnBudget = z.object({
  cite: Cite.optional(),
  lines: z
    .array(z.object({ id: Id, label: z.string().min(1).max(80), cost: ExprSource, budget: ExprSource }))
    .min(1)
    .max(8),
  switches: z
    .array(z.object({ id: Id, label: z.string().min(1).max(60), by: ExprSource }))
    .max(4)
    .optional(),
});
export type SpawnBudget = z.infer<typeof SpawnBudget>;

/** What spawning a pack entry may carry (house decision #92). */
export const SpawnBlock = z.object({
  options: z.array(SpawnOption).max(20).optional(),
  adjust: z.array(SpawnAdjust).max(10).optional(),
  budget: SpawnBudget.optional(),
});
export type SpawnBlock = z.infer<typeof SpawnBlock>;

/**
 * The most strike kinds a ruleset declares, the most values one reads of its means, and the most further numbers it
 * shows (house decision #99).
 */
export const MAX_STRIKES = 20;
export const MAX_STRIKE_VALUES = 20;
/** The most items a means' `list` value holds (house decision #159); the rest are left off. */
export const MAX_MEANS_LIST = 20;
export const MAX_STRIKE_SHOWS = 6;
/** The lists of the saved build's sheet a strike's means may come from. */
export const STRIKE_LEDGER_LINES = ["weapons", "powers"] as const;
/** The names a strike's `ctx` gives its own values; an input may not take one. */
export const STRIKE_CTX_ROOTS: ReadonlySet<string> = new Set([
  "means",
  "target",
  "attackerMob",
  "targetMob",
  "pool",
  "beat",
  "soak",
  "total",
  "outcome",
]);

/**
 * Where a strike's means come from (house decision #99): a list of the attacker's saved build sheet (`ledger`), the
 * pack entries of type `entry` whose keys the attacker's list field `field` holds (a held kind's records, a creature's
 * attacks copied from its pack entry), or the items of kind `kind` the attacker holds (`items`, house decision #95),
 * read from their pack entries.
 */
export const StrikeMeans = z.discriminatedUnion("from", [
  z.object({ from: z.literal("ledger"), lines: z.enum(STRIKE_LEDGER_LINES) }),
  z.object({ from: z.literal("list"), field: FieldId, entry: Id }),
  z.object({ from: z.literal("items"), kind: Id }),
]);
export type StrikeMeans = z.infer<typeof StrikeMeans>;

/**
 * A number the strike guide shows (house decision #99): the base expression, then each addition whose `when` holds and
 * whose amount is not 0, each a line of the breakdown with its label and page.
 */
export const StrikeFigure = z.object({
  label: z.string().min(1).max(60),
  expr: ExprSource,
  cite: Cite.optional(),
  adds: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        by: ExprSource,
        when: ExprSource.optional(),
        cite: Cite.optional(),
      }),
    )
    .max(10)
    .optional(),
});
export type StrikeFigure = z.infer<typeof StrikeFigure>;

/** A further number the guide shows (house decision #99), a figure with an id: a weapon's damage, say. It decides nothing. */
export const StrikeShow = StrikeFigure.extend({ id: Id });
export type StrikeShow = z.infer<typeof StrikeShow>;

/** What a typed total does (house decision #99): the first outcome whose `when` holds, and the hit it applies. */
export const StrikeOutcome = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  when: ExprSource,
  wounds: ExprSource.optional(),
  shock: ExprSource.optional(),
  cite: Cite.optional(),
});
export type StrikeOutcome = z.infer<typeof StrikeOutcome>;

/**
 * A value set before a strike: a lookup's switch or stepper (#87), or a `choice` (house decision #113), 2 to 10
 * labelled options, each a whole number read as `ctx.<id>` as a stepper's is (the first option's when none is picked).
 * A choice has no bounds, and only a choice has options.
 */
export const StrikeInput = TableInput.omit({ dice: true }).extend({
  type: z.enum(["bool", "int", "choice"]),
  options: z
    .array(z.object({ label: z.string().min(1).max(60), value: z.int().min(-1000).max(1000) }))
    .min(2)
    .max(10)
    .optional(),
});
export type StrikeInput = z.infer<typeof StrikeInput>;

/**
 * A kind of strike a game has (house decision #99): an attacker of the `entities` types, with one of its means, on a
 * target of the `targets` types. `pool` is what to roll, `beat` the number to beat and `soak` what the target takes off;
 * each reads the attacker's scope plus `ctx`: the inputs, `ctx.means.<value>`, `ctx.target` (the target's scope) and
 * `ctx.attackerMob` / `ctx.targetMob` (a mob's members, 0 for anyone else). The outcomes also read `ctx.pool`,
 * `ctx.beat`, `ctx.soak` and `ctx.total` (the typed total); the notes also `ctx.outcome`. `shows` are further numbers
 * the guide draws with their lines, in the figures' scope; nothing reads them. The app never rolls: the total is typed,
 * and an outcome's hit goes through `health.harm`'s `hit`.
 */
export const Strike = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  /** The actor types that strike this way; absent: every actor type. */
  entities: ActorTypes,
  /** The actor types it may land on; absent: every type a harm profile holds (every actor type without harm). */
  targets: ActorTypes,
  means: z.array(StrikeMeans).min(1).max(4).optional(),
  /**
   * What it reads of a means, as `ctx.means.<id>`: the means' `key`, 0, false or "" where the means has none. A `text`
   * value (a weapon's traits) is shown beside the means; an expression that wants a number cannot read it. A `list`
   * value (house decision #159) is a list of text shown as chips, read by `contains` and `overlap`: the means' list
   * (a whole number as its digits) or its text split at commas, at most MAX_MEANS_LIST items; empty where it has none.
   */
  values: z
    .record(Id, z.object({ key: z.string().min(1).max(64), type: z.enum(["int", "bool", "text", "list"]) }))
    .refine((o) => Object.keys(o).length <= MAX_STRIKE_VALUES, `at most ${MAX_STRIKE_VALUES} values`)
    .optional(),
  inputs: z.array(StrikeInput).min(1).max(MAX_LOOKUP_INPUTS).optional(),
  pool: StrikeFigure,
  beat: StrikeFigure,
  soak: StrikeFigure.optional(),
  /** Further numbers the guide shows after the soak, each with its lines; they decide nothing. */
  shows: z.array(StrikeShow).max(MAX_STRIKE_SHOWS).optional(),
  outcomes: z.array(StrikeOutcome).min(1).max(10),
  /** Short lines shown after the strike, the ruleset's own words: they change nothing. */
  notes: z
    .array(z.object({ text: z.string().min(1).max(200), when: ExprSource.optional(), cite: Cite.optional() }))
    .max(10)
    .optional(),
  /** The random table the guide offers next, and which strike inputs fill which of its inputs (#91's shape). */
  then: z.object({ table: Id, inputs: z.record(Id, Id).optional() }).optional(),
  /**
   * The seat that holds the attacker may send it, on the attacker's own turn, at a target shown to it in full (house
   * decision #113). Absent: only the side that runs the fight applies it.
   */
  byOwner: z.literal(true).optional(),
  /** At most `max` of this strike per attacker in a round of the fight (house decision #91's count; #113). */
  limit: z.object({ per: SpendLimitPer, max: z.int().min(1).max(10) }).optional(),
});
export type Strike = z.infer<typeof Strike>;

/** The most panels a ruleset declares, and the most lines, figures and asks one shows (house decision #114). */
export const MAX_PANELS = 20;
export const MAX_PANEL_LINES = 10;
export const MAX_PANEL_FIGURES = 6;
export const MAX_PANEL_SPENDS = 4;

/**
 * The entries a panel lists (house decision #114): the pack entries of type `entry`, grouped by the entry field `group`,
 * each with the importer's own summary and cite. `usable` reads the holder's scope plus `ctx` and `entry` (the entry's
 * fields); an entry it does not hold for sinks, with the entry's text field `needs` beside it.
 */
export const PanelOptions = z.object({
  entry: Id,
  group: FieldId.optional(),
  usable: ExprSource.optional(),
  needs: FieldId.optional(),
});
export type PanelOptions = z.infer<typeof PanelOptions>;

/**
 * A panel (house decision #114): what a phone shows its holder while it holds, in the ruleset's own short words. It
 * holds while `when` (the holder's scope plus `ctx.self` and `ctx.fight`) does, while the health state `holds` holds and
 * `unless` does not; one with `opensOn` opens as a sheet when the holder's resource `rises` rises in a fight, and closes
 * on an ask sent, a lower value or the fight's end. It changes no number: its lines are reminders, its figures numbers
 * read from the holder, its `spends` the asks it offers (#84) and its `options` the entries it lists.
 */
export const Panel = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  /** The actor types whose phones show it; absent: every actor type. */
  entities: ActorTypes,
  when: ExprSource.optional(),
  holds: Id.optional(),
  unless: Id.optional(),
  opensOn: z.object({ rises: Id }).optional(),
  lines: z
    .array(z.object({ text: z.string().min(1).max(200), when: ExprSource.optional(), cite: Cite.optional() }))
    .max(MAX_PANEL_LINES)
    .optional(),
  figures: z
    .array(z.object({ label: z.string().min(1).max(60), expr: ExprSource, cite: Cite.optional() }))
    .max(MAX_PANEL_FIGURES)
    .optional(),
  spends: z.array(Id).min(1).max(MAX_PANEL_SPENDS).optional(),
  options: PanelOptions.optional(),
});
export type Panel = z.infer<typeof Panel>;

/** How a table can sit for a game (docs/adr/0009-table-modes.md): with a GM, without one, or one player alone. */
export const GameMode = z.enum(["gm", "gmless", "solo"]);
export type GameMode = z.infer<typeof GameMode>;

/** What the game is, for the room and the lobby. Descriptive data, never book text. */
export const GameInfo = z.object({
  title: z.string().min(1).max(80),
  family: z.string().min(1).max(40).optional(),
  genres: z.array(z.string().min(1).max(40)).max(8).default([]),
  players: z
    .object({ min: z.int().min(1).max(20), max: z.int().min(1).max(20) })
    .refine((p) => p.max >= p.min, "max is below min"),
  modes: z
    .array(GameMode)
    .min(1)
    .max(3)
    .refine((m) => new Set(m).size === m.length, "a mode is listed twice"),
  /** The printed page that says the game plays without a GM or alone; needed for `gmless` and `solo`. */
  cite: Cite.optional(),
});
export type GameInfo = z.infer<typeof GameInfo>;

/** The modes a ruleset allows; one with no `game` block is played with a GM. */
export const modesOf = (r: { game?: { modes: readonly GameMode[] } }): readonly GameMode[] => r.game?.modes ?? ["gm"];

/**
 * When a notice rule is read (house decision #79): after one of the reset events, on every actor of its types, or
 * `crossed`, on an action that took an actor from not meeting `if` to meeting it.
 */
export const NoticeWhen = z.enum([...ResetEvent.options, "crossed"]);
export type NoticeWhen = z.infer<typeof NoticeWhen>;
export const MAX_NOTICE_TEXT = 120;
export const MAX_NOTICES = 50;

export const MAX_NOTICE_PARAMS = 5;
/** A group rule (house decision #168): it holds when every (or any) actor of its types meets `if`. */
export const NoticeGroup = z.enum(["every", "any"]);
export type NoticeGroup = z.infer<typeof NoticeGroup>;

/**
 * A line the server tells the seat that sent an action, about an actor (house decision #79). `if` reads the actor's
 * scope (a ledger actor's also `build.xpSpent` and `build.xpAtAscension`, house decision #168); `text` is the
 * ruleset's own short words, `{name}` standing for the actor's name and `{<param>}` for each of `params`, a value
 * worked out on the same actor. `group` makes it one line about the actors of its types together, and `rises` (with
 * `crossed`) raises it each time that number goes up while `if` holds (house decision #168).
 */
export const NoticeRule = z.object({
  id: Id,
  when: NoticeWhen,
  entities: ActorTypes,
  if: ExprSource,
  text: z.string().min(1).max(MAX_NOTICE_TEXT),
  params: z
    .record(Id, ExprSource)
    .refine((o) => Object.keys(o).length <= MAX_NOTICE_PARAMS, `at most ${MAX_NOTICE_PARAMS} params`)
    .optional(),
  group: NoticeGroup.optional(),
  rises: ExprSource.optional(),
  cite: Cite.optional(),
});
export type NoticeRule = z.infer<typeof NoticeRule>;

export const MAX_CHECKLIST_STEPS = 30;
/** The kinds of prepared line a checklist step may ask a scene to hold (core-schema PREP_KINDS, which it can't import). */
export const CHECKLIST_PREP_KINDS = ["roster", "tests", "pools", "exits", "reveals", "picks"] as const;
/** The places of the GM's app a checklist step's GO TO may open (house decision #90): a tab, the codex at a kind. */
export const CHECKLIST_TABS = ["track", "prep", "codex", "party", "tests", "map", "rules"] as const;

const atLeast = { min: z.int().min(1).max(100).optional() };

/**
 * What a checklist step counts (house decision #90), from a closed list of things the platform holds for any game:
 * entries of a codex kind (with a field set or equal to a value, or a scene with prepared lines of a kind), actors of a
 * type (with a saved build), a campaign field set, a pool (at a value), sessions started, packs attached (by slug),
 * safety lines set. `min`: how many are enough (one when it does not say; for a pool, that it exists).
 */
export const ChecklistCount = z.discriminatedUnion("count", [
  z.object({
    count: z.literal("entries"),
    kind: CodexEntryKind,
    field: Id.optional(),
    equals: z.union([z.string().min(1).max(120), z.int(), z.boolean()]).optional(),
    prep: z.enum(CHECKLIST_PREP_KINDS).optional(),
    ...atLeast,
  }),
  z.object({ count: z.literal("actors"), entity: Id, built: z.boolean().optional(), ...atLeast }),
  z.object({ count: z.literal("campaignField"), field: Id }),
  z.object({ count: z.literal("pool"), pool: Id, ...atLeast }),
  z.object({ count: z.literal("sessions"), ...atLeast }),
  z.object({ count: z.literal("packs"), slug: z.string().min(1).max(64).optional(), ...atLeast }),
  z.object({ count: z.literal("safety") }),
]);
export type ChecklistCount = z.infer<typeof ChecklistCount>;

/**
 * One step of the setup checklist (house decision #90), in the book's order: its words, its page, what ticks it, where
 * GO TO takes the GM and a short note; an `optional` step is never the next one.
 */
export const ChecklistStep = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  done: ChecklistCount,
  goto: z.object({ tab: z.enum(CHECKLIST_TABS), kind: CodexEntryKind.optional() }).optional(),
  note: z.string().min(1).max(200).optional(),
  optional: z.boolean().optional(),
});
export type ChecklistStep = z.infer<typeof ChecklistStep>;

// Generators (house decision #98): ordered steps the GM runs in prep, ending in entries the server makes.
export const MAX_GENERATORS = 20;
export const MAX_GENERATOR_STEPS = 12;
export const MAX_EACH_STEPS = 8;
/** The most nested entries one run makes, and the longest chain a roll step follows through lines' `next`. */
export const MAX_GENERATED = 60;
export const MAX_CHAIN = 8;

const generatorStepBase = {
  id: Id,
  label: z.string().min(1).max(80),
  /** A boolean over the earlier steps (`steps.<id>`) and the campaign: the step is asked only while it holds. */
  when: ExprSource.optional(),
};

/**
 * One step of a generator (house decision #98): a roll on a table of the ruleset (ROLL or I ROLLED; a line's `next`
 * goes on to that table within the step), a pick of a served pack entry of a type (`filter` a boolean over the entry's
 * fields as `entry.<field>` and the earlier steps), or a value the GM sets: a bounded number, one of a few choices, or
 * a short text. Expressions read a roll as its last line's id, a pick as its key, a value as itself.
 */
export const GeneratorStep = z.discriminatedUnion("kind", [
  z.object({ ...generatorStepBase, kind: z.literal("roll"), table: Id }),
  z.object({ ...generatorStepBase, kind: z.literal("pick"), entity: Id, filter: ExprSource.optional() }),
  z.object({
    ...generatorStepBase,
    kind: z.literal("number"),
    min: z.int().min(-1000).max(1000),
    max: z.int().min(-1000).max(1000),
  }),
  z.object({
    ...generatorStepBase,
    kind: z.literal("choice"),
    options: z.array(Id).min(1).max(20),
    labels: z.record(Id, z.string().min(1).max(60)).optional(),
  }),
  z.object({ ...generatorStepBase, kind: z.literal("text"), maxLength: z.int().min(1).max(200).optional() }),
]);
export type GeneratorStep = z.infer<typeof GeneratorStep>;

/**
 * What one made entry takes (house decision #98): its title from a step, its declared fields from steps, and with
 * `from` (a pick step) the mapping its kind's `from` gives that pick's pack entry (house decision #97).
 */
export const GeneratedEntry = z.object({
  title: Id,
  from: Id.optional(),
  fields: z.record(Id, Id).optional(),
});
export type GeneratedEntry = z.infer<typeof GeneratedEntry>;

export const Generator = z.object({
  id: Id,
  label: z.string().min(1).max(80),
  cite: Cite.optional(),
  steps: z.array(GeneratorStep).min(1).max(MAX_GENERATOR_STEPS),
  /** Steps asked `times` over (an integer over the steps above, 0 to 60), each round making one nested entry. */
  each: z.object({ times: ExprSource, steps: z.array(GeneratorStep).min(1).max(MAX_EACH_STEPS) }).optional(),
  /** One entry of `kind`, and with `each` one entry of the same kind under it per round. */
  make: GeneratedEntry.extend({ kind: CodexEntryKind, each: GeneratedEntry.optional() }),
});
export type Generator = z.infer<typeof Generator>;

/** What the GM's header shows beside the room's name (house decision #109). */
export const Header = z.object({
  /** Campaign field ids, drawn in order as `label value`. */
  fields: z.array(Id).min(1).max(3).optional(),
  /** The running fight's round. Needs an `initiative`. */
  round: z.literal(true).optional(),
});
export type Header = z.infer<typeof Header>;

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
  /** Values of the whole campaign, read by expressions as `campaign.<id>`. Absent: the ruleset has none. */
  campaignFields: z
    .record(Id, CampaignField)
    .refine((o) => Object.keys(o).length <= MAX_CAMPAIGN_FIELDS, `at most ${MAX_CAMPAIGN_FIELDS} campaign fields`)
    .optional(),
  /** What the GM's header shows besides the name. Absent: the name only. */
  header: Header.optional(),
  conditions: z.array(Condition).max(500).default([]),
  /** Lines the side running a fight is reminded of (house decision #81). Absent: none. */
  reminders: z.array(Reminder).max(100).optional(),
  /** Rest events refused in some health states (house decision #81). Absent: every actor rests. */
  rests: z.array(RestRule).max(5).optional(),
  tests: z.record(Id, DiceMechanic).default({}),
  /** Absent: the game has no turn order, and `encounter.start` is refused. */
  initiative: Initiative.optional(),
  /** The steps a round runs in order. Absent: a round is one pass of the initiative order. */
  phases: z.array(Phase).min(1).max(12).optional(),
  /** Final scores, ranking and the end of the game. Absent: the game has no score to rank. */
  scoring: Scoring.optional(),
  /** Random tables the GM side rolls or deals from (house decision #49). Absent: the ruleset has none. */
  tables: z.record(Id, RandomTable).optional(),
  /** Records an actor gains in play (house decision #88), by kind id. Absent: the ruleset has none. */
  held: z
    .record(Id, HeldKind)
    .refine((o) => Object.keys(o).length <= MAX_HELD_KINDS, `at most ${MAX_HELD_KINDS} kinds`)
    .optional(),
  /** Items actors hold in play (house decision #95). Absent: the ruleset has none. */
  items: ItemsBlock.optional(),
  health: Health.default({ tracks: [], states: [] }),
  /** Steps of the character builder, in order. Empty: the ruleset has no builder and actors are filled by hand. */
  creation: z.array(CreationStep).max(50).default([]),
  /** One actor type built by the ledger builder (house decision #62). Absent: none. */
  build: LedgerBuild.optional(),
  decisions: z.array(Decision).max(200).default([]),
  layout: z.record(Id, Layout).default({}),
  game: GameInfo.optional(),
  /** The fields codex entries carry, per kind (house decision #71). Absent: none. */
  codex: CodexBlock.optional(),
  /** Generators the GM runs in prep (house decision #98). Absent: none. */
  generators: z.array(Generator).max(MAX_GENERATORS).optional(),
  /** What an action's answer tells its sender about an actor (house decision #79). Absent: none. */
  notices: z.array(NoticeRule).max(MAX_NOTICES).optional(),
  /** What players may ask the GM to spend, and the GM do in one tap (house decision #84). Absent: none. */
  spends: z.array(Spend).max(50).optional(),
  /** `max`: pending requests per user. Absent: the platform's five (house decision #43). */
  requests: z.object({ max: z.int().min(1).max(20) }).optional(),
  /** The setup checklist the GM works through (house decision #90). Absent: none. */
  checklist: z.array(ChecklistStep).max(MAX_CHECKLIST_STEPS).optional(),
  /** Spawn options, adjustments fixed at spawn, and the encounter budget (house decision #92). Absent: none. */
  spawn: SpawnBlock.optional(),
  /** The kinds of strike the GM's guide offers (house decision #99). Absent: none. */
  strikes: z.array(Strike).max(MAX_STRIKES).optional(),
  /** What a phone shows while it holds: incoming, hit, barred, dying, this turn's options (house decision #114). */
  panels: z.array(Panel).max(MAX_PANELS).optional(),
});
export type Ruleset = z.infer<typeof Ruleset>;
export type RulesetInput = z.input<typeof Ruleset>;

/** Scope roots the expression language reserves; a field id may not start with one. */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set([
  "derived",
  "res",
  "party",
  "campaign",
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

/** The most outcomes a table die may have: the tiling check walks each of them. */
export const MAX_TABLE_OUTCOMES = 10_000;

/**
 * What a table die can roll: plain `NdX` (the sum, count..count*X) or a single `d66` (11-66, no digit above 6 or
 * below 1). Null for anything else, or for a die with more than MAX_TABLE_OUTCOMES outcomes.
 */
export function tableDie(
  notation: string,
): { min: number; max: number; has: (v: number) => boolean; shaped: (v: number) => boolean } | null {
  const parsed = parseDice(notation);
  if (!parsed.ok || parsed.dice.terms.length !== 1) return null;
  const [t] = parsed.dice.terms;
  if (t === undefined || t.kind !== "dice" || t.die === "F") return null;
  if (t.keep !== null || t.explode || t.successAt !== null || t.sign !== 1) return null;
  if (t.die === "d66") {
    if (t.count !== 1) return null;
    const shaped = (v: number) => v % 10 >= 1 && v % 10 <= 6;
    return { min: 11, max: 66, has: (v) => v >= 11 && v <= 66 && shaped(v), shaped };
  }
  const min = t.count;
  const max = t.count * t.die;
  if (max - min + 1 > MAX_TABLE_OUTCOMES) return null;
  return { min, max, has: (v) => v >= min && v <= max, shaped: () => true };
}

/** Whether a table declares anything of a lookup (house decision #87). */
export function isLookup(t: RandomTable): boolean {
  return (
    t.typedOnly !== undefined ||
    t.inputs !== undefined ||
    t.modifier !== undefined ||
    t.entities !== undefined ||
    t.entries.some((e) => e.apply !== undefined || e.next !== undefined)
  );
}

/**
 * A die's ranges tile its outcomes exactly: no gap, no overlap, nothing outside; no die means weights, no ranges. The
 * last line may be open-ended, and a table with a modifier may have lines above the die, shaped like it (a d66 line
 * above 66 still ends its numbers in 1 to 6), which its modified totals reach (house decision #87).
 */
function tableProblems({ id, t, r, out }: { id: string; t: RandomTable; r: Ruleset; out: Problem[] }): void {
  const path = `tables.${id}`;
  // A seat's copy of a table it may not read has no entry and still compiles (house decision #101); an import refuses
  // one (`importProblems`).
  if (t.entries.length === 0) return;
  duplicates({ ids: t.entries.map((e) => e.id), path: `${path}.entries`, out });
  lookupProblems({ id, t, r, out });
  if (t.die === undefined) {
    t.entries.forEach((e, i) => {
      if (e.range !== undefined)
        out.push({ path: `${path}.entries[${i}].range`, message: "a table without a die has no ranges" });
    });
    return;
  }
  const die = tableDie(t.die);
  if (die === null) {
    out.push({ path: `${path}.die`, message: "a table die is plain NdX or d66, with at most 10000 outcomes" });
    return;
  }
  const above = t.modifier !== undefined; // lines past the die are reached only by a modified total
  const last = t.entries.length - 1;
  const top = Math.max(
    die.max,
    ...t.entries.map((e) => (above && e.range !== undefined ? (e.range[1] ?? e.range[0] ?? 0) : die.max)),
  );
  const counts = (v: number) => v >= die.min && v <= top && die.shaped(v);
  const owner = new Map<number, number>(); // outcome → the first entry that has it
  t.entries.forEach((e, i) => {
    const at = `${path}.entries[${i}]`;
    if (e.weight !== undefined) out.push({ path: `${at}.weight`, message: "a table with a die has no weights" });
    if (e.range === undefined) {
      out.push({ path: `${at}.range`, message: "an entry of a table with a die needs a range" });
      return;
    }
    const [lo = 0] = e.range;
    if (e.range.length === 1 && i !== last) {
      out.push({ path: `${at}.range`, message: "only the last entry may leave its upper bound out" });
      return;
    }
    const hi = e.range.length === 1 ? top : (e.range[1] ?? 0);
    if (hi < lo) {
      out.push({ path: `${at}.range`, message: "to is below from" });
    } else if (lo < die.min || (!above && hi > die.max)) {
      out.push({ path: `${at}.range`, message: `outside the die (${die.min} to ${die.max})` });
    } else {
      let clash = -1;
      for (let v = lo; v <= hi; v++) {
        if (!counts(v)) continue;
        const prev = owner.get(v);
        if (prev === undefined) owner.set(v, i);
        else if (clash < 0) clash = prev;
      }
      if (clash >= 0) out.push({ path: `${at}.range`, message: `overlaps entries[${clash}]` });
    }
  });
  for (let v = die.min; v <= top; v++) {
    if (!counts(v) || owner.has(v)) continue;
    out.push({ path: `${path}.entries`, message: `no entry for ${v}` });
    break;
  }
}

/** A lookup's parts name what the ruleset has, and only a rolled table with a die is one (house decision #87). */
function lookupProblems({ id, t, r, out }: { id: string; t: RandomTable; r: Ruleset; out: Problem[] }): void {
  const path = `tables.${id}`;
  if (!isLookup(t)) return;
  if (t.die === undefined) out.push({ path: `${path}.die`, message: "a lookup needs a die" });
  if (t.visibility === "owner") out.push({ path: `${path}.visibility`, message: "a dealt table is not a lookup" });
  duplicates({ ids: (t.inputs ?? []).map((x) => x.id), path: `${path}.inputs`, out });
  t.inputs?.forEach((x, i) => {
    const at = `${path}.inputs[${i}]`;
    if (x.type === "bool" && (x.min !== undefined || x.max !== undefined))
      out.push({ path: at, message: "a switch has no bounds" });
    if (x.min !== undefined && x.max !== undefined && x.max < x.min)
      out.push({ path: `${at}.max`, message: "max is below min" });
    if (x.dice !== undefined) {
      if (x.type !== "int") out.push({ path: `${at}.dice`, message: "only a number is typed from dice" });
      else if (x.min !== undefined || x.max !== undefined)
        out.push({ path: at, message: "a dice amount takes its bounds from its dice" });
      const d = plainDice(x.dice);
      if (d === null || d.count * d.sides > 1000)
        out.push({ path: `${at}.dice`, message: `"${x.dice}" is not plain dice of at most 1000` });
    }
  });
  const actors = new Set(r.entities.filter((e) => e.base === "actor").map((e) => e.id));
  t.entities?.forEach((e, i) => {
    if (!actors.has(e)) out.push({ path: `${path}.entities[${i}]`, message: `unknown actor type "${e}"` });
  });
  const harm = r.health.harm;
  const hitOnly = new Set([...r.health.tracks.map((x) => x.resource), harm?.wounds, harm?.shock, harm?.mob?.members]);
  t.entries.forEach((e, i) => {
    const at = `${path}.entries[${i}]`;
    if (e.next !== undefined && !Object.hasOwn(r.tables ?? {}, e.next))
      out.push({ path: `${at}.next`, message: `unknown table "${e.next}"` });
    e.apply?.forEach((x, j) => {
      const where = `${at}.apply[${j}]`;
      if (x.kind === "harm") {
        if (harm === undefined) out.push({ path: where, message: "a hit needs health.harm" });
        if (x.wounds === undefined && x.shock === undefined)
          out.push({ path: where, message: "a hit takes wounds or shock" });
        if (x.shock !== undefined && harm !== undefined && harm.shock === undefined)
          out.push({ path: `${where}.shock`, message: "this ruleset has no shock" });
      } else if (x.kind === "condition") {
        if (!r.conditions.some((c) => c.id === x.condition))
          out.push({ path: `${where}.condition`, message: `unknown condition "${x.condition}"` });
      } else if (x.kind === "resource") {
        const res = r.resources.find((y) => y.id === x.resource);
        if (res?.scope !== "entity")
          out.push({ path: `${where}.resource`, message: `"${x.resource}" is not a resource an actor carries` });
        else if (hitOnly.has(x.resource))
          out.push({ path: `${where}.resource`, message: `only a hit moves "${x.resource}"` });
      } else if (x.kind === "pool") {
        const res = r.resources.find((y) => y.id === x.pool);
        if (res === undefined || res.scope === "entity")
          out.push({ path: `${where}.pool`, message: `"${x.pool}" is not a shared pool` });
      } else if (!Object.hasOwn(r.held ?? {}, x.held)) {
        out.push({ path: `${where}.held`, message: `unknown held kind "${x.held}"` });
      }
    });
  });
}

/**
 * A held kind names a type of pack entry and, on each actor type that holds it, a list field to keep the keys in; a
 * kind whose name others do not see keeps it in a field only the holder and the GM side read (house decision #88).
 */
function heldProblems({
  r,
  needCite,
  out,
}: {
  r: Ruleset;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  for (const [id, k] of Object.entries(r.held ?? {})) {
    const path = `held.${id}`;
    needCite(k.cite, path);
    const entry = r.entities.find((e) => e.id === k.entry);
    if (entry === undefined) out.push({ path: `${path}.entry`, message: `unknown entity "${k.entry}"` });
    else if (entry.base === "actor") out.push({ path: `${path}.entry`, message: `"${k.entry}" is an actor` });
    else if (k.includes !== undefined && own(entry.fields, k.includes)?.type !== "list")
      out.push({ path: `${path}.includes`, message: `"${k.entry}" has no list field "${k.includes}"` });
    k.entities.forEach((e, i) => {
      const holder = r.entities.find((x) => x.id === e && x.base === "actor");
      if (holder === undefined) {
        out.push({ path: `${path}.entities[${i}]`, message: `unknown actor type "${e}"` });
        return;
      }
      const def = own(holder.fields, k.field);
      if (def === undefined) out.push({ path: `${path}.field`, message: `${e} has no field "${k.field}"` });
      else if (def.type !== "list") out.push({ path: `${path}.field`, message: `"${k.field}" is not a list field` });
      else if (k.unseen !== undefined && def.visibility !== "owner" && def.visibility !== "gm")
        out.push({ path: `${path}.field`, message: "a field holding unseen records is owner or gm" });
    });
  }
}

/**
 * Item kinds (house decision #95): ids once each, an entry type that is not an actor, holders that are, hosts that are
 * kinds, a slot the entry type declares, a spend only on a counted kind, and a counted kind is never fitted. `give`
 * names a codex `item` field that refers to a kind's entry type, and a kind that is not counted.
 */
function itemProblems({
  r,
  needCite,
  out,
}: {
  r: Ruleset;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const items = r.items;
  if (items === undefined) return;
  const ids = new Set<string>();
  items.kinds.forEach((k, i) => {
    const path = `items.kinds[${i}]`;
    needCite(k.cite, path);
    if (ids.has(k.id)) out.push({ path: `${path}.id`, message: `duplicate kind "${k.id}"` });
    ids.add(k.id);
    const entry = r.entities.find((e) => e.id === k.entry);
    if (entry === undefined) out.push({ path: `${path}.entry`, message: `unknown entity "${k.entry}"` });
    else if (entry.base === "actor") out.push({ path: `${path}.entry`, message: `"${k.entry}" is an actor` });
    k.entities.forEach((e, j) => {
      if (!r.entities.some((x) => x.id === e && x.base === "actor"))
        out.push({ path: `${path}.entities[${j}]`, message: `unknown actor type "${e}"` });
    });
    if (k.spend && !k.stacks) out.push({ path: `${path}.spend`, message: "only a counted kind is spent" });
    if (k.fits) {
      if (k.stacks) out.push({ path: `${path}.fits`, message: "a counted kind is not fitted" });
      k.fits.to.forEach((to, j) => {
        if (!items.kinds.some((x) => x.id === to))
          out.push({ path: `${path}.fits.to[${j}]`, message: `unknown item kind "${to}"` });
      });
      if (k.fits.slot !== undefined && entry !== undefined && own(entry.fields, k.fits.slot) === undefined)
        out.push({ path: `${path}.fits.slot`, message: `${k.entry} has no field "${k.fits.slot}"` });
    }
  });
  if (items.give) {
    const def = own(r.codex?.kinds.item?.fields ?? {}, items.give.ref);
    if (def === undefined)
      out.push({ path: "items.give.ref", message: `the item entry has no field "${items.give.ref}"` });
    else if (def.type !== "ref" || !items.kinds.some((k) => k.entry === def.entity))
      out.push({ path: "items.give.ref", message: "not a ref to an item kind's entry type" });
    const loose = items.kinds.find((k) => k.id === items.give?.loose);
    if (loose === undefined) out.push({ path: "items.give.loose", message: `unknown item kind "${items.give.loose}"` });
    else if (loose.stacks) out.push({ path: "items.give.loose", message: "a counted kind is not given" });
  }
  if (items.acquire) acquireProblems({ r, items, acquire: items.acquire, needCite, out });
}

/** The kinds an acquisition may grant (house decision #102): its `kinds`, else every kind. */
export const acquiredKinds = (items: ItemsBlock, acquire: ItemAcquire): ItemKind[] =>
  items.kinds.filter((k) => acquire.kinds === undefined || acquire.kinds.includes(k.id));

function acquireProblems({
  r,
  items,
  acquire,
  needCite,
  out,
}: {
  r: Ruleset;
  items: ItemsBlock;
  acquire: ItemAcquire;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const path = "items.acquire";
  needCite(acquire.cite, path);
  const known = (ids: readonly string[], at: string) =>
    ids.forEach((id, j) => {
      if (!items.kinds.some((k) => k.id === id))
        out.push({ path: `${at}[${j}]`, message: `unknown item kind "${id}"` });
    });
  if (acquire.kinds) known(acquire.kinds, `${path}.kinds`);
  acquire.limits?.forEach((l, i) => known(l.kinds, `${path}.limits[${i}].kinds`));
  const test = own(r.tests, acquire.test);
  if (test === undefined) out.push({ path: `${path}.test`, message: `unknown test "${acquire.test}"` });
  else if (test.kind === "reported")
    out.push({ path: `${path}.test`, message: "a reported Test has no number to reach" });
  else {
    for (const [name, type] of Object.entries(test.inputs).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (type !== "int") out.push({ path: `${path}.test`, message: `the Test's input "${name}" is not a number` });
      else if (!Object.hasOwn(acquire.inputs, name))
        out.push({ path: `${path}.inputs`, message: `the Test's input "${name}" is not set` });
    }
    for (const name of Object.keys(acquire.inputs).sort()) {
      if (!Object.hasOwn(test.inputs, name))
        out.push({ path: `${path}.inputs.${name}`, message: `"${name}" is not an input of the Test` });
    }
    for (const id of Object.values(ACQUIRE_OFFERS)) {
      if (test.offers?.some((o) => o.id === id))
        out.push({ path: `${path}.test`, message: `the Test's offer "${id}" is the acquisition's` });
    }
  }
  const kinds = acquiredKinds(items, acquire);
  for (const type of new Set(kinds.map((k) => k.entry))) {
    const entry = r.entities.find((e) => e.id === type);
    if (entry !== undefined && Object.hasOwn(entry.fields, "tags"))
      out.push({ path: `${path}.kinds`, message: `${type} has a field "tags", which is the entry's own` });
  }
  if (acquire.topUp) {
    const res = r.resources.find((x) => x.id === acquire.topUp?.resource);
    const holders = [...new Set(kinds.flatMap((k) => k.entities))];
    if (res === undefined || res.scope !== "entity")
      out.push({ path: `${path}.topUp.resource`, message: `"${acquire.topUp.resource}" is not an entity resource` });
    else if (holders.some((h) => res.entities !== undefined && !res.entities.includes(h)))
      out.push({ path: `${path}.topUp.resource`, message: `not every holder carries "${res.id}"` });
  }
  if (acquire.load) {
    const field = acquire.load.field;
    for (const type of new Set(kinds.filter((x) => !x.stacks).map((k) => k.entry))) {
      const entry = r.entities.find((e) => e.id === type);
      if (entry !== undefined && own(entry.fields, field) === undefined)
        out.push({ path: `${path}.load.field`, message: `${type} has no field "${field}"` });
    }
    if (!items.kinds.some((k) => k.stacks)) out.push({ path: `${path}.load`, message: "no counted kind to load" });
  }
}

/**
 * The item kind of a pack entry (house decision #95): the first kind whose entry type is the entry's and whose tag, if
 * it has one, the entry carries. Undefined when none.
 */
export function itemKindOf({
  items,
  entry,
}: {
  items: ItemsBlock | undefined;
  entry: { type: string; tags: readonly string[] };
}): ItemKind | undefined {
  return items?.kinds.find((k) => k.entry === entry.type && (k.tag === undefined || entry.tags.includes(k.tag)));
}

/** Steps name real actor entities, pack entity types and fields, and no field has two writers. */
function creationProblems(r: Ruleset, out: Problem[]): void {
  // The first definition of an id is the one the steps are checked against, as in the Go twin (`Ruleset.entity`); a
  // repeated id is reported on its own as a duplicate.
  const entities = new Map<string, EntityType>();
  for (const e of r.entities) if (!entities.has(e.id)) entities.set(e.id, e);
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

/**
 * The ledger builder's block names what the manifest declares (house decision #62): an actor type, one catalogue entity
 * per kind, a field of the fitting type for every Attribute, Skill and mod of its vocabulary, and a campaign Tier
 * within its tiers.
 */
function buildProblems(r: Ruleset, out: Problem[]): void {
  const b = r.build;
  if (b === undefined) return;
  const entities = new Map<string, EntityType>();
  for (const e of r.entities) if (!entities.has(e.id)) entities.set(e.id, e);
  const actor = entities.get(b.actor);
  if (actor?.base !== "actor") out.push({ path: "build.actor", message: `"${b.actor}" is not an actor entity` });
  const holds = new Map<string, LedgerKind>(); // entity id → the kind it holds
  for (const kind of LEDGER_KINDS) {
    const id = b.kinds[kind];
    const path = `build.kinds.${kind}`;
    const e = entities.get(id);
    if (e === undefined) out.push({ path, message: `unknown entity "${id}"` });
    else if (e.base === "actor") out.push({ path, message: `"${id}" is an actor entity, not a catalogue` });
    const other = holds.get(id);
    if (other !== undefined) out.push({ path, message: `"${id}" already holds the ${other}` });
    else holds.set(id, kind);
  }
  if (r.creation.some((s) => s.actor === b.actor))
    out.push({ path: "creation", message: "an actor type the ledger builder builds takes no creation steps" });
  const tier = r.campaignFields === undefined ? undefined : own(r.campaignFields, b.tier);
  const { min, max } = b.params.tiers;
  if (tier === undefined) out.push({ path: "build.tier", message: `unknown campaign field "${b.tier}"` });
  else if (tier.type !== "int") out.push({ path: "build.tier", message: `"${b.tier}" is ${tier.type}, not int` });
  else if (tier.min < min || tier.max > max)
    out.push({
      path: "build.tier",
      message: `"${b.tier}" runs ${tier.min} to ${tier.max}, outside the tiers ${min} to ${max}`,
    });
  // The amounts offered at a session's end are within the max, ascending (house decision #64).
  b.award?.suggested.forEach((n, i, all) => {
    const path = `build.award.suggested[${i}]`;
    if (n > b.award!.max) out.push({ path, message: `${n} is more than the max ${b.award!.max}` });
    else if (i > 0 && n <= all[i - 1]!) out.push({ path, message: `${n} does not come after ${all[i - 1]}` });
  });
  if (actor?.base !== "actor") return;

  const named = new Map<string, string>(); // field id → the path that first names it
  const field = (id: string, path: string, type: FieldDef["type"]) => {
    const def = own(actor.fields, id);
    if (def === undefined) out.push({ path, message: `${actor.id} has no field "${id}"` });
    else if (def.type !== type) out.push({ path, message: `"${id}" is ${def.type}, not ${type}` });
    const prev = named.get(id);
    if (prev !== undefined) out.push({ path, message: `"${id}" is already named at ${prev}` });
    else named.set(id, path);
  };
  const v = b.params.vocabulary;
  const groups = [
    ["attributes", v.attributes.map((a) => a.id)],
    ["skills", v.skills.map((s) => s.name)],
    ["mods", v.mods.map((m) => m.key)],
  ] as const;
  for (const [group, names] of groups) {
    const record = b.sheet[group];
    for (const name of names)
      if (own(record, name) === undefined)
        out.push({ path: `build.sheet.${group}`, message: `no field for "${name}"` });
    for (const key of Object.keys(record).sort()) {
      const path = `build.sheet.${group}.${key}`;
      const id = own(record, key);
      if (!names.includes(key)) out.push({ path, message: `"${key}" is not in the vocabulary` });
      else if (id !== undefined) field(id, path, "int");
    }
  }
  for (const key of ["armourRating", "powered", "speed"] as const) field(b.sheet[key], `build.sheet.${key}`, "int");
  for (const key of ["species", "archetype"] as const) field(b.sheet[key], `build.sheet.${key}`, "text");
  field(b.sheet.keywords, "build.sheet.keywords", "list");
  // The last declaration wins, as everywhere a resource is looked up by id.
  const resources = new Map(r.resources.map((x) => [x.id, x]));
  for (const key of ["wealth", "corruption"] as const) {
    const id = b.sheet[key];
    if (id === undefined) continue;
    const res = resources.get(id);
    if (res === undefined || res.scope !== "entity" || (res.entities !== undefined && !res.entities.includes(actor.id)))
      out.push({ path: `build.sheet.${key}`, message: `"${id}" is not an entity resource the ${actor.id} carries` });
  }
  if (b.xp !== undefined) field(b.xp, "build.xp", "int");
  // A gone state is one the actor type can be in (house decision #64).
  b.gone?.forEach((id, i) => {
    if (!r.health.states.some((s) => s.id === id && (s.entities === undefined || s.entities.includes(actor.id))))
      out.push({ path: `build.gone[${i}]`, message: `unknown health state "${id}"` });
  });
  // What a build over a hand-made sheet keeps is the actor's own (house decision #96).
  b.keep?.fields.forEach((id, i) => {
    if (own(actor.fields, id) === undefined)
      out.push({ path: `build.keep.fields[${i}]`, message: `${actor.id} has no field "${id}"` });
  });
  b.keep?.resources.forEach((id, i) => {
    const res = r.resources.findLast((x) => x.id === id);
    if (res === undefined || res.scope !== "entity" || (res.entities !== undefined && !res.entities.includes(actor.id)))
      out.push({
        path: `build.keep.resources[${i}]`,
        message: `"${id}" is not an entity resource the ${actor.id} carries`,
      });
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

/** Ids an expression reads as words, so a campaign field may not take them. */
const EXPRESSION_WORDS: ReadonlySet<string> = new Set(["true", "false", "max", "min"]);

function campaignFieldProblems({
  r,
  needCite,
  out,
}: {
  r: Ruleset;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  for (const id of Object.keys(r.campaignFields ?? {}).sort()) {
    const def = r.campaignFields?.[id];
    if (def === undefined) continue;
    const path = `campaignFields.${id}`;
    if (EXPRESSION_WORDS.has(id)) out.push({ path, message: `"${id}" is reserved for expressions` });
    needCite(def.cite, path);
    if (def.type === "int") {
      if (def.max < def.min) out.push({ path: `${path}.max`, message: "max is below min" });
      if (def.default < def.min || def.default > def.max)
        out.push({ path: `${path}.default`, message: "the default is not allowed" });
    } else if (def.type === "enum") {
      const seen = new Set<string>();
      def.values.forEach((v, i) => {
        if (seen.has(v)) out.push({ path: `${path}.values[${i}]`, message: `duplicate id "${v}"` });
        seen.add(v);
      });
      if (!def.values.includes(def.default))
        out.push({ path: `${path}.default`, message: "the default is not allowed" });
      enumWordProblems({ def, path, out });
    }
  }
}

/** An enum's labels and notes name only its own values. */
function enumWordProblems({
  def,
  path,
  out,
}: {
  def: {
    values: readonly string[];
    labels?: Record<string, string>;
    notes?: Record<string, string>;
    tones?: Record<string, string>;
  };
  path: string;
  out: Problem[];
}): void {
  for (const key of ["labels", "notes", "tones"] as const) {
    for (const value of Object.keys(def[key] ?? {}).sort()) {
      if (!def.values.includes(value))
        out.push({ path: `${path}.${key}.${value}`, message: `"${value}" is not a value` });
    }
  }
}

/** A Test's words name only its own inputs, and an input's option words only that input's declared options. */
/** A Test's marks and offers (house decision #80): a mark is not also an input; each change names what it writes. */
function testOutcomeProblems({
  r,
  id,
  t,
  needCite,
  out,
}: {
  r: Ruleset;
  id: string;
  t: DiceMechanic;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const path = `tests.${id}`;
  for (const key of Object.keys(t.marks ?? {})) {
    if (Object.hasOwn(t.inputs, key)) out.push({ path: `${path}.marks.${key}`, message: `"${key}" is also an input` });
  }
  const offers = t.offers ?? [];
  duplicates({ ids: offers.map((o) => o.id), path: `${path}.offers`, out });
  const takers = r.entities.filter(
    (e) => e.base === "actor" && (t.entities === undefined || t.entities.includes(e.id)),
  );
  // An offer reads the result as `result`, so a taker's field cannot be called that.
  if (offers.length > 0) {
    for (const e of takers) {
      if (Object.keys(e.fields).some((f) => f.split(".")[0] === "result"))
        out.push({ path: `${path}.offers`, message: `"result" is a field of "${e.id}"` });
    }
  }
  offers.forEach((o, i) => {
    needCite(o.cite, `${path}.offers[${i}]`);
    o.changes.forEach((c, j) => {
      const at = `${path}.offers[${i}].changes[${j}]`;
      if ((c.pool === undefined) === (c.resource === undefined)) {
        out.push({ path: at, message: "a change names one pool or one resource" });
        return;
      }
      const named = c.pool ?? c.resource ?? "";
      const res = r.resources.find((x) => x.id === named);
      const key = c.pool === undefined ? "resource" : "pool";
      if (res === undefined) out.push({ path: `${at}.${key}`, message: `unknown resource "${named}"` });
      else if (c.pool !== undefined && res.scope === "entity")
        out.push({ path: `${at}.pool`, message: `"${named}" is not a shared pool` });
      else if (c.resource !== undefined && res.scope !== "entity")
        out.push({ path: `${at}.resource`, message: `"${named}" must be an entity-scoped resource` });
      else if (c.resource !== undefined) {
        for (const e of takers) {
          if (res.entities !== undefined && !res.entities.includes(e.id))
            out.push({ path: `${at}.resource`, message: `"${e.id}" does not carry "${named}"` });
        }
      }
    });
  });
}

function testWordProblems({ t, path, out }: { t: DiceMechanic; path: string; out: Problem[] }): void {
  for (const key of Object.keys(t.inputLabels ?? {}).sort()) {
    if (t.inputs[key] === undefined)
      out.push({ path: `${path}.inputLabels.${key}`, message: `"${key}" is not an input` });
  }
  const optionLabels = t.inputOptionLabels ?? {};
  for (const key of Object.keys(optionLabels).sort()) {
    if (t.inputs[key] === undefined) {
      out.push({ path: `${path}.inputOptionLabels.${key}`, message: `"${key}" is not an input` });
      continue;
    }
    for (const option of Object.keys(optionLabels[key] ?? {}).sort()) {
      if (!(t.inputOptions[key] ?? []).includes(option))
        out.push({ path: `${path}.inputOptionLabels.${key}.${option}`, message: `"${option}" is not an option` });
    }
  }
}

/** A codex field's ref names a declared entity, its int range is the right way up, its enum words name its values. */
function codexProblems({ r, entityIds, out }: { r: Ruleset; entityIds: ReadonlySet<string>; out: Problem[] }): void {
  for (const [kind, k] of Object.entries(r.codex?.kinds ?? {})) {
    for (const [id, def] of Object.entries(k.fields)) {
      const path = `codex.kinds.${kind}.fields.${id}`;
      if (def.type === "ref" && !entityIds.has(def.entity))
        out.push({ path: `${path}.entity`, message: `unknown entity "${def.entity}"` });
      if (def.type === "int" && def.min !== undefined && def.max !== undefined && def.max < def.min)
        out.push({ path: `${path}.max`, message: "max is below min" });
      if (def.type === "enum") enumWordProblems({ def, path, out });
      if (def.type === "tags") tagsProblems({ def, entityIds, path, out });
      if (def.type === "rows") rowsProblems({ def, r, path, out });
      if (def.type === "text" && def.roll !== undefined) rollProblems({ roll: def.roll, r, path: `${path}.roll`, out });
    }
    duplicates({ ids: (k.reminders ?? []).map((x) => x.id), path: `codex.kinds.${kind}.reminders`, out });
    if (k.titleRoll !== undefined) rollProblems({ roll: k.titleRoll, r, path: `codex.kinds.${kind}.titleRoll`, out });
    entryFromProblems({ kind, k, r, out });
    const seenReady = new Set<string>();
    k.ready?.forEach((id, i) => {
      const at = `codex.kinds.${kind}.ready[${i}]`;
      if (own(k.fields, id) === undefined) out.push({ path: at, message: `unknown field "${id}"` });
      else if (seenReady.has(id)) out.push({ path: at, message: `duplicate id "${id}"` });
      seenReady.add(id);
    });
  }
}

/** A field's roll names tables of the ruleset that are rolled, not dealt (house decision #97). */
function rollProblems({ roll, r, path, out }: { roll: FieldRoll; r: Ruleset; path: string; out: Problem[] }): void {
  roll.tables.forEach((id, i) => {
    const t = own(r.tables ?? {}, id);
    if (t === undefined) out.push({ path: `${path}.tables[${i}]`, message: `unknown table "${id}"` });
    else if (t.visibility === "owner")
      out.push({ path: `${path}.tables[${i}]`, message: `"${id}" is dealt, never rolled` });
  });
}

/**
 * Each way a kind is made from a pack entry (house decision #97) names a declared entity once; its mapping fits the
 * kind's fields as a row's prefill fits its columns; `children` is a ref of the entity to its own type, and never on a
 * scene (a scene sits under an adventure); `tests` and `roster` are list fields of the entity, on a scene only.
 */
function entryFromProblems({ kind, k, r, out }: { kind: string; k: CodexKindDef; r: Ruleset; out: Problem[] }): void {
  const seen = new Set<string>();
  k.from?.forEach((f, i) => {
    const at = `codex.kinds.${kind}.from[${i}]`;
    if (seen.has(f.entity)) out.push({ path: `${at}.entity`, message: `"${f.entity}" fills entries twice` });
    seen.add(f.entity);
    const entity = r.entities.find((e) => e.id === f.entity);
    if (entity === undefined) {
      out.push({ path: `${at}.entity`, message: `unknown entity "${f.entity}"` });
      return;
    }
    const of = (id: string) => own(entity.fields, id);
    if (f.name !== undefined && own(k.fields, f.name)?.type !== "text")
      out.push({ path: `${at}.name`, message: `"${f.name}" is not a text field of ${kind}` });
    for (const [to, fieldId] of Object.entries(f.values ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const def = own(k.fields, to);
      const field = of(fieldId);
      if (def === undefined) out.push({ path: `${at}.values.${to}`, message: `"${to}" is not a field of ${kind}` });
      else if (field === undefined)
        out.push({ path: `${at}.values.${to}`, message: `"${fieldId}" is not a field of "${f.entity}"` });
      else if (!fitsColumn(def, field))
        out.push({ path: `${at}.values.${to}`, message: `"${fieldId}" does not fit the field` });
    }
    if (f.children !== undefined) {
      const ref = of(f.children);
      if (ref?.type !== "ref" || ref.entity !== f.entity)
        out.push({ path: `${at}.children`, message: `"${f.children}" is not a ref to "${f.entity}"` });
      else if (kind === "scene")
        out.push({ path: `${at}.children`, message: "a scene sits under an adventure, not a scene" });
    }
    const list = (id: string, path: string) => {
      if (kind !== "scene") out.push({ path, message: "only a scene holds prepared lines" });
      else if (of(id)?.type !== "list") out.push({ path, message: `"${id}" is not a list field of "${f.entity}"` });
    };
    if (f.tests !== undefined) {
      list(f.tests.field, `${at}.tests.field`);
      for (const [input, fieldId] of Object.entries(f.tests.inputs ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const t = of(fieldId)?.type;
        if (t !== "int" && t !== "text" && t !== "enum" && t !== "bool")
          out.push({
            path: `${at}.tests.inputs.${input}`,
            message: `"${fieldId}" is not a value field of "${f.entity}"`,
          });
      }
    }
    if (f.roster !== undefined) list(f.roster, `${at}.roster`);
  });
}

/** A tags field's suggestions name declared entities, its labels its options, and something can be entered. */
function tagsProblems({
  def,
  entityIds,
  path,
  out,
}: {
  def: Extract<CodexField, { type: "tags" }>;
  entityIds: ReadonlySet<string>;
  path: string;
  out: Problem[];
}): void {
  def.entities?.forEach((e, i) => {
    if (!entityIds.has(e)) out.push({ path: `${path}.entities[${i}]`, message: `unknown entity "${e}"` });
  });
  enumWordProblems({ def: { values: def.options ?? [], labels: def.labels }, path, out });
  if (def.entities === undefined && def.options === undefined && !def.writeIn)
    out.push({ path, message: "a tags field needs entities, options or writeIn" });
}

/** Whether an entity field's values fit a column: the same type, an enum's values among the column's, a ref's entity. */
function fitsColumn(col: { type: string; values?: readonly string[]; entity?: string }, field: FieldDef): boolean {
  if (col.type !== field.type) return false;
  if (col.type === "enum" && field.type === "enum") return field.values.every((v) => col.values?.includes(v));
  if (col.type === "ref" && field.type === "ref") return field.entity === col.entity;
  return true;
}

/** A rows field's columns are unique and sound; each prefill names a declared entity whose fields fit their columns. */
function rowsProblems({
  def,
  r,
  path,
  out,
}: {
  def: Extract<CodexField, { type: "rows" }>;
  r: Ruleset;
  path: string;
  out: Problem[];
}): void {
  duplicates({ ids: def.columns.map((c) => c.id), path: `${path}.columns`, out });
  def.columns.forEach((c, i) => {
    const at = `${path}.columns[${i}]`;
    if (c.type === "ref" && !r.entities.some((e) => e.id === c.entity))
      out.push({ path: `${at}.entity`, message: `unknown entity "${c.entity}"` });
    if (c.type === "int" && c.min !== undefined && c.max !== undefined && c.max < c.min)
      out.push({ path: `${at}.max`, message: "max is below min" });
    if (c.type === "enum") enumWordProblems({ def: c, path: at, out });
  });
  const column = (id: string) => def.columns.find((c) => c.id === id);
  const seen = new Set<string>();
  def.from?.forEach((f, i) => {
    const at = `${path}.from[${i}]`;
    if (seen.has(f.entity)) out.push({ path: `${at}.entity`, message: `"${f.entity}" fills rows twice` });
    seen.add(f.entity);
    const entity = r.entities.find((e) => e.id === f.entity);
    if (entity === undefined) {
      out.push({ path: `${at}.entity`, message: `unknown entity "${f.entity}"` });
      return;
    }
    if (f.name !== undefined && column(f.name)?.type !== "text")
      out.push({ path: `${at}.name`, message: `"${f.name}" is not a text column` });
    for (const [col, fieldId] of Object.entries(f.values ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const c = column(col);
      const field = own(entity.fields, fieldId);
      if (c === undefined) out.push({ path: `${at}.values.${col}`, message: `"${col}" is not a column` });
      else if (field === undefined)
        out.push({ path: `${at}.values.${col}`, message: `"${fieldId}" is not a field of "${f.entity}"` });
      else if (!fitsColumn(c, field))
        out.push({ path: `${at}.values.${col}`, message: `"${fieldId}" does not fit the column` });
    }
  });
}

/** Every cost names a declared side and a shared pool. */
function sidesProblems({
  init,
  resources,
  entities,
  states,
  out,
}: {
  init: SidesInitiative;
  resources: ReadonlyMap<string, { scope: string }>;
  entities: (id: string) => { base: string } | undefined;
  states: ReadonlySet<string>;
  out: Problem[];
}): void {
  const listed = new Map<string, string>();
  init.sides.forEach((side, i) =>
    side.entities?.forEach((id, j) => {
      const path = `initiative.sides[${i}].entities[${j}]`;
      const e = entities(id);
      if (e === undefined) out.push({ path, message: `unknown entity "${id}"` });
      else if (e.base !== "actor") out.push({ path, message: `"${id}" is not an actor entity` });
      const other = listed.get(id);
      if (other !== undefined) out.push({ path, message: `"${id}" is already on side "${other}"` });
      else listed.set(id, side.id);
    }),
  );
  init.unableStates?.forEach((id, i) => {
    if (!states.has(id)) out.push({ path: `initiative.unableStates[${i}]`, message: `unknown health state "${id}"` });
  });
  const sides = new Set(init.sides.map((x) => x.id));
  const costs = (record: Readonly<Record<string, SideCost>> | undefined, path: string) => {
    for (const side of Object.keys(record ?? {}).sort()) {
      const cost = record?.[side];
      if (cost === undefined) continue;
      if (!sides.has(side)) out.push({ path: `${path}.${side}`, message: `unknown side "${side}"` });
      const res = resources.get(cost.pool);
      if (res === undefined) out.push({ path: `${path}.${side}.pool`, message: `unknown resource "${cost.pool}"` });
      else if (res.scope === "entity")
        out.push({ path: `${path}.${side}.pool`, message: `"${cost.pool}" must be a shared pool` });
    }
  };
  costs(init.outOfTurn?.cost, "initiative.outOfTurn.cost");
  costs(init.barred?.liftCost, "initiative.barred.liftCost");
}

/** `health.harm` (house decision #66): its resources, fields and conditions. Its expressions are `compileRuleset`'s. */
function harmProblems({
  r,
  harm,
  actorTypes,
  out,
}: {
  r: Ruleset;
  harm: Harm;
  actorTypes: (ids: readonly string[] | undefined, path: string) => void;
  out: Problem[];
}): void {
  const resources = new Map(r.resources.map((x) => [x.id, x]));
  const tracked = new Set(r.health.tracks.flatMap((t) => (t.temp === undefined ? [t.resource] : [t.resource, t.temp])));
  const named: [string, string | undefined, boolean][] = [
    ["wounds", harm.wounds, false],
    ["shock", harm.shock, false],
    ["mob.members", harm.mob?.members, true],
  ];
  const used = new Map<string, string>();
  for (const [key, id, capped] of named) {
    if (id === undefined) continue;
    const path = `health.harm.${key}`;
    const res = resources.get(id);
    const other = used.get(id);
    if (res === undefined) out.push({ path, message: `unknown resource "${id}"` });
    else if (res.scope !== "entity") out.push({ path, message: `"${id}" must be an entity-scoped resource` });
    else if (tracked.has(id)) out.push({ path, message: `"${id}" is already a health track` });
    else if (other !== undefined) out.push({ path, message: `"${id}" is already health.harm.${other}` });
    else if (res.capped !== capped)
      out.push({ path, message: capped ? `"${id}" must be capped` : `"${id}" must be declared capped: false` });
    if (other === undefined) used.set(id, key);
  }
  const actors = r.entities.filter((e) => e.base === "actor");
  const fieldOf = (e: EntityType, id: string, type: "int" | "bool", path: string) => {
    if (own(e.fields, id)?.type !== type) out.push({ path, message: `"${e.id}" has no ${type} field "${id}"` });
  };
  const mob = harm.mob;
  const members = mob === undefined ? undefined : resources.get(mob.members);
  if (mob !== undefined && members?.scope === "entity") {
    for (const e of actors) {
      if (members.entities === undefined || members.entities.includes(e.id))
        fieldOf(e, mob.start, "int", "health.harm.mob.start");
    }
  }
  const conditions = new Set(r.conditions.map((c) => c.id));
  const condition = (id: string, path: string) => {
    if (!conditions.has(id)) out.push({ path, message: `unknown condition "${id}"` });
  };
  const profiled = new Map<string, number>();
  harm.profiles.forEach((p, i) => {
    const path = `health.harm.profiles[${i}]`;
    actorTypes(p.entities, `${path}.entities`);
    p.entities.forEach((id, j) => {
      const other = profiled.get(id);
      if (other !== undefined)
        out.push({ path: `${path}.entities[${j}]`, message: `"${id}" is already in profiles[${other}]` });
      else profiled.set(id, i);
    });
    for (const e of actors.filter((x) => p.entities.includes(x.id))) {
      if (p.felled?.injuries !== undefined) fieldOf(e, p.felled.injuries, "int", `${path}.felled.injuries`);
      if (p.destroyed !== undefined) fieldOf(e, p.destroyed.field, "bool", `${path}.destroyed.field`);
    }
    p.spent?.conditions?.forEach((id, j) => condition(id, `${path}.spent.conditions[${j}]`));
    if (p.felled?.condition !== undefined) condition(p.felled.condition, `${path}.felled.condition`);
  });
}

/** What a layout path names on one entity type, as the sheet reads it (apps/web lib/sheet `rowFor`); null: nothing. */
function valueKind({ r, e, path }: { r: Ruleset; e: EntityType; path: string }): "number" | "text" | "other" | null {
  const derived = (id: string) => (e.derived.some((d) => d.id === id) ? "number" : null);
  const resource = (id: string) =>
    r.resources.some((x) => x.id === id && x.scope === "entity" && (x.entities?.includes(e.id) ?? true))
      ? "number"
      : null;
  if (path.startsWith("derived.")) return derived(path.slice(8));
  if (path.startsWith("res.")) return resource(path.slice(4));
  const field = own(e.fields, path);
  if (field !== undefined) return field.type === "int" ? "number" : field.type === "text" ? "text" : "other";
  return derived(path) ?? resource(path);
}

/** One widget row (house decision #83): a known widget and variant, its slots, and paths the entity types hold. */
function widgetRowProblems({
  r,
  row,
  entities,
  path,
  out,
}: {
  r: Ruleset;
  row: WidgetRow;
  entities: readonly EntityType[];
  path: string;
  out: Problem[];
}): void {
  const spec: WidgetSpec | undefined = widgetSpec(row.widget);
  if (spec === undefined) {
    out.push({ path: `${path}.widget`, message: `unknown widget "${row.widget}"` });
    return;
  }
  if (spec.strike) {
    // A strike widget's variant names one of the ruleset's strike kinds (house decision #99).
    const s = (r.strikes ?? []).find((x) => x.id === row.variant);
    if (row.variant === undefined)
      out.push({ path: `${path}.variant`, message: "a strike widget names a strike kind" });
    else if (s === undefined) out.push({ path: `${path}.variant`, message: `unknown strike "${row.variant}"` });
    else if (s.entities !== undefined && entities.some((e) => !s.entities?.includes(e.id)))
      out.push({ path: `${path}.variant`, message: `not every type here strikes with "${row.variant}"` });
  } else if (spec.panel) {
    // A panel widget's variant names one of the ruleset's panels (house decision #114).
    const s = (r.panels ?? []).find((x) => x.id === row.variant);
    if (row.variant === undefined) out.push({ path: `${path}.variant`, message: "a panel widget names a panel" });
    else if (s === undefined) out.push({ path: `${path}.variant`, message: `unknown panel "${row.variant}"` });
    else if (s.entities !== undefined && entities.some((e) => !s.entities?.includes(e.id)))
      out.push({ path: `${path}.variant`, message: `not every type here shows "${row.variant}"` });
  } else if (row.variant !== undefined && !spec.variants.includes(row.variant))
    out.push({ path: `${path}.variant`, message: `unknown variant "${row.variant}"` });
  const variant = row.variant ?? spec.variants[0];
  if (spec.steps && row.steps === undefined) out.push({ path: `${path}.steps`, message: "this widget needs steps" });
  if (!spec.steps && row.steps !== undefined)
    out.push({ path: `${path}.steps`, message: "this widget takes no steps" });
  if (spec.ledger && r.build === undefined)
    out.push({ path: `${path}.widget`, message: `"${spec.id}" reads the build's sheet, and the ruleset has no build` });
  if (spec.held && !Object.values(r.held ?? {}).some((k) => entities.some((e) => k.entities.includes(e.id))))
    out.push({ path: `${path}.widget`, message: `"${spec.id}" lists held records, and no held kind is for this type` });
  const pathOk = (p: string, takes: string, at: string) => {
    const kinds = entities.map((e) => valueKind({ r, e, path: p })).filter((k) => k !== null);
    if (kinds.length === 0) out.push({ path: at, message: `unknown value "${p}"` });
    else if (takes === "number" && !kinds.includes("number")) out.push({ path: at, message: `"${p}" is not a number` });
    else if (takes === "text" && !kinds.includes("text")) out.push({ path: at, message: `"${p}" is not a text field` });
  };
  for (const key of Object.keys(row.bind).sort()) {
    const at = `${path}.bind.${key}`;
    const slot = spec.slots.find((x) => x.id === key);
    const bound = row.bind[key];
    if (slot === undefined || bound === undefined) {
      out.push({ path: at, message: `unknown slot "${key}"` });
      continue;
    }
    if (slot.variants !== undefined && variant !== undefined && !slot.variants.includes(variant))
      out.push({ path: at, message: `variant "${variant}" does not read "${key}"` });
    if (slot.list !== Array.isArray(bound)) {
      out.push({ path: at, message: slot.list ? "takes a list of paths" : "takes one path" });
      continue;
    }
    if (Array.isArray(bound)) bound.forEach((p, i) => pathOk(p, slot.takes, `${at}[${i}]`));
    else pathOk(bound, slot.takes, at);
    const other = slot.sameLengthAs === undefined ? undefined : row.bind[slot.sameLengthAs];
    if (Array.isArray(bound) && Array.isArray(other) && other.length !== bound.length)
      out.push({ path: at, message: `has ${bound.length}, "${slot.sameLengthAs}" has ${other.length}` });
  }
  for (const slot of spec.slots) {
    const used = slot.variants === undefined || variant === undefined || slot.variants.includes(variant);
    if (slot.required && used && row.bind[slot.id] === undefined)
      out.push({ path: `${path}.bind`, message: `slot "${slot.id}" is missing` });
  }
}

/**
 * Widget rows in every layout (house decision #83). Their paths are checked against the entity types the layout is
 * for: its own, or for the shared `sheet` key every type without a layout of its own. Plain path rows stay unchecked,
 * as they were before widgets: the sheet leaves out a path it finds no value for.
 */
function layoutProblems(r: Ruleset, out: Problem[]): void {
  for (const key of Object.keys(r.layout).sort()) {
    const layout = r.layout[key];
    if (layout === undefined) continue;
    const mine = r.entities.find((e) => e.id === key);
    const entities = mine ? [mine] : key === "sheet" ? r.entities.filter((e) => own(r.layout, e.id) === undefined) : [];
    const rows = (list: readonly LayoutRow[], path: string) =>
      list.forEach((row, j) => {
        if (typeof row !== "string") widgetRowProblems({ r, row, entities, path: `${path}[${j}]`, out });
      });
    layout.sections.forEach((s, i) => rows(s.show, `layout.${key}.sections[${i}].show`));
    for (const target of LAYOUT_TARGETS) {
      const list = layout[target];
      if (list !== undefined) rows(list, `layout.${key}.${target}`);
    }
  }
}

/** `spends` (house decision #84): ids, costs and inputs. Its expressions and `run` ops are `compileRuleset`'s. */
function spendProblems({
  r,
  actorTypes,
  out,
}: {
  r: Ruleset;
  actorTypes: (ids: readonly string[] | undefined, path: string) => void;
  out: Problem[];
}): void {
  const spends = r.spends ?? [];
  duplicates({ ids: spends.map((s) => s.id), path: "spends", out });
  const resources = new Map(r.resources.map((x) => [x.id, x]));
  spends.forEach((s, i) => {
    const path = `spends[${i}]`;
    actorTypes(s.entities, `${path}.entities`);
    s.cost.forEach((c, j) => {
      const at = `${path}.cost[${j}]`;
      if ((c.pool === undefined) === (c.resource === undefined)) {
        out.push({ path: at, message: "a cost names a pool or a resource" });
        return;
      }
      const id = c.pool ?? c.resource ?? "";
      const key = c.pool === undefined ? "resource" : "pool";
      const res = resources.get(id);
      if (res === undefined) out.push({ path: `${at}.${key}`, message: `unknown resource "${id}"` });
      else if (c.pool !== undefined && res.scope === "entity")
        out.push({ path: `${at}.pool`, message: `"${id}" must be a shared pool` });
      else if (c.resource !== undefined && res.scope !== "entity")
        out.push({ path: `${at}.resource`, message: `"${id}" must be an entity-scoped resource` });
    });
    for (const name of Object.keys(s.inputs ?? {}).sort()) {
      if (SPEND_CTX_ROOTS.has(name)) out.push({ path: `${path}.inputs.${name}`, message: `"${name}" is reserved` });
    }
    if (s.clearOn !== undefined && new Set(s.clearOn).size !== s.clearOn.length)
      out.push({ path: `${path}.clearOn`, message: "an event is listed twice" });
    if (s.then !== undefined) {
      if (r.tables?.[s.then.table] === undefined)
        out.push({ path: `${path}.then.table`, message: `unknown table "${s.then.table}"` });
      const table = r.tables?.[s.then.table];
      for (const key of Object.keys(s.then.inputs ?? {}).sort()) {
        const from = s.then.inputs?.[key] ?? "";
        if (s.inputs?.[from] === undefined)
          out.push({ path: `${path}.then.inputs.${key}`, message: `"${from}" is not an input of the spend` });
        if (table !== undefined && !(table.inputs ?? []).some((x) => x.id === key))
          out.push({ path: `${path}.then.inputs.${key}`, message: `"${key}" is not an input of the table` });
      }
    }
  });
  // A list's quick picks name an entity type (house decision #91).
  r.entities.forEach((e, i) => {
    for (const id of Object.keys(e.fields).sort()) {
      const f = e.fields[id];
      if (f?.type === "list" && f.picks !== undefined && !r.entities.some((x) => x.id === f.picks?.entity))
        out.push({ path: `entities[${i}].fields.${id}.picks.entity`, message: `unknown entity "${f.picks.entity}"` });
    }
  });
}

/**
 * `spawn` (house decision #92): ids, cites, actor types, and what an adjustment adds to: an integer field or an
 * entity resource of a type it applies to. Its expressions and the options' effects are `compileRuleset`'s.
 */
function spawnProblems({
  r,
  actorTypes,
  needCite,
  out,
}: {
  r: Ruleset;
  actorTypes: (ids: readonly string[] | undefined, path: string) => void;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const spawn = r.spawn;
  if (spawn === undefined) return;
  const options = spawn.options ?? [];
  duplicates({ ids: options.map((o) => o.id), path: "spawn.options", out });
  options.forEach((o, i) => {
    needCite(o.cite, `spawn.options[${i}]`);
    actorTypes(o.entities, `spawn.options[${i}].entities`);
  });
  spawn.adjust?.forEach((a, i) => {
    const path = `spawn.adjust[${i}]`;
    needCite(a.cite, path);
    actorTypes(a.entities, `${path}.entities`);
    if (a.option !== undefined && !options.some((o) => o.id === a.option))
      out.push({ path: `${path}.option`, message: `unknown option "${a.option}"` });
    const pool = r.entities.filter((e) => e.base === "actor" && (a.entities?.includes(e.id) ?? true));
    for (const key of Object.keys(a.add).sort()) {
      const counts = pool.some(
        (e) =>
          own(e.fields, key)?.type === "int" ||
          r.resources.some(
            (x) => x.id === key && x.scope === "entity" && (x.entities === undefined || x.entities.includes(e.id)),
          ),
      );
      if (!counts) out.push({ path: `${path}.add.${key}`, message: `no spawned actor has an integer "${key}"` });
    }
  });
  if (spawn.budget !== undefined) {
    needCite(spawn.budget.cite, "spawn.budget");
    duplicates({ ids: spawn.budget.lines.map((l) => l.id), path: "spawn.budget.lines", out });
    duplicates({ ids: (spawn.budget.switches ?? []).map((s) => s.id), path: "spawn.budget.switches", out });
  }
}

/** The actor types a strike may land on (house decision #99): its `targets`, or every type a harm profile holds. */
export function strikeTargets(r: Pick<Ruleset, "entities" | "health">, s: Pick<Strike, "targets">): string[] {
  if (s.targets !== undefined) return [...s.targets];
  const actors = r.entities.filter((e) => e.base === "actor").map((e) => e.id);
  const harm = r.health.harm;
  return harm === undefined ? actors : actors.filter((id) => harm.profiles.some((p) => p.entities.includes(id)));
}

/**
 * `strikes` (house decision #99): ids, cites, actor types, where the means come from, the inputs, what an outcome
 * applies and the table it opens next. Its expressions are `compileRuleset`'s.
 */
function strikeProblems({
  r,
  actorTypes,
  needCite,
  out,
}: {
  r: Ruleset;
  actorTypes: (ids: readonly string[] | undefined, path: string) => void;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const strikes = r.strikes ?? [];
  duplicates({ ids: strikes.map((s) => s.id), path: "strikes", out });
  const harm = r.health.harm;
  strikes.forEach((s, i) => {
    const path = `strikes[${i}]`;
    needCite(s.cite, path);
    actorTypes(s.entities, `${path}.entities`);
    actorTypes(s.targets, `${path}.targets`);
    const attackers = r.entities.filter((e) => e.base === "actor" && (s.entities?.includes(e.id) ?? true));
    s.means?.forEach((m, j) => {
      const at = `${path}.means[${j}]`;
      if (m.from === "ledger") {
        if (r.build === undefined) out.push({ path: at, message: "the ruleset has no build" });
        return;
      }
      if (m.from === "items") {
        const kind = r.items?.kinds.find((k) => k.id === m.kind);
        if (kind === undefined) out.push({ path: `${at}.kind`, message: `unknown item kind "${m.kind}"` });
        else if (!attackers.some((e) => kind.entities.includes(e.id)))
          out.push({ path: `${at}.kind`, message: `no attacker holds "${m.kind}"` });
        return;
      }
      if (!attackers.some((e) => own(e.fields, m.field)?.type === "list"))
        out.push({ path: `${at}.field`, message: `"${m.field}" is not a list field of an attacker` });
      if (!r.entities.some((e) => e.id === m.entry))
        out.push({ path: `${at}.entry`, message: `unknown entity "${m.entry}"` });
    });
    if (s.values !== undefined && s.means === undefined)
      out.push({ path: `${path}.values`, message: "values are read from a means" });
    duplicates({ ids: (s.inputs ?? []).map((x) => x.id), path: `${path}.inputs`, out });
    s.inputs?.forEach((x, j) => {
      const at = `${path}.inputs[${j}]`;
      if (STRIKE_CTX_ROOTS.has(x.id)) out.push({ path: `${at}.id`, message: `"${x.id}" is reserved` });
      if (x.type === "bool" && (x.min !== undefined || x.max !== undefined))
        out.push({ path: at, message: "a switch has no bounds" });
      if (x.type === "choice" && (x.min !== undefined || x.max !== undefined))
        out.push({ path: at, message: "a choice has no bounds" });
      if (x.type === "choice" && x.options === undefined) out.push({ path: at, message: "a choice needs options" });
      if (x.type !== "choice" && x.options !== undefined)
        out.push({ path: `${at}.options`, message: "only a choice has options" });
      x.options?.forEach((o, k) => {
        if (x.options?.findIndex((p) => p.value === o.value) !== k)
          out.push({ path: `${at}.options[${k}].value`, message: `duplicate value ${o.value}` });
      });
      if (x.min !== undefined && x.max !== undefined && x.max < x.min)
        out.push({ path: `${at}.max`, message: "max is below min" });
    });
    duplicates({ ids: (s.shows ?? []).map((x) => x.id), path: `${path}.shows`, out });
    duplicates({ ids: s.outcomes.map((o) => o.id), path: `${path}.outcomes`, out });
    let hits = false;
    s.outcomes.forEach((o, j) => {
      const at = `${path}.outcomes[${j}]`;
      if (o.wounds === undefined && o.shock === undefined) return;
      hits = true;
      if (harm === undefined) out.push({ path: at, message: "a hit needs health.harm" });
      else if (o.shock !== undefined && harm.shock === undefined)
        out.push({ path: `${at}.shock`, message: "this ruleset has no shock" });
    });
    if (hits && harm !== undefined)
      s.targets?.forEach((id, j) => {
        if (r.entities.some((e) => e.id === id) && !harm.profiles.some((p) => p.entities.includes(id)))
          out.push({ path: `${path}.targets[${j}]`, message: `"${id}" has no harm profile` });
      });
    if (s.then !== undefined) {
      const table = r.tables?.[s.then.table];
      if (table === undefined) out.push({ path: `${path}.then.table`, message: `unknown table "${s.then.table}"` });
      for (const key of Object.keys(s.then.inputs ?? {}).sort()) {
        const from = s.then.inputs?.[key] ?? "";
        if (!(s.inputs ?? []).some((x) => x.id === from))
          out.push({ path: `${path}.then.inputs.${key}`, message: `"${from}" is not an input of the strike` });
        if (table !== undefined && !(table.inputs ?? []).some((x) => x.id === key))
          out.push({ path: `${path}.then.inputs.${key}`, message: `"${key}" is not an input of the table` });
      }
    }
  });
}

/**
 * `panels` (house decision #114): ids, cites, actor types, the health states, resource, spends and entries they name,
 * and something to show. Their expressions are `compileRuleset`'s. A resource `opensOn` cannot name is reported at
 * `opensOn`, a guard, so a seat's copy that cannot read the resource loses the panel (house decision #101).
 */
function panelProblems({
  r,
  actorTypes,
  needCite,
  out,
}: {
  r: Ruleset;
  actorTypes: (ids: readonly string[] | undefined, path: string) => void;
  needCite: (cite: string | undefined, path: string) => void;
  out: Problem[];
}): void {
  const panels = r.panels ?? [];
  duplicates({ ids: panels.map((p) => p.id), path: "panels", out });
  const states = new Set(r.health.states.map((s) => s.id));
  panels.forEach((p, i) => {
    const path = `panels[${i}]`;
    needCite(p.cite, path);
    actorTypes(p.entities, `${path}.entities`);
    for (const key of ["holds", "unless"] as const) {
      const id = p[key];
      if (id !== undefined && !states.has(id)) out.push({ path: `${path}.${key}`, message: `unknown state "${id}"` });
    }
    if (p.opensOn !== undefined) {
      const res = r.resources.find((x) => x.id === p.opensOn?.rises);
      if (res === undefined) out.push({ path: `${path}.opensOn`, message: `unknown resource "${p.opensOn.rises}"` });
      else if (res.scope !== "entity")
        out.push({ path: `${path}.opensOn`, message: `"${res.id}" must be an entity-scoped resource` });
    }
    p.spends?.forEach((id, j) => {
      if (!(r.spends ?? []).some((s) => s.id === id))
        out.push({ path: `${path}.spends[${j}]`, message: `unknown spend "${id}"` });
    });
    const o = p.options;
    if (o !== undefined) {
      const entry = r.entities.find((e) => e.id === o.entry);
      if (entry === undefined) out.push({ path: `${path}.options.entry`, message: `unknown entity "${o.entry}"` });
      else {
        if (o.group !== undefined && own(entry.fields, o.group) === undefined)
          out.push({ path: `${path}.options.group`, message: `"${o.group}" is not a field of "${o.entry}"` });
        if (o.needs !== undefined && own(entry.fields, o.needs)?.type !== "text")
          out.push({ path: `${path}.options.needs`, message: `"${o.needs}" is not a text field of "${o.entry}"` });
      }
    }
    if (p.lines === undefined && p.figures === undefined && p.spends === undefined && o === undefined)
      out.push({ path, message: "a panel shows nothing" });
  });
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
  campaignFieldProblems({ r, needCite, out });
  r.conditions.forEach((c, i) => {
    needCite(c.cite, `conditions[${i}]`);
    c.effects.forEach((e, j) => needCite(e.cite ?? c.cite, `conditions[${i}].effects[${j}]`));
    if ((c.at === undefined) !== (c.text === undefined))
      out.push({ path: `conditions[${i}]`, message: "a reminder needs both at and text" });
    if (c.from !== undefined && c.duration !== "ownTurnEnd")
      out.push({ path: `conditions[${i}].from`, message: "only an ownTurnEnd condition is armed from a turn" });
  });
  r.reminders?.forEach((x, i) => needCite(x.cite, `reminders[${i}]`));
  r.rests?.forEach((x, i) => {
    needCite(x.cite, `rests[${i}]`);
    x.refusedIn.forEach((id, j) => {
      if (!r.health.states.some((st) => st.id === id))
        out.push({ path: `rests[${i}].refusedIn[${j}]`, message: `unknown health state "${id}"` });
    });
  });
  for (const [id, t] of Object.entries(r.tests)) {
    needCite(t.cite, `tests.${id}`);
    if (t.kind === "sumVsTarget" && t.degrees) needCite(t.degrees.cite, `tests.${id}.degrees`);
    if (t.kind === "reported") t.outcomes.forEach((o, j) => needCite(o.cite, `tests.${id}.outcomes[${j}]`));
  }
  if (r.initiative) needCite(r.initiative.cite, "initiative");
  if (r.initiative?.strategy === "sides") {
    const { setup, outOfTurn, hold, barred } = r.initiative;
    if (setup) needCite(setup.cite, "initiative.setup");
    if (outOfTurn) needCite(outOfTurn.cite, "initiative.outOfTurn");
    if (hold) needCite(hold.cite, "initiative.hold");
    if (barred) needCite(barred.cite, "initiative.barred");
  }
  r.phases?.forEach((x, i) => needCite(x.cite, `phases[${i}]`));
  for (const [id, t] of Object.entries(r.tables ?? {})) {
    needCite(t.cite, `tables.${id}`);
    tableProblems({ id, t, r, out });
  }
  heldProblems({ r, needCite, out });
  itemProblems({ r, needCite, out });
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
  // Playing without a GM or alone is a rule of the game, so it is cited (principle 1).
  if (r.game?.modes.some((m) => m !== "gm")) needCite(r.game.cite, "game");
  // Death saves and damage order are rules too.
  if (r.health.tracks.length > 0) needCite(r.health.cite, "health");
  if (r.health.harm !== undefined) needCite(r.health.harm.cite, "health.harm");
  r.creation.forEach((x, i) => needCite(x.cite, `creation[${i}]`));

  const fieldCount = r.entities.reduce((n, e) => n + Object.keys(e.fields).length + e.derived.length, 0);
  if (fieldCount > MAX_FIELDS)
    out.push({ path: "entities", message: `${fieldCount} fields, over the cap of ${MAX_FIELDS}` });

  if (r.extends?.id === r.id) out.push({ path: "extends.id", message: "a ruleset cannot extend itself" });
  duplicates({ ids: r.sources.map((s) => s.id), path: "sources", out });
  duplicates({ ids: r.entities.map((e) => e.id), path: "entities", out });
  duplicates({ ids: r.resources.map((x) => x.id), path: "resources", out });
  duplicates({ ids: r.conditions.map((x) => x.id), path: "conditions", out });
  duplicates({ ids: (r.reminders ?? []).map((x) => x.id), path: "reminders", out });
  duplicates({ ids: (r.rests ?? []).map((x) => x.event), path: "rests", out });
  duplicates({ ids: (r.phases ?? []).map((x) => x.id), path: "phases", out });
  if (r.initiative?.strategy === "sides") {
    duplicates({ ids: r.initiative.sides.map((x) => x.id), path: "initiative.sides", out });
    if (r.phases !== undefined) out.push({ path: "phases", message: "sides do not combine with phases yet" });
  }
  r.header?.fields?.forEach((id, i) => {
    const path = `header.fields[${i}]`;
    if (r.campaignFields === undefined || own(r.campaignFields, id) === undefined)
      out.push({ path, message: `unknown campaign field "${id}"` });
    else if (r.header?.fields?.indexOf(id) !== i) out.push({ path, message: `duplicate field "${id}"` });
  });
  if (r.header?.round && r.initiative === undefined)
    out.push({ path: "header.round", message: "a round needs an initiative" });
  duplicates({ ids: r.options.map((x) => x.id), path: "options", out });
  duplicates({ ids: r.creation.map((x) => x.id), path: "creation", out });
  duplicates({ ids: r.decisions.map((x) => x.id), path: "decisions", out });
  creationProblems(r, out);
  buildProblems(r, out);

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
      if (def?.type === "enum") enumWordProblems({ def, path, out });
    }
  });
  codexProblems({ r, entityIds, out });
  layoutProblems(r, out);

  const resources = new Map(r.resources.map((x) => [x.id, x]));
  r.resources.forEach((x, i) => {
    x.entities?.forEach((id, j) => {
      if (!entityIds.has(id)) out.push({ path: `resources[${i}].entities[${j}]`, message: `unknown entity "${id}"` });
    });
    if (x.entities !== undefined && x.scope !== "entity") {
      out.push({ path: `resources[${i}].entities`, message: "only an entity-scoped resource names entities" });
    }
  });

  if (r.initiative?.strategy === "sides")
    sidesProblems({
      init: r.initiative,
      resources,
      entities: (id) => r.entities.find((e) => e.id === id),
      states: new Set(r.health.states.map((x) => x.id)),
      out,
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

  const actorTypes = (ids: readonly string[] | undefined, path: string) =>
    ids?.forEach((id, j) => {
      const e = r.entities.find((x) => x.id === id);
      if (e === undefined) out.push({ path: `${path}[${j}]`, message: `unknown entity "${id}"` });
      else if (e.base !== "actor") out.push({ path: `${path}[${j}]`, message: `"${id}" is not an actor entity` });
    });
  r.health.states.forEach((s, i) => actorTypes(s.entities, `health.states[${i}].entities`));
  if (r.health.harm !== undefined) harmProblems({ r, harm: r.health.harm, actorTypes, out });
  r.spends?.forEach((s, i) => needCite(s.cite, `spends[${i}]`));
  spendProblems({ r, actorTypes, out });
  spawnProblems({ r, actorTypes, needCite, out });
  strikeProblems({ r, actorTypes, needCite, out });
  panelProblems({ r, actorTypes, needCite, out });

  for (const [id, t] of Object.entries(r.tests)) {
    actorTypes(t.entities, `tests.${id}.entities`);
    for (const key of Object.keys(t.inputOptions)) {
      if (t.inputs[key] !== "text")
        out.push({ path: `tests.${id}.inputOptions.${key}`, message: "options are only for text inputs" });
    }
    testWordProblems({ t, path: `tests.${id}`, out });
    testOutcomeProblems({ r, id, t, needCite, out });
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
  r.notices?.forEach((n, i) => {
    const path = `notices[${i}]`;
    needCite(n.cite, path);
    actorTypes(n.entities, `${path}.entities`);
    if (n.params?.name !== undefined) out.push({ path: `${path}.params.name`, message: "{name} is the actor's name" });
    if (n.rises !== undefined && n.when !== "crossed")
      out.push({ path: `${path}.rises`, message: 'rises needs when "crossed"' });
    if (n.group !== undefined) {
      if (n.params !== undefined) out.push({ path: `${path}.params`, message: "a group rule reads no one actor" });
      if (n.rises !== undefined) out.push({ path: `${path}.rises`, message: "a group rule reads no one actor" });
      if (n.text.includes("{name}")) out.push({ path: `${path}.text`, message: "a group rule names no one actor" });
    }
  });
  duplicates({ ids: (r.notices ?? []).map((n) => n.id), path: "notices", out });
  r.checklist?.forEach((s, i) => {
    needCite(s.cite, `checklist[${i}]`);
    checklistProblems({ r, done: s.done, path: `checklist[${i}].done`, out });
    if (s.goto?.kind !== undefined && s.goto.tab !== "codex")
      out.push({ path: `checklist[${i}].goto.kind`, message: "only the codex tab takes a kind" });
  });
  duplicates({ ids: (r.checklist ?? []).map((s) => s.id), path: "checklist", out });
  r.generators?.forEach((g, i) => {
    needCite(g.cite, `generators[${i}]`);
    generatorProblems({ r, g, path: `generators[${i}]`, out });
  });
  duplicates({ ids: (r.generators ?? []).map((g) => g.id), path: "generators", out });
  return out;
}

/** Whether a step's answer fits a codex field: words in text, a number in an int, a choice in an enum, a pick in a ref. */
function stepFills(s: GeneratorStep, def: CodexField): boolean {
  switch (def.type) {
    case "text":
      return s.kind !== "number";
    case "int":
      return s.kind === "number";
    case "enum":
      return s.kind === "choice" && s.options.every((o) => def.values.includes(o));
    case "ref":
      return s.kind === "pick" && s.entity === def.entity;
    default:
      return false;
  }
}

/**
 * A generator's steps name what the ruleset has, its ids are unique, and what it makes reads steps it has and fills
 * fields its kind declares (house decision #98). Its expressions are checked when the ruleset compiles.
 */
function generatorProblems({ r, g, path, out }: { r: Ruleset; g: Generator; path: string; out: Problem[] }): void {
  const push = (at: string, message: string) => out.push({ path: at, message });
  duplicates({ ids: g.steps.map((s) => s.id), path: `${path}.steps`, out });
  const top = new Set(g.steps.map((s) => s.id));
  g.each?.steps.forEach((s, j) => {
    if (top.has(s.id)) push(`${path}.each.steps[${j}].id`, `duplicate id "${s.id}"`);
  });
  if (g.each !== undefined) duplicates({ ids: g.each.steps.map((s) => s.id), path: `${path}.each.steps`, out });
  const stepChecks = (steps: readonly GeneratorStep[], at: string) =>
    steps.forEach((s, j) => {
      const sp = `${at}[${j}]`;
      if (s.kind === "roll") {
        const t = own(r.tables ?? {}, s.table);
        if (t === undefined) push(`${sp}.table`, `unknown table "${s.table}"`);
        else if (t.visibility === "owner") push(`${sp}.table`, `"${s.table}" is dealt, never rolled`);
      }
      if (s.kind === "pick" && !r.entities.some((e) => e.id === s.entity))
        push(`${sp}.entity`, `unknown entity "${s.entity}"`);
      if (s.kind === "number" && s.max < s.min) push(`${sp}.max`, "max is below min");
      if (s.kind === "choice") {
        s.options.forEach((o, k) => {
          if (s.options.indexOf(o) !== k) push(`${sp}.options[${k}]`, `"${o}" is there twice`);
        });
        enumWordProblems({ def: { values: s.options, labels: s.labels }, path: sp, out });
      }
    });
  stepChecks(g.steps, `${path}.steps`);
  if (g.each !== undefined) stepChecks(g.each.steps, `${path}.each.steps`);
  const kind = r.codex?.kinds[g.make.kind];
  const made = (m: GeneratedEntry, steps: readonly GeneratorStep[], at: string) => {
    const step = (id: string) => steps.find((s) => s.id === id);
    if (step(m.title) === undefined) push(`${at}.title`, `"${m.title}" is not a step`);
    if (m.from !== undefined) {
      const s = step(m.from);
      if (s?.kind !== "pick" || !(kind?.from ?? []).some((f) => f.entity === s.entity))
        push(`${at}.from`, `"${m.from}" is not a pick of a type ${g.make.kind} is made from`);
    }
    for (const [f, id] of Object.entries(m.fields ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const def = own(kind?.fields ?? {}, f);
      const s = step(id);
      if (def === undefined) push(`${at}.fields.${f}`, `"${f}" is not a field of ${g.make.kind}`);
      else if (s === undefined) push(`${at}.fields.${f}`, `"${id}" is not a step`);
      else if (!stepFills(s, def)) push(`${at}.fields.${f}`, `"${id}" can't fill "${f}"`);
    }
  };
  made(g.make, g.steps, `${path}.make`);
  if (g.make.each !== undefined) made(g.make.each, [...g.steps, ...(g.each?.steps ?? [])], `${path}.make.each`);
  if (g.each !== undefined && g.make.each === undefined) push(`${path}.make`, "each round needs what it makes");
  if (g.each === undefined && g.make.each !== undefined) push(`${path}.make.each`, "nothing repeats");
  if (g.make.each !== undefined && g.make.kind === "scene")
    push(`${path}.make.each`, "a scene sits under an adventure, not a scene");
}

/** A checklist step counts what the ruleset declares (house decision #90). */
function checklistProblems({ r, done, path, out }: { r: Ruleset; done: ChecklistCount; path: string; out: Problem[] }) {
  switch (done.count) {
    case "entries": {
      const defs = r.codex?.kinds[done.kind]?.fields ?? {};
      const def = done.field === undefined ? undefined : own(defs, done.field);
      if (done.field !== undefined && def === undefined)
        out.push({ path: `${path}.field`, message: `"${done.field}" is not a field of ${done.kind}` });
      if (done.equals !== undefined && done.field === undefined)
        out.push({ path: `${path}.equals`, message: "equals needs a field" });
      if (done.equals !== undefined && def !== undefined) {
        const why = checkFieldValue({ def, value: done.equals });
        if (why !== null) out.push({ path: `${path}.equals`, message: why });
      }
      if (done.prep !== undefined && done.kind !== "scene")
        out.push({ path: `${path}.prep`, message: "only a scene holds prepared lines" });
      return;
    }
    case "actors": {
      const e = r.entities.find((x) => x.id === done.entity);
      if (e === undefined) out.push({ path: `${path}.entity`, message: `unknown entity "${done.entity}"` });
      else if (e.base !== "actor")
        out.push({ path: `${path}.entity`, message: `"${done.entity}" is not an actor entity` });
      else if (done.built === true && r.build?.actor !== done.entity)
        out.push({ path: `${path}.built`, message: `"${done.entity}" has no build` });
      return;
    }
    case "campaignField":
      if (r.campaignFields === undefined || own(r.campaignFields, done.field) === undefined)
        out.push({ path: `${path}.field`, message: `unknown campaign field "${done.field}"` });
      return;
    case "pool": {
      const res = r.resources.find((x) => x.id === done.pool);
      if (res === undefined || res.scope === "entity")
        out.push({ path: `${path}.pool`, message: `"${done.pool}" is not a shared pool` });
      return;
    }
    default:
      return;
  }
}

/**
 * Size caps, schema, then the rules a schema can't say: cites (unless homebrew), the field cap, unique ids and
 * references. Expressions are checked by `compileRuleset`, which runs this first.
 */
/**
 * What an import refuses beyond what compiles: a table with no entry, which only a seat's copy of a table it may not
 * read has (house decision #101). Run on a ruleset that compiled.
 */
export function importProblems(r: Ruleset): Problem[] {
  return Object.entries(r.tables ?? {}).flatMap(([id, t]) =>
    t.entries.length === 0 ? [{ path: `tables.${id}.entries`, message: "a table needs an entry" }] : [],
  );
}

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
