import type { ExprRecord, ExprScope, ExprType, ExprValue } from "./expr/expr.ast.ts";
import { compileExpr, evaluateBool } from "./expr/expr.ts";
import type { CodexField, CodexKindDef, CodexReminder } from "./manifest.ts";

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

/**
 * The scope a codex reminder's `if` reads (house decision #89): `fields`, a record of the kind's fields. A seat that
 * does not read a `gm` field is given the scope without it, so a reminder that reads one does not compile for it.
 */
export function codexScope({ fields, party }: { fields: Readonly<Record<string, CodexField>>; party?: boolean }) {
  const record: Record<string, ExprType> = {};
  for (const [id, def] of Object.entries(fields)) {
    const t = fieldType(def);
    if (t !== null && (party !== true || def.visibility === "party")) record[id] = t;
  }
  const scope: ExprScope = { fields: { record } };
  return scope;
}

/** Whether a seat that reads only `party` fields may be shown the reminder: its `if` reads none of the `gm` ones. */
export function partyReadsReminder({ kind, reminder }: { kind: CodexKindDef; reminder: CodexReminder }): boolean {
  return compileExpr({ source: reminder.if, scope: codexScope({ fields: kind.fields, party: true }) }).ok;
}

/**
 * The reminders an entry's values meet, in the declaration's order (house decision #89). A value the `if` cannot read
 * (unset, or not sent to this seat) meets nothing.
 */
export function codexReminders({
  kind,
  fields,
}: {
  kind: CodexKindDef | undefined;
  fields: Readonly<Record<string, unknown>>;
}): CodexReminder[] {
  if (kind === undefined) return [];
  const scope = codexScope({ fields: kind.fields });
  const values: Record<string, ExprValue> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!Object.hasOwn(kind.fields, id)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[id] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) values[id] = value;
  }
  const record: ExprRecord = { fields: values };
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
