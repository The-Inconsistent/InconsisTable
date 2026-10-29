import {
  strictestVisibility,
  VISIBILITY_RANK,
  type EffectMode,
  type EffectPhase,
  type ResetEvent,
  type Visibility,
} from "./enums.ts";
import type { ExprScope, ExprType } from "./expr/expr.ast.ts";
import { compileExpr, type CompiledExpr } from "./expr/expr.ts";
import {
  validateRuleset,
  type Condition,
  type EntityType,
  type FieldDef,
  type RankedInitiative,
  type SeatedInitiative,
  type Resource,
  type Ruleset,
  type Scoring,
  type DiceMechanic,
} from "./manifest.ts";
import { own } from "./own.ts";
import type { Problem } from "./problem.ts";

export interface CompiledDerived {
  id: string;
  label: string;
  expr: CompiledExpr;
  /** Declared visibility, checked to be no looser than its inputs. */
  visibility: Visibility;
  /** Derived ids it reads. */
  deps: string[];
}

export interface CompiledEffect {
  conditionId: string;
  phase: EffectPhase;
  mode: EffectMode;
  /** Field id (phase base) or derived id (phase derived). */
  target: string;
  priority: number;
  value: CompiledExpr;
  when: CompiledExpr | null;
}

export interface CompiledEntity {
  def: EntityType;
  /** Entity-scoped resources this entity carries. */
  resources: string[];
  /** Topological order: each one comes after everything it reads. */
  derived: CompiledDerived[];
  /** Application order (§4.4): priority, then condition id, then declaration order. */
  effects: CompiledEffect[];
  scope: ExprScope;
}

export interface CompiledResource {
  def: Resource;
  min: CompiledExpr;
  max: CompiledExpr | null;
  resetOn: { event: ResetEvent; to: CompiledExpr }[];
}

export interface CompiledTest {
  def: DiceMechanic;
  modifier: CompiledExpr;
  target: CompiledExpr;
  /** A Dice pool's size before the modifier; null for every other kind. */
  pool: CompiledExpr | null;
  /**
   * By actor type: the strictest visibility of anything the expression reads, i.e. who may be told its value. A Dice
   * pool's modifier also covers the pool, since the dice to roll are told as one number.
   */
  modifierVisibility: Record<string, Visibility>;
  targetVisibility: Record<string, Visibility>;
}

export type CompiledInitiative =
  | { def: RankedInitiative; score: CompiledExpr; tiebreak: CompiledExpr[] }
  | { def: SeatedInitiative; score: null; tiebreak: [] };

export interface CompiledScoring {
  def: Scoring;
  score: CompiledExpr;
  tiebreaks: CompiledExpr[];
  endWhen: CompiledExpr[];
}

export interface CompiledRuleset {
  ruleset: Ruleset;
  entities: Record<string, CompiledEntity>;
  resources: Record<string, CompiledResource>;
  conditions: Record<string, Condition>;
  tests: Record<string, CompiledTest>;
  initiative: CompiledInitiative;
  /** The game's scoring, or null when the manifest has none. */
  scoring: CompiledScoring | null;
  healthStates: { id: string; label: string | undefined; when: CompiledExpr }[];
  /** `health.tracks[].instantDeathOverflow`, by the track's resource id. */
  instantDeath: Record<string, CompiledExpr>;
}

export type CompileResult = { ok: true; compiled: CompiledRuleset } | { ok: false; problems: Problem[] };

/** Party-level values every actor expression may read. */
// ponytail: only the character count today; party pools and averages join when a ruleset needs them.
export const PARTY_SCOPE: ExprType = { record: { characters: "int" } };
/** `party.*` reads only how many characters sit at the table, which every seat already sees. */
const PARTY_VISIBILITY: Visibility = "party";

function fieldType(def: FieldDef): ExprType {
  switch (def.type) {
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "text":
    case "enum":
    case "ref":
      return "text";
    case "list":
      return { list: "text" };
  }
}

