import { z } from "zod";

// Every closed set the engine uses, defined once (backend-code-style: "Closed value sets: define once").

/** Who may see a value. Ordered loosest to strictest in VISIBILITY_RANK; undeclared means `gm` (fail-closed). */
export const Visibility = z.enum(["public", "party", "owner", "gm"]);
export type Visibility = z.infer<typeof Visibility>;

export const VISIBILITY_RANK: Record<Visibility, number> = { public: 0, party: 1, owner: 2, gm: 3 };

/** The most restrictive of the given visibilities; `public` when there are none (a literal hides nothing). */
export function strictestVisibility(list: readonly Visibility[]): Visibility {
  let out: Visibility = "public";
  for (const v of list) if (VISIBILITY_RANK[v] > VISIBILITY_RANK[out]) out = v;
  return out;
}

export const EditableBy = z.enum(["gm", "owner", "ownerSpendOnly"]);
export type EditableBy = z.infer<typeof EditableBy>;

/** Which of the − and + a seat gets on a value declared `editableBy`: the GM side both, `owner` both, `ownerSpendOnly` − only. */
export function stepsFor({ editableBy, gmSide }: { editableBy: EditableBy; gmSide: boolean }): {
  dec: boolean;
  inc: boolean;
} {
  if (gmSide || editableBy === "owner") return { dec: true, inc: true };
  return { dec: editableBy === "ownerSpendOnly", inc: false };
}

export const ResourceScope = z.enum(["entity", "party", "gm", "campaign"]);
export type ResourceScope = z.infer<typeof ResourceScope>;

export const ResetEvent = z.enum(["sessionStart", "sessionEnd", "encounterEnd", "shortRest", "longRest"]);
export type ResetEvent = z.infer<typeof ResetEvent>;

export const License = z.enum(["srd", "orc", "cc-by", "private", "homebrew"]);
export type License = z.infer<typeof License>;

/** A pack's license. `original` is the author's own work (the pack analogue of a homebrew ruleset). */
export const PackLicense = z.enum(["private", "srd", "cc-by", "orc", "original"]);
export type PackLicense = z.infer<typeof PackLicense>;

/** Licenses that oblige the pack to name its attribution. */
export const ATTRIBUTION_LICENSES: ReadonlySet<PackLicense> = new Set(["srd", "cc-by", "orc"]);

/** Who sees a pack entry. Narrower than `Visibility`: an entry is never `owner`-only. Undeclared means `gm`. */
export const EntryVisibility = z.enum(["public", "party", "gm"]);
export type EntryVisibility = z.infer<typeof EntryVisibility>;

export const EntityBase = z.enum(["actor", "item", "ability", "condition"]);
export type EntityBase = z.infer<typeof EntityBase>;

export const FieldType = z.enum(["int", "text", "enum", "bool", "ref", "list"]);
export type FieldType = z.infer<typeof FieldType>;

export const ConditionDuration = z.enum(["ownTurnEnd", "roundEnd", "encounterEnd", "manual"]);
export type ConditionDuration = z.infer<typeof ConditionDuration>;

/** `none`: applying it again does nothing; `stack`: adds a stack up to maxStacks; `refresh`: restarts its duration. */
export const ConditionStacking = z.enum(["none", "stack", "refresh"]);
export type ConditionStacking = z.infer<typeof ConditionStacking>;

export const CreationKind = z.enum(["choose", "assign", "fields"]);
export type CreationKind = z.infer<typeof CreationKind>;

export const ScoreMethodKind = z.enum(["table", "pointBuy"]);
export type ScoreMethodKind = z.infer<typeof ScoreMethodKind>;

export const EffectMode = z.enum(["add", "multiply", "override", "upgrade", "downgrade"]);
export type EffectMode = z.infer<typeof EffectMode>;

export const EffectPhase = z.enum(["base", "derived"]);
export type EffectPhase = z.infer<typeof EffectPhase>;

/** Which snapshot an op changes, so the gateway knows what to rebroadcast. */
export const Touches = z.enum(["state", "codex", "both"]);
export type Touches = z.infer<typeof Touches>;

export const DeltaKind = z.enum(["set", "add"]);
export type DeltaKind = z.infer<typeof DeltaKind>;

/** Encounter-level values the turn primitives write. */
export const TurnKey = z.enum(["round", "currentId", "order", "firstId", "phaseId", "done"]);
export type TurnKey = z.infer<typeof TurnKey>;

/** Values of the open Test call that a test primitive writes. */
export const TestKey = z.enum(["outcome", "total", "natural", "margin", "shifts", "flags"]);
export type TestKey = z.infer<typeof TestKey>;

export const ViewerRole = z.enum(["gm", "player", "screen", "public"]);
export type ViewerRole = z.infer<typeof ViewerRole>;

export const TestOutcome = z.enum(["success", "failure", "critical"]);
export type TestOutcome = z.infer<typeof TestOutcome>;

/** What the special dice of a Dice pool can flag on a roll, beside its outcome. */
export const PoolFlag = z.enum(["critical", "complication"]);
export type PoolFlag = z.infer<typeof PoolFlag>;

export const AdvantageMode = z.enum(["none", "advantage", "disadvantage"]);
export type AdvantageMode = z.infer<typeof AdvantageMode>;

/** Whether a total equal to the target passes. Declared per Test so the engine never picks silently. */
export const TieRule = z.enum(["meetOrBeat", "beat"]);
export type TieRule = z.infer<typeof TieRule>;

/** The status the health primitive keeps per actor. A missing value reads as `ok`. */
export const HealthState = z.enum(["ok", "dying", "stable", "dead"]);
export type HealthState = z.infer<typeof HealthState>;

export const DeathSaveResult = z.enum(["success", "failure", "criticalSuccess", "criticalFailure"]);
export type DeathSaveResult = z.infer<typeof DeathSaveResult>;

/** Why an op refused. The api maps these to its ActionError. */
export const RefusalCode = z.enum([
  "unknownPrimitive",
  "unknownOp",
  "badParams",
  "badInput",
  "unknownActor",
  "unknownResource",
  "noEncounter",
  "wrongState",
  "outOfTargets",
]);
export type RefusalCode = z.infer<typeof RefusalCode>;

/** Value types the expression checker knows. */
export const ScalarType = z.enum(["int", "bool", "text"]);
export type ScalarType = z.infer<typeof ScalarType>;
