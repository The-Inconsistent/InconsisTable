import type { CompiledRuleset, CompiledTableEffect } from "./compile.ts";
import { ExprError, type ExprRecord, type ExprValue } from "./expr/expr.ast.ts";
import { evaluateBool, evaluateInt } from "./expr/expr.ts";
import { MAX_EFFECT_TIMES, tableDie, type Ruleset, type StrikeInput, type TableEntry } from "./manifest.ts";
import { own } from "./own.ts";

// Lookups (house decision #87): the GM types what the dice showed, the inputs and the target decide the total, the
// total reads one line, and the line's effects become steps the server applies through the ordinary operations. Pure:
// the tablet previews with it, the api decides with it.

/** One step of an applied line, worked out for the target: what the server runs, in order. */
export type LookupStep =
  | { kind: "harm"; wounds: number; shock: number }
  | { kind: "condition"; condition: string; immune: boolean }
  | { kind: "resource"; resource: string; by: number }
  | { kind: "pool"; pool: string; by: number }
  | { kind: "grant"; held: string; entry: string; has: boolean };

export type LookupRefusal =
  | { code: "tableNotFound" }
  | { code: "tableResultOut"; min: number; max: number }
  | { code: "tableInput"; input: string }
  | { code: "unreadable"; detail: string };

export type LookupPlan =
  { ok: true; total: number; entry: number; steps: LookupStep[] } | ({ ok: false } & LookupRefusal);

/**
 * The line a total reads: the one whose range holds it (an open-ended last line holds everything from its start);
 * otherwise the line with the highest start at or below it, so a total past the top reads the top line; a total below
 * every line reads the lowest one. -1 for a table without ranged lines.
 */
export function rowOf({ entries, total }: { entries: readonly TableEntry[]; total: number }): number {
  const start = (i: number) => entries[i]?.range?.[0] ?? 0;
  let holds = -1;
  let below = -1;
  let lowest = -1;
  entries.forEach((e, i) => {
    if (e.range === undefined) return;
    const lo = start(i);
    const hi = e.range[1] ?? Infinity;
    if (holds < 0 && total >= lo && total <= hi) holds = i;
    if (lo <= total && (below < 0 || lo > start(below))) below = i;
    if (lowest < 0 || lo < start(lowest)) lowest = i;
  });
  return holds >= 0 ? holds : below >= 0 ? below : lowest;
}

/**
 * The inputs as the lookup reads them: each declared one given or its default (a switch off, a stepper at its min or
 * 0). Refused when a given one is undeclared, of the wrong type, not whole or outside its bounds.
 */
export function lookupInputs({
  table,
  given,
}: {
  /** A lookup's table, or anything else that takes its inputs' shape (a strike, house decision #99). */
  table: { inputs?: readonly StrikeInput[] | undefined };
  given: Readonly<Record<string, unknown>>;
}): { ok: true; ctx: Record<string, number | boolean> } | { ok: false; input: string } {
  const ctx: Record<string, number | boolean> = {};
  const declared = table.inputs ?? [];
  for (const key of Object.keys(given).sort())
    if (!declared.some((x) => x.id === key)) return { ok: false, input: key };
  for (const x of declared) {
    const v = own(given, x.id);
    if (x.type === "bool") {
      if (v !== undefined && typeof v !== "boolean") return { ok: false, input: x.id };
      ctx[x.id] = v ?? false;
      continue;
    }
    // A choice (house decision #113) is one of its options' values, the first when none is given.
    if (x.type === "choice") {
      const n = v ?? x.options?.[0]?.value;
      if (!x.options?.some((o) => o.value === n)) return { ok: false, input: x.id };
      ctx[x.id] = n as number;
      continue;
    }
    const n = v ?? x.min ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n)) return { ok: false, input: x.id };
    if ((x.min !== undefined && n < x.min) || (x.max !== undefined && n > x.max)) return { ok: false, input: x.id };
    ctx[x.id] = n;
  }
  return { ok: true, ctx };
}

/** What a typed result reads on a table: the total (result plus modifier) and the line, before any effect is worked out. */
export function readLookup({
  compiled,
  tableId,
  result,
  inputs,
  scope,
}: {
  compiled: CompiledRuleset;
  tableId: string;
  result: number;
  inputs: Readonly<Record<string, unknown>>;
  /** The target's scope; null without a target, which a table with a modifier cannot be read without. */
  scope: ExprRecord | null;
}):
  { ok: true; total: number; entry: number; ctx: Record<string, number | boolean> } | ({ ok: false } & LookupRefusal) {
  const table = own(compiled.ruleset.tables ?? {}, tableId);
  const lookup = own(compiled.lookups, tableId);
  const die = table?.die === undefined ? null : tableDie(table.die);
  if (table === undefined || lookup === undefined || die === null) return { ok: false, code: "tableNotFound" };
  if (!Number.isInteger(result) || !die.has(result))
    return { ok: false, code: "tableResultOut", min: die.min, max: die.max };
  const read = lookupInputs({ table, given: inputs });
  if (!read.ok) return { ok: false, code: "tableInput", input: read.input };
  let total = result;
  if (lookup.modifier !== null) {
    if (scope === null) return { ok: false, code: "unreadable", detail: "the modifier reads a target" };
    try {
      total += evaluateInt({
        expr: lookup.modifier,
        scope: { ...withLists({ ruleset: compiled.ruleset, scope }), ctx: read.ctx },
      });
    } catch (e) {
      if (e instanceof ExprError) return { ok: false, code: "unreadable", detail: e.message };
      throw e;
    }
  }
  return { ok: true, total, entry: rowOf({ entries: table.entries, total }), ctx: read.ctx };
}

