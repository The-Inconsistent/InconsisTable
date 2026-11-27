import { z } from "zod";

// A Test the GM has called (docs/design.md §6.3, docs/p1-plan.md G). The dice stay physical: a seat reports what
// it rolled and the server resolves it with the engine, because the target number may be hidden. Everything here is
// what the *snapshot* carries; the api's Seat view module decides, per seat, which of it leaves the server.

// What the engine calls the outcome (`TestOutcome`) and a Test input's type (`ScalarType`) are the engine's closed
// sets; core-schema can't import the engine, so they travel as strings and the web parses them with the engine's schemas.
export const TestCallStatus = z.enum(["open", "closed"]);
export type TestCallStatus = z.infer<typeof TestCallStatus>;

export const TestInputValue = z.union([z.number(), z.string().max(100), z.boolean()]);
export type TestInputValue = z.infer<typeof TestInputValue>;
export const TestInputs = z.record(z.string().max(64), TestInputValue);
export type TestInputs = z.infer<typeof TestInputs>;

/**
 * What a phone needs to take a Dice pool report: the die, the scoring bands to count dice in and how many special
 * dice are read face by face. Null on a sum Test. Rules numbers, so the ruleset's own; flags and shifts are not here.
 */
export const PoolSpec = z.object({
  die: z.int(),
  bands: z.array(z.object({ id: z.string(), from: z.int(), to: z.int(), worth: z.int() })),
  special: z.object({ label: z.string(), count: z.int() }).nullable(),
  /** The band whose dice may be shifted. */
  shift: z.string().nullable(),
});
export type PoolSpec = z.infer<typeof PoolSpec>;

/** A result a reported Test lists, best first. The cite stays in the ruleset. */
export const OutcomeSpec = z.object({ id: z.string(), label: z.string() });
export type OutcomeSpec = z.infer<typeof OutcomeSpec>;

