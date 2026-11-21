import { campaignRecord } from "./codex.ts";
import { ExprError, type ExprRecord, type ExprScope, type ExprType, type ExprValue } from "./expr/expr.ast.ts";
import { compileExpr, evaluateBool, evaluateInt } from "./expr/expr.ts";
import { checkFieldValue } from "./field-value.ts";
import {
  MAX_CHAIN,
  MAX_GENERATED,
  type CodexField,
  type GeneratedEntry,
  type Generator,
  type GeneratorStep,
  type Ruleset,
} from "./manifest.ts";
import { own } from "./own.ts";
import type { Problem } from "./problem.ts";

// Generators (house decision #98): the GM runs the steps in the browser, every roll through `table.roll`, and confirms
// once; the server checks the run against the declaration with `checkRun` and makes what it plans. Pure, with a Go twin
// (apps/api-go internal/engine/generators.go) held equal by the vectors.

/** What an expression reads a step as: a roll its last line's id, a pick its key, a value itself. */
function stepType(s: GeneratorStep): ExprType {
  return s.kind === "number" ? "int" : "text";
}

/** The `entry` record a pick's filter reads: the entity's fields by id, typed as the field reads. */
function entryRecord(r: Ruleset, entity: string): ExprType {
  const record: Record<string, ExprType> = {};
  const fields = r.entities.find((e) => e.id === entity)?.fields ?? {};
  for (const [id, def] of Object.entries(fields)) {
    record[id] =
      def.type === "int" ? "int" : def.type === "bool" ? "bool" : def.type === "list" ? { list: "text" } : "text";
  }
  return { record };
}

/** The scope an expression of a step reads: the steps before it, the campaign, and for a pick's filter the entry. */
function scopeOf({ r, before, entity }: { r: Ruleset; before: readonly GeneratorStep[]; entity?: string }): ExprScope {
  const steps: Record<string, ExprType> = {};
  for (const s of before) steps[s.id] = stepType(s);
  return {
    steps: { record: steps },
    ...(r.campaignFields === undefined ? {} : { campaign: campaignRecord(r.campaignFields) }),
    ...(entity === undefined ? {} : { entry: entryRecord(r, entity) }),
  };
}

/** The expression problems of a generator: each `when` and `filter` a boolean, `each.times` an integer, over what is above. */
export function generatorExprProblems({ r, g, path }: { r: Ruleset; g: Generator; path: string }): Problem[] {
  const out: Problem[] = [];
  const check = (source: string, scope: ExprScope, expect: ExprType, at: string) => {
    const res = compileExpr({ source, scope, expect });
    if (!res.ok) out.push({ path: at, message: res.error });
  };
  const walk = (steps: readonly GeneratorStep[], above: readonly GeneratorStep[], at: string) =>
    steps.forEach((s, j) => {
      const before = [...above, ...steps.slice(0, j)];
      if (s.when !== undefined) check(s.when, scopeOf({ r, before }), "bool", `${at}[${j}].when`);
      if (s.kind === "pick" && s.filter !== undefined)
        check(s.filter, scopeOf({ r, before, entity: s.entity }), "bool", `${at}[${j}].filter`);
    });
  walk(g.steps, [], `${path}.steps`);
  if (g.each !== undefined) {
    check(g.each.times, scopeOf({ r, before: g.steps }), "int", `${path}.each.times`);
    walk(g.each.steps, g.steps, `${path}.each.steps`);
  }
  return out;
}

/** A step's answer in a run: a roll's lines (its table's, then each line's `next`), a pick's key, a set value. */
export type StepValue = { rows?: readonly string[]; key?: string; value?: number | string };
export type GeneratorRun = {
  values: Readonly<Record<string, StepValue>>;
  each: readonly Readonly<Record<string, StepValue>>[];
};
/** A served pack entry this seat reads, of the type asked for. */
export type ServedEntry = { key: string; name: string; body: Readonly<Record<string, unknown>> };
export type ServedLookup = (entity: string, key: string) => ServedEntry | undefined;

