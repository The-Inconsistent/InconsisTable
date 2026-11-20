import { z } from "zod";

// The combat tracker's wire shapes (docs/p1-plan.md, F): the encounter in the live snapshot and the actions that run it
// (what each seat gets of it is decided by the api's Seat view module).

// `party`, `foe` or `other`, or, in a game whose turn order is `sides`, one of the ruleset's side ids; the api checks which.
export const CombatSide = z.string().min(1).max(64);
export type CombatSide = z.infer<typeof CombatSide>;

// What a seat that is not running the fight sees of a combatant: nothing, a name with a health bar, or the numbers the
// ruleset's viewer view already lets it see.
export const CombatVisibility = z.enum(["hidden", "bar", "full"]);
export type CombatVisibility = z.infer<typeof CombatVisibility>;

export const CombatantCondition = z.object({
  id: z.string(), // the condition id of the ruleset
  /** Turns or rounds left for the expiries that count; null when it doesn't count. */
  left: z.number().int().nullable(),
  expiresOn: z.string(),
  /** How many it holds, when more than one (house decision #81). */
  stacks: z.number().int().optional(),
});
export type CombatantCondition = z.infer<typeof CombatantCondition>;

/** A reminder line due now (house decision #81): the ruleset's own words, with the combatants it holds for. */
export const EncounterReminder = z.object({
  at: z.enum(["turnStart", "turnEnd", "roundEnd"]),
  source: z.enum(["reminder", "condition"]),
  id: z.string(),
  text: z.string(),
  cite: z.string().nullable(),
  actorIds: z.array(z.string()),
});
export type EncounterReminder = z.infer<typeof EncounterReminder>;

export const Combatant = z.object({
  id: z.string(),
  actorId: z.string(),
  name: z.string(),
  side: CombatSide,
  ord: z.number().int(),
  initiative: z.number().int().nullable(), // what the GM typed from the dice; null until entered
  visibility: CombatVisibility,
  keep: z.boolean(), // a temporary creature the GM keeps at encounter end
  /** The health track's numbers; null when the seat may not see them (`bar` and hidden values never carry them). */
  hp: z.object({ value: z.number().int(), max: z.number().int().nullable() }).nullable(),
  /**
   * How much is left, 0..1, for the bar; null when the actor has no health to show. A `health.tracks` ruleset reads its
   * first track; a `health.harm` one a mob's members over their max, anyone else 1 - wounds / max (house decision #66).
   */
  bar: z.number().min(0).max(1).nullable(),
  /** The ruleset's health states that hold for the actor, in manifest order, decided on the server. */
  states: z.array(z.object({ id: z.string(), label: z.string() })),
  /** A mob's members standing (house decision #66); null for anyone else. */
  members: z.object({ value: z.number().int(), max: z.number().int().nullable() }).nullable(),
  /** The conditions the ruleset lets the seat see on the actor (house decision #67); every one for the combat side. */
  conditions: z.array(CombatantCondition),
  /** Sides order only (house decision #60): holding an action, barred this round, unable to act. Absent otherwise. */
  held: z.boolean().optional(),
  barred: z.boolean().optional(),
  unable: z.boolean().optional(),
});
export type Combatant = z.infer<typeof Combatant>;

