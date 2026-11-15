import {
  ConditionDuration,
  ConditionStacking,
  CreationKind,
  EditableBy,
  EffectMode,
  EffectPhase,
  EntityBase,
  EntryVisibility,
  FieldType,
  GameMode,
  License,
  PackLicense,
  ResourceScope,
  TieRule,
  Visibility,
} from "@inconsistable/rules-engine";

import type en from "../../../../../messages/en.json";

import type { Spec } from "./components/form-fields/form-fields";

/** The keys of the labels the form has words for (`manifestForm.f`): a spec's key is one of them unless it brings its own text. */
export type LabelKey = keyof typeof en.manifestForm.f;

// What each part of a manifest asks for, as the form lays it out. The keys and enums are the engine's own; nothing
// here knows a game. A key the schema defaults is `optional` (empty means "leave it out").

/** The validator runs this long after the last keystroke. */
export const VALIDATE_DEBOUNCE_MS = 300;

export const SOURCE_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "title", kind: "text" },
  { key: "license", kind: "select", options: License.options },
  { key: "pageOffset", kind: "int", optional: true },
];

export const ENTITY_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "base", kind: "select", options: EntityBase.options },
];

export const FIELD_TYPES = FieldType.options;
const fieldBase: Spec[] = [
  { key: "label", kind: "text" },
  { key: "visibility", kind: "select", options: Visibility.options, optional: true },
  { key: "editableBy", kind: "select", options: EditableBy.options, optional: true },
  { key: "cite", kind: "cite", optional: true },
];
export const FIELD_BASE_KEYS = fieldBase.map((s) => s.key);
export const FIELD_BASE_SPECS = fieldBase;
export const FIELD_EXTRA: Record<(typeof FIELD_TYPES)[number], Spec[]> = {
  int: [
    { key: "min", kind: "int", optional: true },
    { key: "max", kind: "int", optional: true },
  ],
  text: [{ key: "maxLength", kind: "int", optional: true }],
  enum: [{ key: "values", kind: "csv" }],
  bool: [],
  ref: [{ key: "entity", kind: "text" }],
  list: [{ key: "maxItems", kind: "int", optional: true }],
};

export const RESOURCE_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "scope", kind: "select", options: ResourceScope.options },
  { key: "cite", kind: "cite", required: true, optional: true },
  { key: "min", kind: "expr", optional: true },
  { key: "max", kind: "expr", optional: true },
  { key: "capped", kind: "bool", defaultOn: true },
  { key: "visibility", kind: "select", options: Visibility.options, optional: true },
  { key: "editableBy", kind: "select", options: EditableBy.options, optional: true },
  { key: "entities", kind: "csv", optional: true },
];

export const CONDITION_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "cite", kind: "cite", required: true, optional: true },
  { key: "stacking", kind: "select", options: ConditionStacking.options, optional: true },
  { key: "maxStacks", kind: "int", optional: true },
  { key: "duration", kind: "select", options: ConditionDuration.options },
  { key: "visibility", kind: "select", options: Visibility.options, optional: true },
];

export const EFFECT_SPECS: Spec[] = [
  { key: "path", kind: "text" },
  { key: "mode", kind: "select", options: EffectMode.options },
  { key: "value", kind: "expr" },
  { key: "phase", kind: "select", options: EffectPhase.options, optional: true },
  { key: "priority", kind: "int", optional: true },
  { key: "when", kind: "expr", optional: true },
  { key: "cite", kind: "cite", optional: true },
];

