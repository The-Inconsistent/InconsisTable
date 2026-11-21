import type { BreakdownLine } from "./breakdown.ts";
import { ExprError, type ExprRecord, type ExprValue } from "./expr/expr.ast.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { parseExpr } from "./expr/expr.parser.ts";
import { lookupInputs, withLists } from "./lookups.ts";
import { strikeTargets, type Ruleset, type StrikeFigure } from "./manifest.ts";
import { own } from "./own.ts";
import { isRefusal, refuse, type Refusal } from "./primitives/primitive.ts";

// House decision #99: a strike's guide. The app never rolls and never decides a hit: `planStrike` works out the pool,
// the number to beat and the soak with their lines, and, for a total the table typed, the outcome and the hit it
// applies through `health.harm`. The GM's tablet previews with it; the api checks an apply with its Go twin. Both read
// the manifest's own text, as spends do.

/** A number the guide shows, and the lines it is made of (the derived-value breakdown's shape). */
export interface StrikeFigureRead {
  total: number;
  lines: BreakdownLine[];
}

export interface StrikePlan {
  pool: StrikeFigureRead;
  beat: StrikeFigureRead;
  /** Null for a strike without a soak. */
  soak: StrikeFigureRead | null;
  /** The first outcome whose `when` holds for the typed total; null without a total or when none holds. */
  outcome: { id: string; label: string; cite: string | null } | null;
  /** The hit the outcome applies; null when it applies none. */
  harm: { wounds: number; shock: number } | null;
  /** The notes whose `when` holds, in order (a note reads a total of 0 and no outcome before one is typed). */
  notes: { text: string; cite: string | null }[];
}

/** One side of a strike: its actor type and its expression scope. */
export interface StrikeSide {
  entity: string;
  scope: ExprRecord;
}

/** The lowest and highest total the guide takes. */
export const STRIKE_TOTAL_MIN = -1000;
export const STRIKE_TOTAL_MAX = 1000;

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

function readBool(source: string, scope: ExprRecord, path: string): boolean | Refusal {
  const r = read(source, scope, path);
  if (isRefusal(r)) return r;
  return typeof r.v === "boolean" ? r.v : refuse("wrongState", `${path}: not a boolean`);
}

