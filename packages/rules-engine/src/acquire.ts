import { nestFields, type FieldValue } from "./derived.ts";
import { ExprError, type ExprRecord, type ExprValue } from "./expr/expr.ast.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { parseExpr } from "./expr/expr.parser.ts";
import { acquiredKinds, CARD_VALUES, HOST_PREFIX, itemKindOf, type Ruleset } from "./manifest.ts";
import { own } from "./own.ts";
import { isRefusal, refuse, type ActorState, type Refusal } from "./primitives/primitive.ts";

// House decision #102: acquiring an item by a Test. `planAcquire` reads the acquisition on the asking actor and one pack
// entry: the kind it is granted as, each of the Test's inputs as the sum of its labelled parts (the breakdown the phone
// shows), and what a pass grants. The api calls the Test with those inputs; the web shows the same answer.

/** The pack entry asked for, as the room serves it. */
export interface AcquireItem {
  type: string;
  key: string;
  name: string;
  tags: readonly string[];
  body: Readonly<Record<string, unknown>>;
}

/**
 * One of the Test's inputs: its total and the parts it adds up from, or a yes-or-no input's answer and its one part;
 * `label` the Test's word for it, absent when the ruleset gives none.
 */
export interface AcquireInput {
  total: number | boolean;
  parts: { label: string; value: number | boolean }[];
  label?: string;
}

export interface AcquirePlan {
  /** The item kind it is granted as. */
  kind: string;
  inputs: Record<string, AcquireInput>;
  /** The resource a failed roll may be topped up with, and the most it takes; null without one. */
  topUp: { resource: string; max: number } | null;
  /** How many of a counted kind it grants; null for a kind that is not counted. */
  quantity: number | null;
  /** The counted item the entry's `load` field names, and how many; null when it names none. */
  load: { key: string; quantity: number } | null;
}

function read(source: string, scope: ExprRecord, path: string): { v: ExprValue } | Refusal {
  try {
    return { v: evaluate({ node: parseExpr(source), scope }) };
  } catch (err) {
    if (err instanceof ExprError) return refuse("wrongState", `${path}: ${err.message}`);
    throw err;
  }
}

function readInt(source: string, scope: ExprRecord, path: string): number | Refusal {
  const r = read(source, scope, path);
  if (isRefusal(r)) return r;
  return typeof r.v === "number" ? r.v : refuse("wrongState", `${path}: not a number`);
}

const sorted = <T>(o: Readonly<Record<string, T>>): [string, T][] =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The entry's values as `item` reads them: its type's declared fields from its body (an unset list reads as empty),
 * and its tags.
 */
export function itemScope({
  ruleset,
  item,
}: {
  ruleset: Pick<Ruleset, "entities">;
  item: Pick<AcquireItem, "type" | "tags" | "body">;
}): ExprRecord {
  const fields = ruleset.entities.find((e) => e.id === item.type)?.fields ?? {};
  const values: Record<string, FieldValue> = {};
  for (const [id, def] of sorted(fields)) {
    const v = own(item.body, id);
    if (v !== undefined && v !== null) values[id] = v as FieldValue;
    else if (def.type === "list") values[id] = [];
  }
  return { ...nestFields(values), tags: [...item.tags] };
}

/**
 * What acquiring the entry asks of the actor's Test and what it grants, or why not: `noAcquire` (the ruleset declares
 * none), `itemNotAnItem` (the entry is of no kind), `acquireNotFor` (a kind it does not grant, or one the actor's type
 * does not hold), `badInput` (a pick missing, unknown or out of its range), `acquireNotNow` (`if` does not hold).
 */