export const TEST_KINDS = ["sumVsTarget", "poolSuccesses", "reported"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

const ties: Spec = { key: "ties", kind: "select", options: TieRule.options, optional: true };
const testCite: Spec = { key: "cite", kind: "cite", required: true, optional: true };
export const SUM_SPECS: Spec[] = [
  { key: "dice", kind: "expr" },
  { key: "modifier", kind: "expr", optional: true },
  { key: "target", kind: "expr" },
  ties,
  { key: "advantage", kind: "bool" },
  { key: "critOn", kind: "csv", numbers: true, optional: true },
  testCite,
];
export const DEGREES_SPECS: Spec[] = [
  { key: "step", kind: "int" },
  { key: "naturalShift", kind: "bool" },
  { key: "cite", kind: "cite", required: true, optional: true },
];
export const POOL_SPECS: Spec[] = [
  { key: "pool", kind: "expr" },
  { key: "modifier", kind: "expr", optional: true },
  { key: "die", kind: "int" },
  { key: "target", kind: "expr" },
  ties,
  { key: "shift", kind: "text", optional: true },
  testCite,
];
export const BAND_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "from", kind: "int" },
  { key: "to", kind: "int" },
  { key: "worth", kind: "int" },
];
export const OUTCOME_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "cite", kind: "cite", required: true, optional: true },
];
export const REPORTED_SPECS: Spec[] = [testCite];

export const GAME_MODES = GameMode.options;
export const GAME_SPECS: Spec[] = [
  { key: "title", kind: "text" },
  { key: "family", kind: "text", optional: true },
  { key: "genres", kind: "csv" },
  { key: "cite", kind: "cite", required: true, optional: true },
];

export const INITIATIVE_STRATEGIES = ["ranked", "seated"] as const;
export const RANKED_SPECS: Spec[] = [
  { key: "score", kind: "expr" },
  { key: "dice", kind: "expr", optional: true },
  { key: "rerollEachRound", kind: "bool" },
  { key: "cite", kind: "cite", required: true, optional: true },
];
export const SEATED_SPECS: Spec[] = [
  { key: "firstPlayer", kind: "select", options: ["fixed", "rotate", "manual"] },
  { key: "cite", kind: "cite", required: true, optional: true },
];

export const CREATION_KINDS = CreationKind.options;
export const STEP_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "actor", kind: "text" },
  { key: "label", kind: "text" },
  { key: "cite", kind: "cite", required: true, optional: true },
  { key: "optional", kind: "bool" },
];
export const STEP_EXTRA: Record<(typeof CREATION_KINDS)[number], Spec[]> = {
  choose: [
    { key: "pick", kind: "text" },
    { key: "count", kind: "int", optional: true },
  ],
  assign: [{ key: "fields", kind: "csv" }],
  fields: [{ key: "fields", kind: "csv" }],
};

export const PHASE_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "mode", kind: "select", options: ["turns", "simultaneous"] },
  { key: "cite", kind: "cite", required: true, optional: true },
];
export const SCORING_SPECS: Spec[] = [
  { key: "mode", kind: "select", options: ["compete", "coop"], optional: true },
  { key: "score", kind: "expr" },
  { key: "order", kind: "select", options: ["high", "low"], optional: true },
  { key: "cite", kind: "cite", required: true, optional: true },
];
export const END_SPECS: Spec[] = [
  { key: "when", kind: "expr" },
  { key: "outcome", kind: "select", options: ["win", "lose"], optional: true },
  { key: "cite", kind: "cite", required: true, optional: true },
];

export const OPTION_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "label", kind: "text" },
  { key: "cite", kind: "cite", required: true, optional: true },
  { key: "default", kind: "bool" },
];
export const DECISION_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "text", kind: "summary" },
  { key: "cite", kind: "cite", optional: true },
];

// ---- Packs ----

export const PACK_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "version", kind: "text" },
  { key: "license", kind: "select", options: PackLicense.options },
  { key: "attribution", kind: "text", optional: true },
];
export const PACK_TARGET_SPECS: Spec[] = [
  { key: "id", kind: "text" },
  { key: "range", kind: "text" },
];
export const ENTRY_SPECS: Spec[] = [
  { key: "key", kind: "text" },
  { key: "type", kind: "text" },
  { key: "name", kind: "text" },
  { key: "level", kind: "int", optional: true },
  { key: "tags", kind: "csv", optional: true },
  { key: "cite", kind: "cite", optional: true },
  { key: "visibility", kind: "select", options: EntryVisibility.options, optional: true },
];

/** How many problems the summary at the top lists before it stops; the rows list the rest. */
export const MAX_PROBLEMS_SHOWN = 60;
