import {
  campaignValues,
  compileRuleset,
  deriveValues,
  PackEntry,
  runCreation,
  type CreationStep,
  type EntityType,
  type FieldValue,
  type Problem,
  type Ruleset,
} from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";

// The builder's pure side: what the answers make so far, which step each problem belongs to, and the budgets the
// score steps show. The client's numbers are a preview; the server runs the creation again and decides (CLAUDE.md).

export type Answers = Record<string, unknown>;
export type AssignStep = Extract<CreationStep, { kind: "assign" }>;

/** The server's refusal text (`actor.build`): a first line, then one `path: message` line per problem. */
export function parseProblems(error: string): Problem[] {
  return error
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const at = line.indexOf(": ");
      return at > 0 ? [{ path: line.slice(0, at), message: line.slice(at + 2) }] : [];
    });
}

/** `scores.attr.str` and `lineage[0]` both belong to the step before the first `.` or `[`. */
export const stepOfPath = (path: string) => path.split(/[.[]/)[0] ?? path;

export function problemsByStep(problems: readonly Problem[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of problems) {
    const step = stepOfPath(p.path);
    const detail = p.path === step ? p.message : `${p.path.slice(step.length).replace(/^\./, "")}: ${p.message}`;
    (out[step] ??= []).push(detail);
  }
  return out;
}

/** A character no builder has filled in yet: no ruleset type, or no values of its own. */
export const needsBuild = (a: { entity: string; fields: Readonly<Record<string, unknown>> }) =>
  a.entity === "" || Object.keys(a.fields).length === 0;

/** The steps that build one entity, in the ruleset's order. */
export const stepsFor = ({ ruleset, entity }: { ruleset: Ruleset; entity: string }) =>
  ruleset.creation.filter((s) => s.actor === entity);

/** The entity a character is built as: its own, else the only one the creation builds (the server's rule). */
export function entityFor({ ruleset, entityType }: { ruleset: Ruleset; entityType: string }): string | null {
  if (entityType !== "") return entityType;
  const types = [...new Set(ruleset.creation.map((s) => s.actor))];
  return types.length === 1 ? (types[0] ?? null) : null;
}

/** Points a point-buy has spent (a score the table doesn't price counts as nothing; the server refuses it). */
export function pointsSpent({ method, scores }: { method: PointBuy; scores: Readonly<Record<string, number>> }) {
  return Object.values(scores).reduce((sum, s) => sum + (method.costs[String(s)] ?? 0), 0);
}
type PointBuy = Extract<AssignStep["method"], { kind: "pointBuy" }>;

/** The table's values not handed out yet, each value once per time it is listed. */
export function tableLeft({ values, scores }: { values: readonly number[]; scores: Readonly<Record<string, number>> }) {
  const left = [...values];
  for (const s of Object.values(scores)) {
    const at = left.indexOf(s);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

/** Whether `field` may go one step up or down in a point buy without leaving the range or the budget. */
export function canStep({
  method,
  scores,
  field,
  by,
}: {
  method: PointBuy;
  scores: Readonly<Record<string, number>>;
  field: string;
  by: 1 | -1;
}) {
  const now = scores[field] ?? method.min;
  const next = now + by;
  if (next < method.min || next > method.max || method.costs[String(next)] === undefined) return false;
  return pointsSpent({ method, scores: { ...scores, [field]: next } }) <= method.budget;
}

/** One line to read a pack entry by: the first text value of its body that the entity declares. */
export function summaryOf({ entry, def }: { entry: RulesEntry; def: EntityType | undefined }): string {
  for (const [id, value] of Object.entries(entry.body)) {
    if (typeof value === "string" && def?.fields[id]?.type === "text") return value.slice(0, 160);
  }
  return entry.tags.join(", ");
}

export interface Preview {
  problems: Problem[];
  fields: Record<string, FieldValue> | null;
  derived: { id: string; label: string; value: number }[];
}

/**
 * What the answers make: the creation run on this device (the same engine the server runs), then the entity's derived
 * values. A manifest the seat sees only in part compiles (house decision #101); one that does not shows no numbers,
 * never wrong ones.
 */
export function previewBuild({
  ruleset,
  entity,
  answers,
  entries,
  campaign = {},
}: {
  ruleset: Ruleset;
  entity: string;
  answers: Answers;
  entries: readonly RulesEntry[];
  /** The room's stored campaign values; a value it has not set reads as the ruleset's default. */
  campaign?: Record<string, unknown>;
}): Preview {
  const lookup = ({ type, key }: { type: string; key: string }) => {
    const e = entries.find((x) => x.type === type && x.key === key);
    if (!e) return undefined;
    const parsed = PackEntry.safeParse({
      ...e,
      level: e.level ?? undefined,
      cite: e.cite ?? undefined,
    });
    return parsed.success ? parsed.data : undefined;
  };
  const made = runCreation({ ruleset, actor: entity, answers, lookup });
  if (!made.ok) return { problems: made.problems, fields: null, derived: [] };
  const compiled = compileRuleset(ruleset);
  const def = ruleset.entities.find((e) => e.id === entity);
  if (!compiled.ok || !def) return { problems: [], fields: made.fields, derived: [] };
  try {
    const values = deriveValues({
      compiled: compiled.compiled,
      entity,
      values: {
        fields: made.fields,
        resources: {},
        conditions: [],
        party: { characters: 1 },
        campaign: campaignValues({ compiled: compiled.compiled, stored: campaign }),
      },
    });
    return {
      problems: [],
      fields: made.fields,
      derived: def.derived.flatMap((d) =>
        d.id in values ? [{ id: d.id, label: d.label, value: values[d.id] ?? 0 }] : [],
      ),
    };
  } catch {
    // A value the formulas need is not set by the creation (the GM sets it on the sheet): no preview, not a wrong one.
    return { problems: [], fields: made.fields, derived: [] };
  }
}
