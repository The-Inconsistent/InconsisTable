import { z } from "zod";

import type { FieldValue } from "./derived.ts";
import { checkFieldValue, FieldValueInput } from "./field-value.ts";
import { FieldId, type CreationStep, type FieldDef, type Ruleset } from "./manifest.ts";
import type { PackEntry } from "./pack.ts";
import { own } from "./own.ts";
import type { Problem } from "./problem.ts";

/** What a builder sends, by step id: keys for `choose`, scores for `assign`, values for `fields`. */
export type CreationAnswers = Readonly<Record<string, unknown>>;

/** A pick to store as `actor_choice`. */
export interface CreationChoice {
  stepId: string;
  ordinal: number;
  optionKey: string;
}

export type CreationResult =
  { ok: true; fields: Record<string, FieldValue>; choices: CreationChoice[] } | { ok: false; problems: Problem[] };

const Keys = z.array(z.string().min(1).max(120)).max(20);
const Scores = z.record(FieldId, z.int());
type Scores = z.infer<typeof Scores>;
const Values = z.record(FieldId, FieldValueInput);

/** Entries a step may pick from. The caller scopes it to what the seat may see (a `gm` entry is not for players). */
export type EntryLookup = (args: { type: string; key: string }) => PackEntry | undefined;

function check({ def, value, path, out }: { def: FieldDef | undefined; value: unknown; path: string; out: Problem[] }) {
  if (def === undefined) return out.push({ path, message: "no such field" });
  const why = checkFieldValue({ def, value });
  if (why !== null) out.push({ path, message: why });
}

/** Scores handed out by a manifest table: each listed value goes to exactly one field. */
function checkTable({
  values,
  scores,
  path,
  out,
}: {
  values: readonly number[];
  scores: Scores;
  path: string;
  out: Problem[];
}) {
  const left = [...values];
  for (const [field, score] of Object.entries(scores)) {
    const at = left.indexOf(score);
    if (at < 0)
      out.push({ path: `${path}.${field}`, message: `${score} is not left in the table (${values.join(", ")})` });
    else left.splice(at, 1);
  }
}

function checkPointBuy({
  method,
  scores,
  path,
  out,
}: {
  method: Extract<CreationStep, { kind: "assign" }>["method"] & { kind: "pointBuy" };
  scores: Scores;
  path: string;
  out: Problem[];
}) {
  let spent = 0;
  for (const [field, score] of Object.entries(scores)) {
    const cost = own(method.costs, String(score));
    if (score < method.min || score > method.max || cost === undefined)
      out.push({ path: `${path}.${field}`, message: `${score} is outside ${method.min} to ${method.max}` });
    else spent += cost;
  }
  if (spent > method.budget) out.push({ path, message: `${spent} points spent, over the budget of ${method.budget}` });
}

/**
 * Runs the ruleset's `creation` for one actor entity against a builder's answers. The server runs it again before it
 * writes (the client's preview is only a preview). Checks every step, every pick against `lookup`, and every value
 * that lands on the actor against its `FieldDef`, then returns the fields to write and the choices to store.
 * Problem paths start at the step id: `scores.attr.str`.
 */
export function runCreation({
  ruleset,
  actor,
  answers,
  lookup,
}: {
  ruleset: Ruleset;
  actor: string;
  answers: CreationAnswers;
  lookup: EntryLookup;
}): CreationResult {
  const problems: Problem[] = [];
  const entity = ruleset.entities.find((e) => e.id === actor && e.base === "actor");
  if (entity === undefined)
    return { ok: false, problems: [{ path: "(root)", message: `"${actor}" is not an actor entity` }] };
  const steps = ruleset.creation.filter((s) => s.actor === actor);
  const fields: Record<string, FieldValue> = {};
  const choices: CreationChoice[] = [];

  for (const id of Object.keys(answers)) {
    if (!steps.some((s) => s.id === id)) problems.push({ path: id, message: "no such step" });
  }
  for (const step of steps) {
    const answer = own(answers, step.id);
    if (answer === undefined) {
      if (!step.optional) problems.push({ path: step.id, message: "this step needs an answer" });
      continue;
    }
    const put = (field: string, value: FieldValue, path: string) => {
      check({ def: own(entity.fields, field), value, path, out: problems });
      fields[field] = value;
    };
    if (step.kind === "choose") {
      const keys = Keys.safeParse(answer);
      if (!keys.success) {
        problems.push({ path: step.id, message: "expected a list of entry keys" });
        continue;
      }
      if (keys.data.length !== step.count)
        problems.push({ path: step.id, message: `pick ${step.count}, got ${keys.data.length}` });
      if (new Set(keys.data).size !== keys.data.length)
        problems.push({ path: step.id, message: "the same entry twice" });
      keys.data.forEach((key, ordinal) => {
        const entry = lookup({ type: step.pick, key });
        if (entry === undefined) {
          problems.push({ path: `${step.id}[${ordinal}]`, message: `no ${step.pick} "${key}"` });
          return;
        }
        choices.push({ stepId: step.id, ordinal, optionKey: key });
        for (const c of step.copy) {
          const value = own(entry.body, c.from);
          if (value !== undefined) put(c.to, value, `${step.id}.${c.to}`);
        }
      });
    } else if (step.kind === "assign") {
      const scores = Scores.safeParse(answer);
      if (!scores.success) {
        problems.push({ path: step.id, message: "expected a score for each field" });
        continue;
      }
      const missing = step.fields.filter((f) => own(scores.data, f) === undefined);
      const extra = Object.keys(scores.data).filter((f) => !step.fields.includes(f));
      for (const f of missing) problems.push({ path: `${step.id}.${f}`, message: "needs a score" });
      for (const f of extra) problems.push({ path: `${step.id}.${f}`, message: "not a field of this step" });
      const m = step.method;
      if (m.kind === "table") checkTable({ values: m.values, scores: scores.data, path: step.id, out: problems });
      else checkPointBuy({ method: m, scores: scores.data, path: step.id, out: problems });
      for (const f of step.fields) {
        const score = own(scores.data, f);
        if (score !== undefined) put(f, score, `${step.id}.${f}`);
      }
    } else {
      const values = Values.safeParse(answer);
      if (!values.success) {
        problems.push({ path: step.id, message: "expected a value for each field" });
        continue;
      }
      for (const f of Object.keys(values.data)) {
        if (!step.fields.includes(f)) problems.push({ path: `${step.id}.${f}`, message: "not a field of this step" });
      }
      for (const f of step.fields) {
        const value = own(values.data, f);
        if (value === undefined) problems.push({ path: `${step.id}.${f}`, message: "needs a value" });
        else put(f, value, `${step.id}.${f}`);
      }
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, fields, choices };
}