export const Encounter = z.object({
  id: z.string(),
  round: z.number().int(),
  currentId: z.string().nullable(), // the combatant whose turn it is
  firstId: z.string().nullable(), // the first player of the round (seated order); null for a ranked order
  /** The phase of the round, an id of the ruleset's `phases`; null when it has none. */
  phaseId: z.string().nullable(),
  /** The ruleset's phases in order, for the banner; empty when it has none. */
  phases: z.array(z.object({ id: z.string(), label: z.string(), mode: z.enum(["turns", "simultaneous"]) })),
  /** Combatants that marked the simultaneous phase done. */
  done: z.array(z.string()),
  /** How a seated order picks the first player; null when the order is ranked by initiative. */
  firstPlayer: z.enum(["fixed", "rotate", "manual"]).nullable(),
  /** Open with no session running: the order shows, nothing moves (house decision #28). */
  paused: z.boolean(),
  /** The ruleset's first health track: which resources the tracker's keypad changes. Null when it declares none. */
  health: z.object({ resource: z.string(), temp: z.string().nullable(), deathSaves: z.boolean() }).nullable(),
  /** The ruleset's conditions, for the GM's picker. GM side only. */
  conditionDefs: z.array(z.object({ id: z.string(), label: z.string(), duration: z.string() })),
  /** Indexes of the ruleset's `endWhen` triggers that hold now (house decision #38); empty without a scoring block. */
  endMet: z.array(z.number().int()),
  /** How the ruleset scores the game; null when it has no scoring block, so the game cannot be ended with a result. */
  scoring: z.object({ mode: z.enum(["compete", "coop"]) }).nullable(),
  combatants: z.array(Combatant), // in turn order
  /**
   * True when the combatant acting is one this seat is not sent (a hidden one): the seat's `currentId` is null, and
   * this says a turn is being taken all the same (house decision #68). Absent otherwise, and always for the combat side.
   */
  unseen: z.boolean().optional(),
  /** The reminder lines due now (house decision #81): the combat side's only, absent for every other seat or when none. */
  reminders: z.array(EncounterReminder).optional(),
  /**
   * What TURN BACK would take back (house decision #82): the last step's kind, whose turn (absent for a round), its
   * round, and how many later actions go back with it. The combat side's only; absent with nothing to take back.
   */
  turnBack: z
    .object({
      kind: z.enum(["turnStart", "turnEnd", "round"]),
      name: z.string().optional(),
      round: z.number().int(),
      later: z.number().int(),
    })
    .optional(),
  /** Sides order only (house decision #60), absent otherwise: whether the fight has begun (a setup opens it not begun). */
  begun: z.boolean().optional(),
  /** The side that acted last, and the side that acted out of turn this round; side ids, so public. */
  lastSide: z.string().nullable().optional(),
  outOfTurnSide: z.string().nullable().optional(),
  /** The side whose pick it is now; null when no side has anyone pending. */
  sideUp: z.string().nullable().optional(),
});
export type Encounter = z.infer<typeof Encounter>;

/** One line of an ended game's result. `actorId` is null once the character is gone; `name` is kept as it was. */
export const GameResult = z.object({
  resultId: z.string(),
  actorId: z.string().nullable(),
  name: z.string(),
  score: z.number().int(),
  tiebreaks: z.array(z.number().int()),
  /** Null for a cooperative game. */
  place: z.number().int().nullable(),
  /** `win` or `lose` for a cooperative game, null otherwise. */
  outcome: z.enum(["win", "lose"]).nullable(),
});
export type GameResult = z.infer<typeof GameResult>;

/** An ended game of the campaign (house decisions #38-#39), the 20 most recent first in the snapshot. */
export const Game = z.object({
  encounterId: z.string(),
  endedAt: z.string(),
  /** The table ended it with no `endWhen` trigger met. */
  endedEarly: z.boolean(),
  mode: z.enum(["compete", "coop"]),
  rows: z.array(GameResult),
});
export type Game = z.infer<typeof Game>;

const id = z.uuid();

export const ENCOUNTER_ACTIONS = [
  z.object({ type: z.literal("encounter.start") }),
  z.object({ type: z.literal("encounter.end") }),
  z.object({
    type: z.literal("encounter.add"),
    actorIds: z.array(id).min(1).max(50),
    // Absent: a sides order places each actor by its entity type (house decision #60).
    side: CombatSide.optional(),
    visibility: CombatVisibility.default("bar"),
  }),
  z.object({ type: z.literal("encounter.remove"), combatantId: id }),
  // The GM types what was rolled on the table or said aloud; the app never rolls (CLAUDE.md, principle 5).
  z.object({
    type: z.literal("encounter.setInitiative"),
    combatantId: id,
    score: z.number().int().min(-1000).max(1000).nullable(),
  }),
  // Moves a combatant one place among those with the same initiative: how the GM settles a tie.
  z.object({ type: z.literal("encounter.move"), combatantId: id, direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("encounter.setVisibility"), combatantId: id, visibility: CombatVisibility }),
  z.object({ type: z.literal("encounter.keep"), combatantId: id, keep: z.boolean() }),
  z.object({ type: z.literal("turn.next") }),
  z.object({ type: z.literal("turn.prev") }),
  // Sets the first player of the round, for a seated ruleset whose first player is set by hand (house decision #36).
  z.object({ type: z.literal("turn.first"), combatantId: id }),
  // A seat marks a character done in a simultaneous phase (house decision #37); the last one moves the phase on.
  z.object({ type: z.literal("phase.done"), actorId: id }),
  // Scores every combatant, ranks them, writes the results and closes the encounter like encounter.end. Not undoable.
  z.object({ type: z.literal("game.end") }),
  // Corrects one result's score and ranks the whole game again (house decision #38).
  z.object({ type: z.literal("result.set"), resultId: id, score: z.number().int().min(-1_000_000).max(1_000_000) }),
] as const;