/** A figure: its base line, then each addition whose `when` holds and whose amount is not 0. */
function figureOf(f: StrikeFigure, scope: ExprRecord, path: string): StrikeFigureRead | Refusal {
  const base = readInt(f.expr, scope, `${path}.expr`);
  if (typeof base !== "number") return base;
  const lines: BreakdownLine[] = [{ source: f.label, amount: base, cite: f.cite ?? null }];
  for (const [j, a] of (f.adds ?? []).entries()) {
    if (a.when !== undefined) {
      const holds = readBool(a.when, scope, `${path}.adds[${j}].when`);
      if (typeof holds !== "boolean") return holds;
      if (!holds) continue;
    }
    const by = readInt(a.by, scope, `${path}.adds[${j}].by`);
    if (typeof by !== "number") return by;
    if (by !== 0) lines.push({ source: a.label, amount: by, cite: a.cite ?? null });
  }
  return { total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
}

/** A mob's members standing (house decision #66), read from the scope; 0 for anyone who is not a mob. */
function membersOf(ruleset: Pick<Ruleset, "health">, scope: ExprRecord): number {
  const id = ruleset.health.harm?.mob?.members;
  const res = own(scope, "res");
  if (id === undefined || typeof res !== "object" || res === null || Array.isArray(res)) return 0;
  const v = own(res as ExprRecord, id);
  return typeof v === "number" ? v : 0;
}

/** What the strike reads of a means: each declared value's key, 0 or false where the means has none of that type. */
export function meansValues({
  values,
  means,
}: {
  values: Readonly<Record<string, { key: string; type: "int" | "bool" }>>;
  means: Readonly<Record<string, unknown>>;
}): ExprRecord {
  const out: Record<string, ExprValue> = {};
  for (const [id, v] of Object.entries(values)) {
    const x = own(means, v.key);
    out[id] =
      v.type === "bool" ? (typeof x === "boolean" ? x : false) : typeof x === "number" && Number.isInteger(x) ? x : 0;
  }
  return out;
}

/**
 * What a strike gives now, or why not: `noSuchStrike` (none by that id), `strikeNotFor` (an attacker or a target of a
 * type it is not for), `noMeans` (a means missing where the strike takes one, or given where it takes none),
 * `badInput` (an input undeclared, of the wrong type or out of its bounds; a total that is not whole or out of range),
 * `wrongState` (an expression the sides' values cannot answer).
 */
export function planStrike({
  ruleset,
  strikeId,
  attacker,
  target,
  means,
  inputs,
  total,
}: {
  ruleset: Pick<Ruleset, "strikes" | "entities" | "health">;
  strikeId: string;
  attacker: StrikeSide;
  target: StrikeSide;
  /** The picked means as it stands (a sheet line, a pack entry's values); null for none. */
  means: Readonly<Record<string, unknown>> | null;
  inputs: Readonly<Record<string, unknown>>;
  /** The total the table typed; null before one is. */
  total: number | null;
}): StrikePlan | Refusal {
  const strikes = ruleset.strikes ?? [];
  const at = strikes.findIndex((s) => s.id === strikeId);
  const s = strikes[at];
  if (s === undefined) return refuse("noSuchStrike", `no strike "${strikeId}"`);
  const path = `strikes[${at}]`;
  if (s.entities !== undefined && !s.entities.includes(attacker.entity))
    return refuse("strikeNotFor", `"${attacker.entity}" cannot strike with "${strikeId}"`);
  if (!strikeTargets(ruleset, s).includes(target.entity))
    return refuse("strikeNotFor", `"${target.entity}" is not a target of "${strikeId}"`);
  if (s.means !== undefined && means === null) return refuse("noMeans", `"${strikeId}" needs a means`);
  if (s.means === undefined && means !== null) return refuse("noMeans", `"${strikeId}" takes no means`);
  const picked = lookupInputs({ table: { inputs: s.inputs }, given: inputs });
  if (!picked.ok) return refuse("badInput", `bad input "${picked.input}"`);
  if (total !== null && (!Number.isInteger(total) || total < STRIKE_TOTAL_MIN || total > STRIKE_TOTAL_MAX))
    return refuse("badInput", `the total must be a whole number from ${STRIKE_TOTAL_MIN} to ${STRIKE_TOTAL_MAX}`);
  const ctx: ExprRecord = {
    ...picked.ctx,
    means: means === null ? {} : meansValues({ values: s.values ?? {}, means }),
    target: withLists({ ruleset, scope: target.scope }),
    attackerMob: membersOf(ruleset, attacker.scope),
    targetMob: membersOf(ruleset, target.scope),
  };
  const own_ = withLists({ ruleset, scope: attacker.scope });
  const scope = (extra: ExprRecord): ExprRecord => ({ ...own_, ctx: { ...ctx, ...extra } });
  const figures = scope({});
  const pool = figureOf(s.pool, figures, `${path}.pool`);
  if (isRefusal(pool)) return pool;
  const beat = figureOf(s.beat, figures, `${path}.beat`);
  if (isRefusal(beat)) return beat;
  const soak = s.soak === undefined ? null : figureOf(s.soak, figures, `${path}.soak`);
  if (soak !== null && isRefusal(soak)) return soak;
  const typed = scope({
    pool: pool.total,
    beat: beat.total,
    ...(soak === null ? {} : { soak: soak.total }),
    total: total ?? 0,
  });
  let outcome: StrikePlan["outcome"] = null;
  let harm: StrikePlan["harm"] = null;
  if (total !== null) {
    for (const [j, o] of s.outcomes.entries()) {
      const holds = readBool(o.when, typed, `${path}.outcomes[${j}].when`);
      if (typeof holds !== "boolean") return holds;
      if (!holds) continue;
      const amount = (source: string | undefined, key: string) =>
        source === undefined ? 0 : readInt(source, typed, `${path}.outcomes[${j}].${key}`);
      const wounds = amount(o.wounds, "wounds");
      if (typeof wounds !== "number") return wounds;
      const shock = amount(o.shock, "shock");
      if (typeof shock !== "number") return shock;
      outcome = { id: o.id, label: o.label, cite: o.cite ?? null };
      harm = wounds === 0 && shock === 0 ? null : { wounds, shock };
      break;
    }
  }
  const after = { ...typed, ctx: { ...(typed.ctx as ExprRecord), outcome: outcome?.id ?? "" } };
  const notes: StrikePlan["notes"] = [];
  for (const [j, n] of (s.notes ?? []).entries()) {
    if (n.when !== undefined) {
      const holds = readBool(n.when, after, `${path}.notes[${j}].when`);
      if (typeof holds !== "boolean") return holds;
      if (!holds) continue;
    }
    notes.push({ text: n.text, cite: n.cite ?? null });
  }
  return { pool, beat, soak, outcome, harm, notes };
}
