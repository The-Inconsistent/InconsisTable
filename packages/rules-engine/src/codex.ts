import { ExprError, type ExprRecord, type ExprScope, type ExprType, type ExprValue } from "./expr/expr.ast.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { parseExpr } from "./expr/expr.parser.ts";
import { compileExpr, evaluateBool } from "./expr/expr.ts";
import type { CampaignField, CodexField, CodexKindDef, CodexReminder, RowColumn } from "./manifest.ts";

/** What an expression reads a codex field as (house decision #89); a `rows` field is not read. */
function fieldType(def: CodexField): ExprType | null {
  switch (def.type) {
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "tags":
      return { list: "text" };
    case "rows":
      return null;
    default:
      return "text";
  }
}

/** The `campaign` root: one member per declared campaign field, typed as the field reads. */
export function campaignRecord(defs: Readonly<Record<string, CampaignField>>): ExprType {
  const type = { int: "int", enum: "text", bool: "bool" } as const;
  return { record: Object.fromEntries(Object.entries(defs).map(([id, def]) => [id, type[def.type]])) };
}

type CampaignDefs = Readonly<Record<string, CampaignField>> | undefined;

/**
 * The scope a codex reminder's `if` reads (house decision #89): `fields`, a record of the kind's fields, and `campaign`,
 * the campaign fields every seat reads (house decision #97). A seat that does not read a `gm` field is given the scope
 * without it, so a reminder that reads one does not compile for it.
 */
export function codexScope({
  fields,
  party,
  campaign,
}: {
  fields: Readonly<Record<string, CodexField>>;
  party?: boolean;
  campaign?: CampaignDefs;
}) {
  const record: Record<string, ExprType> = {};
  for (const [id, def] of Object.entries(fields)) {
    const t = fieldType(def);
    if (t !== null && (party !== true || def.visibility === "party")) record[id] = t;
  }
  const scope: ExprScope = {
    fields: { record },
    ...(campaign === undefined ? {} : { campaign: campaignRecord(campaign) }),
  };
  return scope;
}

/** Whether a seat that reads only `party` fields may be shown the reminder: its `if` reads none of the `gm` ones. */
export function partyReadsReminder({
  kind,
  reminder,
  campaign,
}: {
  kind: CodexKindDef;
  reminder: CodexReminder;
  campaign?: CampaignDefs;
}): boolean {
  return compileExpr({ source: reminder.if, scope: codexScope({ fields: kind.fields, party: true, campaign }) }).ok;
}

/**
 * The reminders an entry's values meet, in the declaration's order (house decision #89), reading the campaign fields'
 * values in play as `campaign` (house decision #97). A value the `if` cannot read (unset, or not sent to this seat)
 * meets nothing.
 */
export function codexReminders({
  kind,
  fields,
  campaignFields,
  campaign = {},
}: {
  kind: CodexKindDef | undefined;
  fields: Readonly<Record<string, unknown>>;
  campaignFields?: CampaignDefs;
  campaign?: Readonly<Record<string, string | number | boolean>>;
}): CodexReminder[] {
  if (kind === undefined) return [];
  const scope = codexScope({ fields: kind.fields, campaign: campaignFields });
  const values: Record<string, ExprValue> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!Object.hasOwn(kind.fields, id)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[id] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) values[id] = value;
  }
  const record: ExprRecord = { fields: values, campaign };
  const shown = new Set<string>();
  return (kind.reminders ?? []).filter((r) => {
    if (r.group !== undefined && shown.has(r.group)) return false;
    const compiled = compileExpr({ source: r.if, scope, expect: "bool" });
    if (!compiled.ok) return false;
    try {
      const holds = evaluateBool({ expr: compiled.expr, scope: record });
      if (holds && r.group !== undefined) shown.add(r.group);
      return holds;
    } catch {
      return false;
    }
  });
}

/**
 * The reminders a seat that reads only `party` fields is sent: those whose `if` reads none of the others, and in a group
 * none after one it is not sent, since whether a later one shows says whether that one held (house decision #172).
 */
export function partyReminders({ kind, campaign }: { kind: CodexKindDef; campaign?: CampaignDefs }): CodexReminder[] {
  const cut = new Set<string>();
  return (kind.reminders ?? []).filter((reminder) => {
    if (reminder.group !== undefined && cut.has(reminder.group)) return false;
    if (partyReadsReminder({ kind, reminder, campaign })) return true;
    if (reminder.group !== undefined) cut.add(reminder.group);
    return false;
  });
}

/** A Test input's value: a number, a word or a yes/no. */
export type RowTestValue = number | string | boolean;

/**
 * The Test chips a `test` cell shows (house decision #173): the column's worked-out inputs (each read over `campaign`
 * and the row's `values`; one that cannot be read is left for the GM) under the cell's own, then one set of inputs per
 * word the cell lists for the column's `each` input, or the one set when it lists none.
 */
export function rowTests({
  col,
  inputs,
  values,
  campaign = {},
}: {
  col: Extract<RowColumn, { type: "test" }>;
  inputs: Readonly<Record<string, unknown>>;
  values: Readonly<Record<string, unknown>>;
  campaign?: Readonly<Record<string, unknown>>;
}): Record<string, RowTestValue>[] {
  const out: Record<string, RowTestValue> = {};
  const scope = { campaign: campaign as ExprRecord, values: values as ExprRecord };
  for (const [k, source] of Object.entries(col.inputs ?? {})) {
    try {
      const v = evaluate({ node: parseExpr(source), scope });
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
    }
  }
  const words: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (k === col.each && Array.isArray(v)) words.push(...v.filter((w): w is string => typeof w === "string"));
  }
  const each = col.each;
  return each === undefined || words.length === 0 ? [out] : words.map((w) => ({ ...out, [each]: w }));
}

/**
 * The words an `enum` column offers for a row (house decision #173): with `offer`, those of its values the row's entry
 * lists in that field (its body read where this seat holds it); all of them otherwise, or when nothing is listed.
 */
export function offeredValues({
  col,
  body,
}: {
  col: Extract<RowColumn, { type: "enum" }>;
  body: Readonly<Record<string, unknown>> | undefined;
}): string[] {
  const v = col.offer === undefined || body === undefined ? undefined : body[col.offer];
  const listed = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const offered = col.values.filter((x) => listed.includes(x));
  return offered.length > 0 ? offered : col.values;
}