/** Dotted field ids → a nested record type, so `attr.str` and `attr[ctx.ability]` both resolve. */
export function fieldScope(fields: Readonly<Record<string, FieldDef>>): Record<string, ExprType> {
  const out: Record<string, ExprType> = {};
  const groups = new Map<string, Record<string, FieldDef>>();
  for (const [id, def] of Object.entries(fields)) {
    const dot = id.indexOf(".");
    if (dot < 0) {
      out[id] = fieldType(def);
      continue;
    }
    const group = groups.get(id.slice(0, dot)) ?? {};
    group[id.slice(dot + 1)] = def;
    groups.set(id.slice(0, dot), group);
  }
  // validateRuleset refuses a field that is also a group, so no group overwrites a leaf here.
  for (const [head, sub] of groups) out[head] = { record: fieldScope(sub) };
  return out;
}

function carries(res: Resource, entity: EntityType): boolean {
  if (res.scope !== "entity") return false;
  return res.entities === undefined ? entity.base === "actor" : res.entities.includes(entity.id);
}

/** Visibility of a scope path read by an expression: the strictest of every value it can reach. */
function pathVisibility({
  ref,
  entity,
  resources,
  derived,
}: {
  ref: string;
  entity: EntityType;
  resources: ReadonlyMap<string, Resource>;
  derived: ReadonlyMap<string, Visibility>;
}): Visibility {
  const star = ref.indexOf("*");
  // A computed index (`attr.*`) may reach anything under its prefix.
  const prefix = star < 0 ? ref : ref.slice(0, Math.max(0, star - 1));
  const [root, rest] = [prefix.split(".")[0] ?? "", prefix.split(".").slice(1).join(".")];
  if (root === "party") return PARTY_VISIBILITY;
  if (root === "ctx") return "public"; // call-time inputs, supplied by whoever calls the Test
  if (root === "derived") {
    const ids = rest === "" ? [...derived.keys()] : [rest];
    return strictestVisibility(ids.map((id) => derived.get(id) ?? "gm"));
  }
  if (root === "res") {
    const ids = rest === "" ? [...resources.keys()] : [rest];
    return strictestVisibility(ids.map((id) => resources.get(id)?.visibility ?? "gm"));
  }
  const hits = Object.entries(entity.fields)
    .filter(([id]) => id === prefix || id.startsWith(`${prefix}.`) || prefix.startsWith(`${id}.`))
    .map(([, def]) => def.visibility);
  return hits.length === 0 ? "gm" : strictestVisibility(hits);
}

/** Kahn's sort over derived ids. Returns the order, or the ids left in a cycle. */
export function topoSort(nodes: ReadonlyMap<string, readonly string[]>): { order: string[]; cycle: string[] } {
  const indegree = new Map<string, number>();
  const users = new Map<string, string[]>();
  for (const [id, deps] of nodes) {
    indegree.set(id, deps.length);
    for (const dep of deps) users.set(dep, [...(users.get(dep) ?? []), id]);
  }
  // Ready nodes in declaration order, so the result is stable across runs.
  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() ?? "";
    order.push(id);
    for (const user of users.get(id) ?? []) {
      const left = (indegree.get(user) ?? 0) - 1;
      indegree.set(user, left);
      if (left === 0) ready.push(user);
    }
  }
  const cycle = [...nodes.keys()].filter((id) => !order.includes(id));
  return { order, cycle };
}

class Compiler {
  readonly problems: Problem[] = [];
  private readonly r: Ruleset;
  private readonly resources: Map<string, Resource>;

  constructor(r: Ruleset) {
    this.r = r;
    this.resources = new Map(r.resources.map((x) => [x.id, x]));
  }

  /** Compile one source against every scope it must hold in; the first scope's result is kept (same AST). */
  expr({
    source,
    scopes,
    expect,
    path,
  }: {
    source: string;
    scopes: readonly ExprScope[];
    expect: ExprType;
    path: string;
  }): CompiledExpr | null {
    let kept: CompiledExpr | null = null;
    for (const scope of scopes) {
      const res = compileExpr({ source, scope, expect });
      if (!res.ok) {
        this.problems.push({ path, message: res.error });
        return null;
      }
      kept ??= res.expr;
    }
    return kept;
  }

  private actorEntities(): EntityType[] {
    return this.r.entities.filter((e) => e.base === "actor");
  }

  /** Full scope for an entity: its fields, its derived values, its resources' current values, the party. */
  private entityScope(e: EntityType, opts: { derived: boolean; res: boolean }): Record<string, ExprType> {
    const scope: Record<string, ExprType> = { ...fieldScope(e.fields), party: PARTY_SCOPE };
    if (opts.derived) scope.derived = { record: Object.fromEntries(e.derived.map((d) => [d.id, "int"])) };
    if (opts.res) {
      const ids = this.r.resources.filter((x) => carries(x, e)).map((x) => x.id);
      scope.res = { record: Object.fromEntries(ids.map((id) => [id, "int"])) };
    }
    return scope;
  }