/** One entry the run makes: its title, the declared fields set from its steps, and the pack entry it is made from. */
export type PlannedEntry = {
  title: string;
  fields: Record<string, unknown>;
  from: { entity: string; key: string } | null;
};
export const GENERATE_REFUSALS = [
  "generateMissing",
  "generateRow",
  "generatePick",
  "generateValue",
  "generateCount",
] as const;
export type GenerateRefusal = (typeof GENERATE_REFUSALS)[number];
export type RunResult =
  | { ok: true; root: PlannedEntry; each: PlannedEntry[] }
  | { ok: false; code: GenerateRefusal; params: Record<string, string | number> };

/** A step as the run answered it. */
type Answered = { step: GeneratorStep; expr: ExprValue; text: string; key: string | null; value: number | null };

class Refused extends Error {
  readonly code: GenerateRefusal;
  readonly params: Record<string, string | number>;
  constructor(code: GenerateRefusal, params: Record<string, string | number>) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

/** Whether an expression holds; one that cannot be read (a step skipped) does not. */
function holds(source: string, scope: ExprScope, record: ExprRecord): boolean {
  const res = compileExpr({ source, scope, expect: "bool" });
  if (!res.ok) return false;
  try {
    return evaluateBool({ expr: res.expr, scope: record });
  } catch (e) {
    if (e instanceof ExprError) return false;
    throw e;
  }
}

/** A pack entry's body as an expression reads it: numbers, words, yes/no and lists of words. */
function bodyRecord(body: Readonly<Record<string, unknown>>): ExprRecord {
  const out: Record<string, ExprValue> = {};
  for (const [id, v] of Object.entries(body)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[id] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[id] = v;
  }
  return out;
}

/**
 * Reads one round of steps against the run (house decision #98): a step whose `when` does not hold is skipped; any
 * other needs its answer, of its kind, and a roll's lines must be lines of its table and of each line's `next`, a pick a
 * served entry of its type that meets its filter, a number within bounds, a choice one of its options, a text 1 to its
 * length after trimming.
 */
function answer({
  r,
  steps,
  above,
  given,
  served,
  campaign,
  answered,
}: {
  r: Ruleset;
  steps: readonly GeneratorStep[];
  above: readonly GeneratorStep[];
  given: Readonly<Record<string, StepValue>>;
  served: ServedLookup;
  campaign: Readonly<Record<string, string | number | boolean>>;
  answered: Map<string, Answered>;
}): void {
  steps.forEach((s, j) => {
    const before = [...above, ...steps.slice(0, j)];
    const record = (): ExprRecord => {
      const values: Record<string, ExprValue> = {};
      for (const [id, a] of answered) values[id] = a.expr;
      return { steps: values, campaign };
    };
    if (s.when !== undefined && !holds(s.when, scopeOf({ r, before }), record())) return;
    const v = Object.hasOwn(given, s.id) ? given[s.id] : undefined;
    const params = { step: s.label };
    switch (s.kind) {
      case "roll": {
        const rows = v?.rows;
        if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_CHAIN)
          throw new Refused("generateMissing", params);
        let table = own(r.tables ?? {}, s.table);
        let line = undefined as { id: string; label: string; next?: string } | undefined;
        for (const [i, id] of rows.entries()) {
          if (i > 0) table = line?.next === undefined ? undefined : own(r.tables ?? {}, line.next);
          line = table?.entries.find((e) => e.id === id);
          if (line === undefined) throw new Refused("generateRow", params);
        }
        answered.set(s.id, { step: s, expr: line!.id, text: line!.label, key: null, value: null });
        return;
      }
      case "pick": {
        if (typeof v?.key !== "string") throw new Refused("generateMissing", params);
        const e = served(s.entity, v.key);
        if (e === undefined) throw new Refused("generatePick", params);
        if (
          s.filter !== undefined &&
          !holds(s.filter, scopeOf({ r, before, entity: s.entity }), { ...record(), entry: bodyRecord(e.body) })
        )
          throw new Refused("generatePick", params);
        answered.set(s.id, { step: s, expr: e.key, text: e.name, key: e.key, value: null });
        return;
      }
      case "number": {
        const n = v?.value;
        if (typeof n !== "number") throw new Refused("generateMissing", params);
        if (!Number.isInteger(n) || n < s.min || n > s.max) throw new Refused("generateValue", params);
        answered.set(s.id, { step: s, expr: n, text: String(n), key: null, value: n });
        return;
      }
      case "choice": {
        const c = v?.value;
        if (typeof c !== "string") throw new Refused("generateMissing", params);
        if (!s.options.includes(c)) throw new Refused("generateValue", params);
        answered.set(s.id, { step: s, expr: c, text: own(s.labels ?? {}, c) ?? c, key: null, value: null });
        return;
      }
      case "text": {
        const t = v?.value;
        if (typeof t !== "string") throw new Refused("generateMissing", params);
        const trimmed = t.trim();
        if (trimmed === "" || [...trimmed].length > (s.maxLength ?? 200)) throw new Refused("generateValue", params);
        answered.set(s.id, { step: s, expr: trimmed, text: trimmed, key: null, value: null });
        return;
      }
    }
  });
}

