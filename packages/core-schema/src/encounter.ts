import { z } from "zod";

// The combat tracker's wire shapes (docs/p1-plan.md, F): the encounter in the live snapshot and the actions that run it
// (what each seat gets of it is decided by the api's Seat view module).

export const CombatSide = z.enum(["party", "foe", "other"]);
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
});
export type CombatantCondition = z.infer<typeof CombatantCondition>;

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
  /** The health track as 0..1, for the bar; null when the actor has no health to show. */
  bar: z.number().min(0).max(1).nullable(),
  conditions: z.array(CombatantCondition), // GM side only
});
export type Combatant = z.infer<typeof Combatant>;

export const Encounter = z.object({
  id: z.string(),
  round: z.number().int(),
  currentId: z.string().nullable(), // the combatant whose turn it is
  /** Open with no session running: the order shows, nothing moves (house decision #28). */
  paused: z.boolean(),
  /** The ruleset's first health track: which resources the tracker's keypad changes. Null when it declares none. */
  health: z.object({ resource: z.string(), temp: z.string().nullable(), deathSaves: z.boolean() }).nullable(),
  /** The ruleset's conditions, for the GM's picker. GM side only. */
  conditionDefs: z.array(z.object({ id: z.string(), label: z.string(), duration: z.string() })),
  combatants: z.array(Combatant), // in turn order
});
export type Encounter = z.infer<typeof Encounter>;

const id = z.uuid();

export const ENCOUNTER_ACTIONS = [
  z.object({ type: z.literal("encounter.start") }),
  z.object({ type: z.literal("encounter.end") }),
  z.object({
    type: z.literal("encounter.add"),
    actorIds: z.array(id).min(1).max(50),
    side: CombatSide,
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
] as const;