  private entity(e: EntityType, index: number): CompiledEntity | null {
    const scope = this.entityScope(e, { derived: true, res: true });
    const before = this.problems.length;
    const compiled = new Map<string, { def: (typeof e.derived)[number]; expr: CompiledExpr; deps: string[] }>();
    e.derived.forEach((d, j) => {
      const expr = this.expr({
        source: d.expr,
        scopes: [scope],
        expect: "int",
        path: `entities[${index}].derived[${j}].expr`,
      });
      if (expr === null) return;
      const deps = expr.refs.flatMap((ref) => {
        if (ref === "derived.*" || ref === "derived") return e.derived.map((x) => x.id);
        return ref.startsWith("derived.") ? [ref.slice("derived.".length).split(".")[0] ?? ""] : [];
      });
      compiled.set(d.id, { def: d, expr, deps: [...new Set(deps)] });
    });
    if (this.problems.length > before) return null;

    const { order, cycle } = topoSort(new Map([...compiled].map(([id, c]) => [id, c.deps])));
    if (cycle.length > 0) {
      this.problems.push({
        path: `entities[${index}].derived`,
        message: `derived values form a cycle: ${cycle.join(", ")}`,
      });
      return null;
    }

    // Taint: a derived value is as hidden as its most hidden input; declaring it looser is a load error (§5.5).
    const visibility = new Map<string, Visibility>();
    const derived: CompiledDerived[] = [];
    const carried = new Map([...this.resources].filter(([, x]) => carries(x, e)));
    for (const id of order) {
      const c = compiled.get(id);
      if (c === undefined) continue;
      const inputs = c.expr.refs.map((ref) =>
        pathVisibility({ ref, entity: e, resources: carried, derived: visibility }),
      );
      const taint = strictestVisibility(inputs);
      if (VISIBILITY_RANK[c.def.visibility] < VISIBILITY_RANK[taint]) {
        const j = e.derived.indexOf(c.def);
        this.problems.push({
          path: `entities[${index}].derived[${j}].visibility`,
          message: `declared "${c.def.visibility}" but reads "${taint}" values`,
        });
      }
      visibility.set(id, c.def.visibility);
      derived.push({ id, label: c.def.label, expr: c.expr, visibility: c.def.visibility, deps: c.deps });
    }
    return { def: e, resources: [...carried.keys()], derived, effects: [], scope };
  }

  private effects(entities: Record<string, CompiledEntity>): void {
    this.r.conditions.forEach((cond, i) => {
      cond.effects.forEach((eff, j) => {
        const path = `conditions[${i}].effects[${j}]`;
        const target = eff.phase === "derived" ? eff.path.replace(/^derived\./, "") : eff.path;
        if (eff.phase === "derived" && !eff.path.startsWith("derived.")) {
          this.problems.push({ path: `${path}.path`, message: 'a derived-phase effect targets "derived.<id>"' });
          return;
        }
        // An effect applies to the actor types that have its target; it must reach at least one. Hosts come from
        // the definitions, so an entity that failed to compile (already reported) does not cascade a second error.
        const declared = this.actorEntities().filter((e) =>
          eff.phase === "derived" ? e.derived.some((d) => d.id === target) : own(e.fields, target)?.type === "int",
        );
        if (declared.length === 0) {
          this.problems.push({ path: `${path}.path`, message: `no actor has an integer "${eff.path}"` });
          return;
        }
        const hosts = declared.flatMap((e) => {
          const ce = own(entities, e.id);
          return ce === undefined ? [] : [ce];
        });
        if (hosts.length === 0) return;
        // Base effects run before derived values exist, so they cannot read them.
        const scopes = hosts.map((h) =>
          eff.phase === "base" ? this.entityScope(h.def, { derived: false, res: true }) : h.scope,
        );
        const value = this.expr({ source: eff.value, scopes, expect: "int", path: `${path}.value` });
        const when =
          eff.when === undefined ? null : this.expr({ source: eff.when, scopes, expect: "bool", path: `${path}.when` });
        if (value === null || (eff.when !== undefined && when === null)) return;
        for (const h of hosts) {
          // Same rule as a derived value: the target shows the effect's inputs and that the condition is on, so it
          // must be at least as hidden as all of them.
          const targetVis =
            eff.phase === "derived"
              ? (h.derived.find((d) => d.id === target)?.visibility ?? "gm")
              : (own(h.def.fields, target)?.visibility ?? "gm");
          const derivedVis = new Map(h.derived.map((d) => [d.id, d.visibility]));
          const carried = new Map([...this.resources].filter(([, x]) => carries(x, h.def)));
          const refs = [...value.refs, ...(when?.refs ?? [])];
          const taint = strictestVisibility([
            cond.visibility,
            ...refs.map((ref) => pathVisibility({ ref, entity: h.def, resources: carried, derived: derivedVis })),
          ]);
          if (VISIBILITY_RANK[targetVis] < VISIBILITY_RANK[taint]) {
            this.problems.push({
              path: `${path}.path`,
              message: `"${eff.path}" on ${h.def.id} is "${targetVis}" but the effect reveals "${taint}" values`,
            });
            continue;
          }
          h.effects.push({
            conditionId: cond.id,
            phase: eff.phase,
            mode: eff.mode,
            target,
            priority: eff.priority ?? 0,
            value,
            when,
          });
        }
      });
    });
    // Stable sort keeps declaration order within one condition.
    for (const ce of Object.values(entities)) {
      ce.effects.sort(
        (a, b) =>
          a.priority - b.priority || (a.conditionId < b.conditionId ? -1 : a.conditionId > b.conditionId ? 1 : 0),
      );
    }
  }