/** What a step puts in a field of its kind: a pick's key in a ref, a number in an int, a choice's id in an enum, words in text. */
function fillOf(a: Answered, def: CodexField): unknown {
  switch (def.type) {
    case "ref":
      return a.key;
    case "int":
      return a.value;
    case "enum":
      return a.step.kind === "choice" ? a.expr : null;
    case "text":
      return a.text;
    default:
      return null;
  }
}

/** The entry one round makes: its title (the generator's label when its step was skipped), fields that fit, its source. */
function planned({
  r,
  g,
  made,
  answered,
}: {
  r: Ruleset;
  g: Generator;
  made: GeneratedEntry;
  answered: ReadonlyMap<string, Answered>;
}): PlannedEntry {
  const defs = r.codex?.kinds[g.make.kind]?.fields ?? {};
  const fields: Record<string, unknown> = {};
  for (const [id, step] of Object.entries(made.fields ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const a = answered.get(step);
    const def = own(defs, id);
    if (a === undefined || def === undefined) continue;
    const value = fillOf(a, def);
    if (value !== null && checkFieldValue({ def, value }) === null) fields[id] = value;
  }
  const from = made.from === undefined ? undefined : answered.get(made.from);
  const entity = from?.step.kind === "pick" ? from.step.entity : null;
  return {
    title: [...(answered.get(made.title)?.text ?? g.label)].slice(0, 200).join(""),
    fields,
    from: entity !== null && from?.key ? { entity, key: from.key } : null,
  };
}

/**
 * Checks a confirmed run against its generator (house decision #98) and plans what it makes: the root, and one entry
 * per round of `each`, whose count must be what `each.times` reads (0 to 60) over the steps above. Refuses the first
 * problem, naming the step by its label.
 */
export function checkRun({
  ruleset,
  generator: g,
  run,
  served,
  campaign = {},
}: {
  ruleset: Ruleset;
  generator: Generator;
  run: GeneratorRun;
  served: ServedLookup;
  campaign?: Readonly<Record<string, string | number | boolean>>;
}): RunResult {
  try {
    const top = new Map<string, Answered>();
    answer({ r: ruleset, steps: g.steps, above: [], given: run.values, served, campaign, answered: top });
    const root = planned({ r: ruleset, g, made: g.make, answered: top });
    if (g.each === undefined || g.make.each === undefined) {
      if (run.each.length > 0) throw new Refused("generateCount", { count: 0 });
      return { ok: true, root, each: [] };
    }
    const values: Record<string, ExprValue> = {};
    for (const [id, a] of top) values[id] = a.expr;
    let times = 0;
    const res = compileExpr({ source: g.each.times, scope: scopeOf({ r: ruleset, before: g.steps }), expect: "int" });
    if (res.ok) {
      try {
        times = evaluateInt({ expr: res.expr, scope: { steps: values, campaign } });
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
    if (times < 0 || times > MAX_GENERATED || run.each.length !== times)
      throw new Refused("generateCount", { count: Math.max(0, Math.min(times, MAX_GENERATED)) });
    const each = run.each.map((given) => {
      const answered = new Map(top);
      answer({ r: ruleset, steps: g.each!.steps, above: g.steps, given, served, campaign, answered });
      return planned({ r: ruleset, g, made: g.make.each!, answered });
    });
    return { ok: true, root, each };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, code: e.code, params: e.params };
    throw e;
  }
}
