import type { ExprRecord, ExprScope, ExprType, ExprValue } from "./expr/expr.ast.ts";
import { compileExpr, evaluateBool } from "./expr/expr.ts";
import type { CampaignField, CodexField, CodexKindDef, CodexReminder } from "./manifest.ts";

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
  return (kind.reminders ?? []).filter((r) => {
    const compiled = compileExpr({ source: r.if, scope, expect: "bool" });
    if (!compiled.ok) return false;
    try {
      return evaluateBool({ expr: compiled.expr, scope: record });
    } catch {
      return false;
    }
  });
}