  private resource(x: Resource, i: number): CompiledResource | null {
    const hosts = this.r.entities.filter((e) => carries(x, e));
    // A bound never reads a current value (`res`): bounds would move with play and could chase each other.
    const scopes: ExprScope[] =
      x.scope === "entity"
        ? hosts.map((e) => this.entityScope(e, { derived: true, res: false }))
        : [{ party: PARTY_SCOPE }];
    if (scopes.length === 0) {
      this.problems.push({ path: `resources[${i}].entities`, message: "no entity carries this resource" });
      return null;
    }
    const min = this.expr({ source: x.min, scopes, expect: "int", path: `resources[${i}].min` });
    const max =
      x.max === undefined ? null : this.expr({ source: x.max, scopes, expect: "int", path: `resources[${i}].max` });
    const resetScopes = scopes.map((s) => ({
      ...s,
      min: "int" as const,
      ...(x.max === undefined ? {} : { max: "int" as const }),
    }));
    const resetOn = x.resetOn.map((reset, j) => ({
      event: reset.event,
      to: this.expr({ source: reset.to, scopes: resetScopes, expect: "int", path: `resources[${i}].resetOn[${j}].to` }),
    }));
    if (min === null || (x.max !== undefined && max === null)) return null;
    const okResets = resetOn.flatMap((reset) => (reset.to === null ? [] : [{ event: reset.event, to: reset.to }]));
    return { def: x, min, max, resetOn: okResets };
  }

  /** null: no scoring block; undefined: it did not compile (the problems are recorded). */
  private scoring(scopes: readonly ExprScope[]): CompiledScoring | null | undefined {
    const def = this.r.scoring;
    if (def === undefined) return null;
    const one = (source: string, path: string, expect: ExprType, extra: ExprScope = {}) =>
      this.expr({ source, scopes: scopes.map((s) => ({ ...s, ...extra })), expect, path });
    const score = one(def.score, "scoring.score", "int");
    const tiebreaks = def.tiebreaks.map((t, i) => one(t.expr, `scoring.tiebreaks[${i}].expr`, "int"));
    const endWhen = def.endWhen.map((t, i) => one(t.when, `scoring.endWhen[${i}].when`, "bool", { round: "int" }));
    const ok = <T>(xs: (T | null)[]): xs is T[] => xs.every((x) => x !== null);
    return score !== null && ok(tiebreaks) && ok(endWhen) ? { def, score, tiebreaks, endWhen } : undefined;
  }