/** A Test of the pinned ruleset the GM can call: what the call form asks for. GM seats only. */
export const TestDef = z.object({
  id: z.string(),
  dice: z.string(),
  advantage: z.boolean(),
  pool: PoolSpec.nullable(),
  /** Set on a reported Test: it has no dice, target or modifier, and the reporter picks one of these. */
  outcomes: z.array(OutcomeSpec).nullable(),
  /** The actor entity type ids that take this Test (house decision #50); absent when every type does. */
  entities: z.array(z.string()).optional(),
  inputs: z.array(z.object({ id: z.string(), type: z.string(), options: z.array(z.string()).optional() })),
  /**
   * The ruleset's words for the Test, its inputs (by input id) and a text input's options (by input id, then option),
   * house decision #77. Each is absent when the ruleset gives none; a screen then shows the id or the option itself.
   */
  label: z.string().optional(),
  inputLabels: z.record(z.string(), z.string()).optional(),
  inputOptionLabels: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  /** The yes-or-no the GM sets when calling, by id with its word (house decision #80); absent when there is none. */
  marks: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export type TestDef = z.infer<typeof TestDef>;

/** What the taker set while reporting, by choice id (house decision #170): a switch, or a whole number. */
export const TestChoiceValues = z.record(z.string().max(64), z.union([z.boolean(), z.int().min(0).max(20)]));
export type TestChoiceValues = z.infer<typeof TestChoiceValues>;

/** A choice the taker makes while reporting (house decision #170): a switch, or with `max` a number from 0 to it. */
export const ChoiceSpec = z.object({ id: z.string(), label: z.string(), max: z.int().optional() });
export type ChoiceSpec = z.infer<typeof ChoiceSpec>;

/** A reported roll as a seat may see it: a field the seat may not see is null. */
export const TestResult = z.object({
  natural: z.int().nullable(),
  /** A Dice pool's score. */
  total: z.int().nullable(),
  outcome: z.string().nullable(),
  // A Dice pool's: the score minus the difficulty number, and the dice that could be shifted. Null for a sum Test.
  margin: z.int().nullable(),
  shifts: z.int().nullable(),
  /** What a Dice pool's special dice flagged (the engine's `PoolFlag`); empty for a sum Test. */
  flags: z.array(z.string()),
  /**
   * What the taker chose (house decision #170), every choice the Test declares: absent when it declares none, or when
   * the seat may not be told the result's numbers (a choice moves the number to beat).
   */
  choices: TestChoiceValues.optional(),
});
export type TestResult = z.infer<typeof TestResult>;

/**
 * What a taker's result offers the GM (house decision #80): each change with its pool or resource, the ruleset's label
 * for it and the amount worked out for that taker, and whether it was applied. GM side only.
 */
export const OfferState = z.object({
  id: z.string(),
  label: z.string(),
  changes: z.array(
    z.object({ pool: z.string().optional(), resource: z.string().optional(), label: z.string(), by: z.int() }),
  ),
  applied: z.boolean(),
});
export type OfferState = z.infer<typeof OfferState>;

export const TestTargetState = z.object({
  actorId: z.string(),
  /** Added to the die, or dice added to a pool: null when the seat may not be told it (or it was never computed). */
  modifier: z.int().nullable(),
  /** The number to beat: null when it is hidden from the seat. */
  target: z.int().nullable(),
  /** A Dice pool's dice to roll, modifier included: null for a sum Test or when the seat may not be told it. */
  pool: z.int().nullable(),
  report: TestResult.nullable(),
  /** The GM side's only: absent when there is none, and never sent to a seat below it. */
  offers: z.array(OfferState).optional(),
});
export type TestTargetState = z.infer<typeof TestTargetState>;

/** One of an acquisition's Test inputs: its total and the labelled parts it adds up from (house decision #102). */
export const AcquireInputState = z.object({
  total: z.number(),
  parts: z.array(z.object({ label: z.string(), value: z.number() })),
});
export const CallAcquire = z.object({
  name: z.string(),
  kind: z.string(),
  inputs: z.record(z.string(), AcquireInputState),
});
export type CallAcquire = z.infer<typeof CallAcquire>;

export const TestCall = z.object({
  id: z.string(),
  testId: z.string(),
  dice: z.string(),
  /** Whether the Test allows rolling with advantage or disadvantage. */
  advantage: z.boolean(),
  /** Set on a Dice pool Test: the phone reports counts per band instead of faces. */
  pool: PoolSpec.nullable(),
  /** Set on a reported Test: the phone shows these as buttons and the report's `outcome` is one of their ids. */
  outcomes: z.array(OutcomeSpec).nullable(),
  /** What the taker may choose while reporting (house decision #170); absent when the Test declares none. */
  choices: z.array(ChoiceSpec).optional(),
  status: TestCallStatus,
  createdAt: z.string(),
  /** What the GM supplied when calling. Inputs the hidden target reads are removed for seats without GM rights. */
  inputs: TestInputs,
  secretInputs: z.array(z.string()), // GM seats only
  // What the table may be told. The server sets these from the call and the ruleset's declared visibility; a seat
  // below the GM reads them as given. `showOutcome` is already true whenever the target is shown.
  showTarget: z.boolean(),
  showModifier: z.boolean(),
  showOutcome: z.boolean(),
  /** The GM closed the call and showed every result to the characters that were called. */
  revealed: z.boolean(),
  called: z.int(),
  reported: z.int(),
  targets: z.array(TestTargetState),
  /** A call made for an acquisition (house decision #102): the entry asked for, the kind it is granted as, and the
   * Test's inputs each as its total and its labelled parts. Never on the table screen. */
  acquire: CallAcquire.optional(),
});
export type TestCall = z.infer<typeof TestCall>;

// Actions. `advantage` and `roll` are the engine's `AdvantageMode` and `SumVsTargetRoll`; the api parses them there.
export const TestCallAction = z.object({
  type: z.literal("test.call"),
  testId: z.string().min(1).max(64),
  actorIds: z.array(z.uuid()).min(1).max(50),
  inputs: TestInputs.default({}),
  hideTarget: z.boolean().default(false),
  // With a hidden target: whether the called players are told success or failure.
  showOutcome: z.boolean().default(false),
});
// A report is either dice (`roll`, with an optional `advantage` that the api reads as "none") for a sum or Dice pool
// Test, or the id of an `outcome` for a reported Test (house decision #41). The union of the two shapes is
// `TestReport`, which is what callers build; the action itself is one object so it can sit in the action union, and
// refuses a report that carries both or neither.
export type TestReport =
  | { callId: string; actorId: string; advantage?: string; roll: Record<string, unknown>; outcome?: never }
  | { callId: string; actorId: string; outcome: string; roll?: never; advantage?: never };
export const TestReportAction = z
  .object({
    type: z.literal("test.report"),
    callId: z.uuid(),
    actorId: z.uuid(),
    advantage: z.string().max(20).optional(),
    roll: z.record(z.string().max(20), z.unknown()).optional(),
    outcome: z.string().min(1).max(64).optional(),
    /** What the taker chose (house decision #170); the server checks each against the Test's declared choices. */
    choices: TestChoiceValues.optional(),
  })
  .refine(
    (a) =>
      (a.roll === undefined) !== (a.outcome === undefined) && (a.outcome === undefined || a.advantage === undefined),
    "Report either a roll or an outcome",
  );
// Applies one offer of a taker's result, once, through the ordinary writes (house decision #80).
export const TestApplyOfferAction = z.object({
  type: z.literal("test.applyOffer"),
  callId: z.uuid(),
  actorId: z.uuid(),
  offerId: z.string().min(1).max(64),
});
export const TestCloseAction = z.object({
  type: z.literal("test.close"),
  callId: z.uuid(),
  reveal: z.boolean().default(false),
});