/**
 * A typed result applied to a target: the line it reads and that line's effects as steps, in the line's order, each
 * repeated `times` and left out when its `when` does not hold or its amounts are all 0. A condition the target is
 * immune to stays a step marked `immune`, which the server skips and says so.
 */
export function planLookup(args: {
  compiled: CompiledRuleset;
  tableId: string;
  result: number;
  inputs: Readonly<Record<string, unknown>>;
  scope: ExprRecord;
}): LookupPlan {
  const read = readLookup(args);
  if (!read.ok) return read;
  const { compiled, tableId, scope } = args;
  const effects = own(compiled.lookups, tableId)?.effects[read.entry] ?? [];
  const full = { ...withLists({ ruleset: compiled.ruleset, scope }), ctx: read.ctx };
  const steps: LookupStep[] = [];
  try {
    for (const x of effects) {
      if (x.when !== null && !evaluateBool({ expr: x.when, scope: full })) continue;
      const times =
        x.times === null ? 1 : Math.max(0, Math.min(MAX_EFFECT_TIMES, evaluateInt({ expr: x.times, scope: full })));
      const step = stepOf({ x, scope: full, compiled, target: scope });
      if (step === null) continue;
      for (let n = 0; n < times; n++) steps.push(step);
    }
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, code: "unreadable", detail: e.message };
    throw e;
  }
  return { ok: true, total: read.total, entry: read.entry, steps };
}

/** One effect worked out once; null when its amounts are all 0. Immunity reads the target without the inputs. */
function stepOf({
  x,
  scope,
  compiled,
  target,
}: {
  x: CompiledTableEffect;
  scope: ExprRecord;
  compiled: CompiledRuleset;
  target: ExprRecord;
}): LookupStep | null {
  const int = (e: CompiledTableEffect["by"]) => (e === null ? 0 : evaluateInt({ expr: e, scope }));
  const d = x.def;
  switch (d.kind) {
    case "harm": {
      const wounds = int(x.wounds);
      const shock = int(x.shock);
      return wounds === 0 && shock === 0 ? null : { kind: "harm", wounds, shock };
    }
    case "condition":
      return {
        kind: "condition",
        condition: d.condition,
        immune: immuneTo({ compiled, condition: d.condition, scope: target }),
      };
    case "resource": {
      const by = int(x.by);
      return by === 0 ? null : { kind: "resource", resource: d.resource, by };
    }
    case "pool": {
      const by = int(x.by);
      return by === 0 ? null : { kind: "pool", pool: d.pool, by };
    }
    case "grant":
      return {
        kind: "grant",
        held: d.held,
        entry: d.entry,
        has: heldKeys({ compiled, held: d.held, scope: target }).includes(d.entry),
      };
  }
}

/**
 * The scope with every list field an actor type declares read as empty where it is unset (house decisions #88, #91), as
 * the derived pass reads its own type's: an actor that holds nothing yet counts 0 records, as it holds none. A scope
 * does not say its type, so another type's list reads as empty too; an expression compiled for a type reads only its
 * own fields.
 */
export function withLists({ ruleset, scope }: { ruleset: Pick<Ruleset, "entities">; scope: ExprRecord }): ExprRecord {
  let out = scope;
  for (const e of ruleset.entities) {
    if (e.base !== "actor") continue;
    for (const [id, def] of Object.entries(e.fields))
      if (def.type === "list") out = setIfAbsent({ at: out, path: id.split(".") });
  }
  return out;
}

function setIfAbsent({ at, path }: { at: ExprRecord; path: readonly string[] }): ExprRecord {
  const [head = "", ...rest] = path;
  const had = own(at, head);
  if (rest.length === 0) return had === undefined ? { ...at, [head]: [] } : at;
  if (had !== undefined && !isRecord(had)) return at;
  return { ...at, [head]: setIfAbsent({ at: had ?? {}, path: rest }) };
}

/** The keys of the records of a kind the actor holds, read from the kind's list field in its scope (house decision #88). */
export function heldKeys({
  compiled,
  held,
  scope,
}: {
  compiled: CompiledRuleset;
  held: string;
  scope: ExprRecord;
}): string[] {
  const field = own(compiled.ruleset.held ?? {}, held)?.field;
  let at: ExprValue | null | undefined = scope;
  for (const part of (field ?? "").split(".")) {
    at = isRecord(at) ? own(at, part) : undefined;
  }
  return Array.isArray(at) ? at.filter((k): k is string => typeof k === "string") : [];
}

function isRecord(v: ExprValue | null | undefined): v is ExprRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Whether the actor is immune to the condition (house decision #81); a value it cannot read makes it not immune. */
export function immuneTo({
  compiled,
  condition,
  scope,
}: {
  compiled: CompiledRuleset;
  condition: string;
  scope: ExprRecord;
}): boolean {
  const expr = own(compiled.immune, condition);
  if (expr === undefined) return false;
  try {
    return evaluateBool({ expr, scope });
  } catch (e) {
    if (e instanceof ExprError) return false;
    throw e;
  }
}