  run(): CompiledRuleset | null {
    const entities: Record<string, CompiledEntity> = {};
    this.r.entities.forEach((e, i) => {
      const ce = this.entity(e, i);
      if (ce !== null) entities[e.id] = ce;
    });
    this.effects(entities);

    const resources: Record<string, CompiledResource> = {};
    this.r.resources.forEach((x, i) => {
      const cr = this.resource(x, i);
      if (cr !== null) resources[x.id] = cr;
    });

    const actorScopes = this.actorEntities().flatMap((e) => {
      const ce = own(entities, e.id);
      return ce === undefined ? [] : [ce.scope];
    });
    if (actorScopes.length === 0) this.problems.push({ path: "entities", message: "no actor entity type" });

    const tests: Record<string, CompiledTest> = {};
    for (const [id, t] of Object.entries(this.r.tests)) {
      const ctx: ExprType = { record: { ...t.inputs } };
      const scopes = actorScopes.map((s) => ({ ...s, ctx }));
      const modifier = this.expr({ source: t.modifier, scopes, expect: "int", path: `tests.${id}.modifier` });
      const target = this.expr({ source: t.target, scopes, expect: "int", path: `tests.${id}.target` });
      const pool =
        t.kind === "poolSuccesses"
          ? this.expr({ source: t.pool, scopes, expect: "int", path: `tests.${id}.pool` })
          : null;
      if (modifier === null || target === null || (t.kind === "poolSuccesses" && pool === null)) continue;
      // A value the call computes for an actor is as hidden as its most hidden input, like a derived value.
      const seen = (...exprs: CompiledExpr[]) =>
        Object.fromEntries(
          this.actorEntities().flatMap((e): [string, Visibility][] => {
            const ce = own(entities, e.id);
            if (ce === undefined) return [];
            const carried = new Map([...this.resources].filter(([, x]) => carries(x, e)));
            const derived = new Map(ce.derived.map((d) => [d.id, d.visibility]));
            const refs = exprs.flatMap((expr) =>
              expr.refs.map((ref) => pathVisibility({ ref, entity: e, resources: carried, derived })),
            );
            return [[e.id, strictestVisibility(refs)]];
          }),
        );
      const modifierVisibility = pool === null ? seen(modifier) : seen(modifier, pool);
      tests[id] = { def: t, modifier, target, pool, modifierVisibility, targetVisibility: seen(target) };
    }

    const init = this.r.initiative;
    const ranked = init.strategy === "ranked" ? init : null;
    const score =
      ranked === null
        ? null
        : this.expr({ source: ranked.score, scopes: actorScopes, expect: "int", path: "initiative.score" });
    const tiebreak = (ranked?.tiebreak ?? []).map((src, j) =>
      this.expr({ source: src, scopes: actorScopes, expect: "int", path: `initiative.tiebreak[${j}]` }),
    );

    const scoring = this.scoring(actorScopes);
    const healthStates = this.r.health.states.flatMap((s, j) => {
      const when = this.expr({ source: s.when, scopes: actorScopes, expect: "bool", path: `health.states[${j}].when` });
      return when === null ? [] : [{ id: s.id, label: s.label, when }];
    });

    const instantDeath: Record<string, CompiledExpr> = {};
    this.r.health.tracks.forEach((t, j) => {
      if (t.instantDeathOverflow === undefined) return;
      const expr = this.expr({
        source: t.instantDeathOverflow,
        scopes: actorScopes,
        expect: "int",
        path: `health.tracks[${j}].instantDeathOverflow`,
      });
      if (expr !== null) instantDeath[t.resource] = expr;
    });

    if (this.problems.length > 0 || scoring === undefined || (ranked !== null && score === null)) return null;
    return {
      ruleset: this.r,
      entities,
      resources,
      conditions: Object.fromEntries(this.r.conditions.map((c) => [c.id, c])),
      tests,
      scoring,
      initiative:
        ranked !== null && score !== null
          ? { def: ranked, score, tiebreak: tiebreak.filter((t): t is CompiledExpr => t !== null) }
          : { def: init as SeatedInitiative, score: null, tiebreak: [] },
      healthStates,
      instantDeath,
    };
  }
}

/**
 * Load a manifest: validate it, then compile every expression against its scope, sort each entity's derived values
 * and check their visibility taint. Every problem comes back with its path; nothing half-compiled is returned.
 */
export function compileRuleset(input: unknown): CompileResult {
  const valid = validateRuleset(input);
  if (!valid.ok) return valid;
  const compiler = new Compiler(valid.ruleset);
  const compiled = compiler.run();
  return compiled === null ? { ok: false, problems: compiler.problems } : { ok: true, compiled };
}