export function planAcquire({
  ruleset,
  actor,
  item,
  picks,
}: {
  ruleset: Pick<Ruleset, "items" | "entities" | "tests">;
  actor: ActorState;
  item: AcquireItem;
  picks: Readonly<Record<string, unknown>>;
}): AcquirePlan | Refusal {
  const items = ruleset.items;
  const a = items?.acquire;
  if (items === undefined || a === undefined) return refuse("noAcquire", "no acquisition");
  const kind = itemKindOf({ items, entry: item });
  if (kind === undefined) return refuse("itemNotAnItem", `"${item.name}" is of no item kind`);
  if (!acquiredKinds(items, a).includes(kind) || actor.entity === undefined || !kind.entities.includes(actor.entity))
    return refuse("acquireNotFor", `"${item.name}" is not acquired by "${actor.id}"`);
  if (actor.scope === undefined) return refuse("wrongState", `"${actor.id}" has values that cannot be read yet`);
  const path = "items.acquire";
  const base: ExprRecord = { ...actor.scope, item: itemScope({ ruleset, item }) };
  const declared = a.picks ?? {};
  for (const name of Object.keys(picks).sort()) {
    if (!Object.hasOwn(declared, name)) return refuse("badInput", `"${name}" is not a pick`);
  }
  const picked: Record<string, number> = {};
  for (const [name, def] of sorted(declared)) {
    const max = readInt(def.max, { ...base, ctx: {} }, `${path}.picks.${name}.max`);
    if (typeof max !== "number") return max;
    const v = own(picks, name);
    if (typeof v !== "number" || !Number.isInteger(v) || v < def.min || v > max)
      return refuse("badInput", `"${name}" must be a whole number from ${def.min} to ${max}`);
    picked[name] = v;
  }
  const scope: ExprRecord = { ...base, ctx: picked };
  if (a.if !== undefined) {
    const r = read(a.if, scope, `${path}.if`);
    if (isRefusal(r)) return r;
    if (r.v !== true) return refuse("acquireNotNow", `"${item.name}" cannot be acquired now`);
  }
  const inputs: Record<string, AcquireInput> = {};
  const test = own(ruleset.tests, a.test);
  for (const [name, list] of sorted(a.inputs)) {
    const label = own(test?.inputLabels ?? {}, name);
    const at = (j: number) => `${path}.inputs.${name}[${j}].value`;
    if (own(test?.inputs ?? {}, name) === "bool") {
      // A yes-or-no input has one part (the validator holds it to one): its answer is the input's.
      const [p] = list;
      if (p === undefined) return refuse("wrongState", `${path}.inputs.${name}: no part`);
      const r = read(p.value, scope, at(0));
      if (isRefusal(r)) return r;
      if (typeof r.v !== "boolean") return refuse("wrongState", `${at(0)}: not a yes or no`);
      inputs[name] = { total: r.v, parts: [{ label: p.label, value: r.v }], ...(label === undefined ? {} : { label }) };
      continue;
    }
    const parts: { label: string; value: number }[] = [];
    for (const [j, p] of list.entries()) {
      const value = readInt(p.value, scope, at(j));
      if (typeof value !== "number") return value;
      parts.push({ label: p.label, value: value + 0 }); // a negated 0 reads as 0
    }
    inputs[name] = {
      total: parts.reduce((s, p) => s + p.value, 0),
      parts,
      ...(label === undefined ? {} : { label }),
    };
  }
  let topUp: AcquirePlan["topUp"] = null;
  if (a.topUp !== undefined) {
    const max = a.topUp.max === undefined ? 1000 : readInt(a.topUp.max, scope, `${path}.topUp.max`);
    if (typeof max !== "number") return max;
    topUp = { resource: a.topUp.resource, max: Math.max(0, max) };
  }
  let quantity: number | null = null;
  if (kind.stacks) {
    const q = a.quantity === undefined ? 1 : readInt(a.quantity, scope, `${path}.quantity`);
    if (typeof q !== "number") return q;
    quantity = Math.min(999, Math.max(1, q));
  }
  let load: AcquirePlan["load"] = null;
  const named = a.load === undefined || kind.stacks ? undefined : own(item.body, a.load.field);
  if (a.load !== undefined && typeof named === "string" && named !== "") {
    const q = readInt(a.load.quantity, scope, `${path}.load.quantity`);
    if (typeof q !== "number") return q;
    if (q > 0) load = { key: named, quantity: Math.min(999, q) };
  }
  return { kind: kind.id, inputs, topUp, quantity, load };
}

/** An effect as an item carries it to a seat: only its path, mode and value are read here. */
interface CarriedEffect {
  path: string;
  mode: string;
  value: string;
}

/**
 * A card's values with what the items fitted to its host change (house decision #102): each `host.<value>` effect,
 * added or overridden in the order the items are fitted, a value the card leaves out read as 0; `by` names the items
 * that changed one. An amount that cannot be read changes nothing.
 */
export function withFittings({
  values,
  fitted,
}: {
  values: Readonly<Record<string, number>>;
  fitted: readonly { name: string; effects: readonly CarriedEffect[] }[];
}): { values: Record<string, number>; by: string[] } {
  const out: Record<string, number> = { ...values };
  const by: string[] = [];
  for (const item of fitted) {
    let changed = false;
    for (const eff of item.effects) {
      if (!eff.path.startsWith(HOST_PREFIX)) continue;
      const name = eff.path.slice(HOST_PREFIX.length);
      const r = read(eff.value, {}, eff.path);
      if (isRefusal(r) || typeof r.v !== "number") continue;
      out[name] = eff.mode === "override" ? r.v : (out[name] ?? 0) + r.v;
      changed = true;
    }
    if (changed && !by.includes(item.name)) by.push(item.name);
  }
  return { values: out, by };
}

/** Every value a fitting may change on a card, whatever its kind: a weapon's numbers and an armour's rating. */
const CARD_NUMBERS = [...new Set(Object.values(CARD_VALUES).flat())];

/**
 * A card, or the means a strike reads, with what is fitted to it (house decision #102): `withFittings` over its card
 * numbers, a number the card prints as words (a rolled ED) left as printed and every other key kept. The sheet draws
 * it; the strike guide and the api's `strike.apply` read a held weapon's numbers through it, so they never disagree.
 */
export function withFittedCard({
  card,
  fitted,
}: {
  card: Readonly<Record<string, unknown>>;
  fitted: readonly { name: string; effects: readonly CarriedEffect[] }[];
}): { card: Record<string, unknown>; by: string[] } {
  const values: Record<string, number> = {};
  for (const k of CARD_NUMBERS) {
    const v = own(card, k);
    if (typeof v === "number") values[k] = v;
  }
  const out = withFittings({ values, fitted });
  const numbers = Object.entries(out.values).filter(([k]) => {
    const v = own(card, k);
    return v === undefined || typeof v === "number";
  });
  return { card: { ...card, ...Object.fromEntries(numbers) }, by: out.by };
}
