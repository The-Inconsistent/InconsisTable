import {
  PoolFlag,
  strictestVisibility,
  VISIBILITY_RANK,
  type EffectMode,
  type EffectPhase,
  type ResetEvent,
  type Visibility,
} from "./enums.ts";
import type { BuildParams } from "./build/params.ts";
import { codexScope } from "./codex.ts";
import { generatorExprProblems } from "./generators.ts";
import type { ExprScope, ExprType } from "./expr/expr.ast.ts";
import { RES_ELSEWHERE } from "./expr/expr.check.ts";
import { compileExpr, type CompiledExpr } from "./expr/expr.ts";
import {
  acquiredKinds,
  hostValuesOf,
  HOST_PREFIX,
  strikeTargets,
  validateRuleset,
  immuneOf,
  type Condition,
  type StrikeFigure,
  type Effect,
  type EntityType,
  type FieldDef,
  type RankedInitiative,
  type SeatedInitiative,
  type SidesInitiative,
  type Resource,
  type Ruleset,
  type Scoring,
  type DiceMechanic,
  type LedgerKind,
  type NoticeGroup,
  type NoticeWhen,
  type TestOffer,
  type TableEffect,
  type RowColumn,
} from "./manifest.ts";
import { own } from "./own.ts";
import { declaredPrimitives, opInputKeys } from "./primitives/registry.ts";
import type { Problem } from "./problem.ts";

export interface CompiledDerived {
  id: string;
  label: string;
  expr: CompiledExpr;
  /** Declared visibility, checked to be no looser than its inputs. */
  visibility: Visibility;
  /** Derived ids it reads. */
  deps: string[];
  /** The int field whose value, when set, replaces the worked-out one (house decision #96); null when none. */
  override: string | null;
}

/** What an actor holds from a pack: the entry it chose and what it adds (house decision #61). */
export interface ActiveEntry {
  type: string;
  key: string;
  name: string;
  effects: readonly Effect[];
}

/** An entry's source id in the §4.4 order: `<type>/<key>`. */
export const entrySourceId = (e: Pick<ActiveEntry, "type" | "key">): string => `${e.type}/${e.key}`;

export interface CompiledEffect {
  /** The condition id, or `<type>/<key>` of the entry the effect comes from. */
  sourceId: string;
  phase: EffectPhase;
  mode: EffectMode;
  /** Field id (phase base) or derived id (phase derived). */
  target: string;
  priority: number;
  value: CompiledExpr;
  when: CompiledExpr | null;
}

/** §4.4 order: priority, then source id. Callers sort stably, so declaration order holds within one source. */
export const byOrder = (a: CompiledEffect, b: CompiledEffect): number =>
  a.priority - b.priority || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

export interface CompiledEntity {
  def: EntityType;
  /** Entity-scoped resources this entity carries. */
  resources: string[];
  /** Topological order: each one comes after everything it reads. */
  derived: CompiledDerived[];
  /** Conditions' effects, in application order (§4.4): priority, then source id, then declaration order. */
  effects: CompiledEffect[];
  scope: ExprScope;
}

export interface CompiledResource {
  def: Resource;
  min: CompiledExpr;
  max: CompiledExpr | null;
  resetOn: { event: ResetEvent; to: CompiledExpr }[];
  start: CompiledExpr | null;
}

/**
 * What an offer reads of a taker's resolved report as `result` (house decision #80): passed (the outcome is a success
 * or a critical one), the outcome id, the score, a Dice pool's margin and shifts, the natural die, the number to beat
 * as the call set it, and the special dice's flags. A number the kind of Test has not is 0.
 */
export const RESULT_SCOPE: ExprType = {
  record: {
    passed: "bool",
    outcome: "text",
    total: "int",
    margin: "int",
    shifts: "int",
    natural: "int",
    target: "int",
    flags: { record: Object.fromEntries(PoolFlag.options.map((f) => [f, "bool" as const])) },
  },
};

/** One offer of a Test: `when` reads `result` and `ctx`, each change's `by` the taker's scope too. */
export interface CompiledOffer {
  def: TestOffer;
  when: CompiledExpr;
  changes: { pool: string | null; resource: string | null; by: CompiledExpr }[];
}

/** One effect of a lookup line, its expressions compiled over the target and the inputs (house decision #87). */
export interface CompiledTableEffect {
  def: TableEffect;
  when: CompiledExpr | null;
  times: CompiledExpr | null;
  /** The hit's wounds and shock, or the delta of a resource or pool; null where the effect has none. */
  wounds: CompiledExpr | null;
  shock: CompiledExpr | null;
  by: CompiledExpr | null;
}

/** A table with a die, ready to be read with a typed result: its modifier, and each line's effects by index. */
export interface CompiledLookup {
  modifier: CompiledExpr | null;
  effects: CompiledTableEffect[][];
}

export interface CompiledTest {
  def: DiceMechanic;
  /** The Test's offers (house decision #80); empty without any. */
  offers: CompiledOffer[];
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
  /** By actor type: who may be told what the Test's offers work out (house decision #170). */
  offerVisibility: Record<string, Visibility>;
}

/** A notice rule (house decision #79), with who may be told its `if` by actor type, as a Test's numbers are. */
export interface CompiledNotice {
  id: string;
  when: NoticeWhen;
  /** The actor types it reads; null for every actor type. */
  entities: readonly string[] | null;
  if: CompiledExpr;
  text: string;
  /** Each `{param}` of the text, by name (house decision #168); empty without `params`. */
  params: Record<string, CompiledExpr>;
  group: NoticeGroup | null;
  rises: CompiledExpr | null;
  /** Who may be told it: the strictest of what `if`, `params` and `rises` read. */
  visibility: Record<string, Visibility>;
}

/** What a notice reads of a ledger actor's play (house decision #168), as `build`. */
/** What a rows field's Test input reads of the row as `values` (house decision #173): its plain columns. */
export function rowScope(columns: readonly RowColumn[]): ExprType {
  const type = { int: "int", text: "text", enum: "text", bool: "bool" } as const;
  return {
    record: Object.fromEntries(
      columns.flatMap((c) => (c.type in type ? [[c.id, type[c.type as keyof typeof type]]] : [])),
    ),
  };
}

export const NOTICE_BUILD_SCOPE: ExprScope = { xpSpent: "int", xpAtAscension: "int" };

export type CompiledInitiative =
  | { def: RankedInitiative; score: CompiledExpr; tiebreak: CompiledExpr[] }
  | { def: SeatedInitiative | SidesInitiative; score: null; tiebreak: [] };

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
  /** Null when the manifest has no turn order. */
  initiative: CompiledInitiative | null;
  /** The game's scoring, or null when the manifest has none. */
  scoring: CompiledScoring | null;
  /** `entities`: the actor types the state applies to; null for every actor type. */
  healthStates: { id: string; label: string | undefined; when: CompiledExpr; entities: readonly string[] | null }[];
  /** `health.tracks[].instantDeathOverflow`, by the track's resource id. */
  instantDeath: Record<string, CompiledExpr>;
  /**
   * The ledger builder's actor type, parsed parameters and catalogue kinds (house decision #62), for `resolveBuild`
   * without parsing again; null when the ruleset has none.
   */
  build: { actor: string; params: BuildParams; kinds: Record<LedgerKind, string> } | null;
  /** The notice rules (house decision #79), in the manifest's order; empty without a `notices` block. */
  notices: CompiledNotice[];
  /** Each of `reminders`' `if` in manifest order, null where it has none (house decision #81). */
  reminders: (CompiledExpr | null)[];
  /** Each condition's `immune`, by condition id, for those that have one (house decision #81). */
  immune: Record<string, CompiledExpr>;
  /** Every table with a die, by table id, as a typed result reads it (house decision #87). */
  lookups: Record<string, CompiledLookup>;
}

/** What a reminder's `if` reads beside the combatant's own scope (house decision #81). */
export const REMINDER_SCOPE: ExprScope = { round: "int", held: "bool", barred: "bool" };

export type CompileResult = { ok: true; compiled: CompiledRuleset } | { ok: false; problems: Problem[] };

/** A record's entries by key, so the Go twin (which has no key order) reports problems in the same order. */
const sortedEntries = <V>(o: Readonly<Record<string, V>>): [string, V][] =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * `ctx.self` and `ctx.fight` in a spend's and a panel's expressions (house decisions #84, #114); a spend's inputs join
 * them as ints. `acting`, `held` and `foeActing` are house decision #116's.
 */
export const SPEND_CTX: Readonly<Record<string, ExprType>> = {
  self: "text",
  fight: {
    record: { on: "bool", in: "bool", round: "int", barred: "bool", acting: "bool", held: "bool", foeActing: "bool" },
  },
};

/** Party-level values every actor expression may read. */
// ponytail: only the character count today; party pools and averages join when a ruleset needs them.
export const PARTY_SCOPE: ExprType = { record: { characters: "int" } };
/** `party` at spawn (house decision #92): also `seated`, the characters held by a member's seat. */
export const SPAWN_PARTY_SCOPE: ExprType = { record: { characters: "int", seated: "int" } };
/** `ctx` of a spawn option's and an adjustment's expressions: whether it is spawned as a mob. */
export const SPAWN_CTX: Record<string, ExprType> = { mob: "bool" };
/** `ctx` of a budget line's cost: how many the line stands for, and whether as a mob. */
export const BUDGET_COST_CTX: Record<string, ExprType> = { count: "int", mob: "bool" };
/** The source id of a spawn option's effects, beside conditions' ids and entries' `<type>/<key>`. */
export const spawnSourceId = (optionId: string) => `spawn/${optionId}`;
/** `party.*` reads only how many characters sit at the table, which every seat already sees. */
const PARTY_VISIBILITY: Visibility = "party";

/** The `campaign` root: one member per declared field, typed as the field reads. Null when the manifest declares none. */
function campaignScope(r: Ruleset): ExprType | null {
  if (r.campaignFields === undefined) return null;
  const type = { int: "int", enum: "text", bool: "bool" } as const;
  return { record: Object.fromEntries(Object.entries(r.campaignFields).map(([id, def]) => [id, type[def.type]])) };
}

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
  // `campaign.*` is a value of the whole table, shown to every seat like the party's size.
  if (root === "party" || root === "campaign") return PARTY_VISIBILITY;
  if (root === "ctx") return "public"; // call-time inputs, supplied by whoever calls the Test
  // A taker's report, as an offer reads it: the call decides what of it a seat is told (house decision #170).
  if (root === "result") return "public";
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
    /** Absent: any type (a spend op's input, which the op's own schema checks when it runs). */
    expect?: ExprType;
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

  /** `{ campaign }` beside `party` in a scope, or nothing when the manifest declares no campaign fields. */
  private campaignRoot(): Record<string, ExprType> {
    const campaign = campaignScope(this.r);
    return campaign === null ? {} : { campaign };
  }

  private actorEntities(): EntityType[] {
    return this.r.entities.filter((e) => e.base === "actor");
  }

  /** Full scope for an entity: its fields, its derived values, its resources' current values, the party. */
  private entityScope(e: EntityType, opts: { derived: boolean; res: boolean }): Record<string, ExprType> {
    const scope: Record<string, ExprType> = { ...fieldScope(e.fields), party: PARTY_SCOPE, ...this.campaignRoot() };
    if (opts.derived) scope.derived = { record: Object.fromEntries(e.derived.map((d) => [d.id, "int"])) };
    if (opts.res) {
      const ids = this.r.resources.filter((x) => carries(x, e)).map((x) => x.id);
      scope.res = { record: Object.fromEntries(ids.map((id) => [id, "int"])) };
      const elsewhere = this.r.resources.filter((x) => !ids.includes(x.id)).map((x) => x.id);
      scope[RES_ELSEWHERE] = { record: Object.fromEntries(elsewhere.map((id) => [id, "int"])) };
    }
    return scope;
  }

  /**
   * Refs that are fields of `e` no creation step writes, when the ruleset builds `e` at all. A ref only read inside
   * `has(...)` is flagged too (ponytail: refs do not tell it apart, split them in the checker if a ruleset needs it).
   */
  private unsetByCreation(e: EntityType, refs: readonly string[]): string[] {
    const steps = this.r.creation.filter((s) => s.actor === e.id);
    if (steps.length === 0) return [];
    const written = new Set(steps.flatMap((s) => (s.kind === "choose" ? s.copy.map((c) => c.to) : s.fields)));
    // An unset list reads as empty (house decision #91), so creation need not write one.
    return refs.filter((ref) => Object.hasOwn(e.fields, ref) && e.fields[ref]?.type !== "list" && !written.has(ref));
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
      for (const ref of this.unsetByCreation(e, expr.refs)) {
        this.problems.push({
          path: `entities[${index}].derived[${j}].expr`,
          message: `creation never sets "${ref}", which this reads; add it to a creation step`,
        });
      }
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
      const override = c.def.override;
      const inputs = [...c.expr.refs, ...(override === undefined ? [] : [override])].map((ref) =>
        pathVisibility({ ref, entity: e, resources: carried, derived: visibility }),
      );
      if (override !== undefined && own(e.fields, override)?.type !== "int")
        this.problems.push({
          path: `entities[${index}].derived[${e.derived.indexOf(c.def)}].override`,
          message: `"${override}" is not an int field of ${e.id}`,
        });
      const taint = strictestVisibility(inputs);
      if (VISIBILITY_RANK[c.def.visibility] < VISIBILITY_RANK[taint]) {
        const j = e.derived.indexOf(c.def);
        this.problems.push({
          path: `entities[${index}].derived[${j}].visibility`,
          message: `declared "${c.def.visibility}" but reads "${taint}" values`,
        });
      }
      visibility.set(id, c.def.visibility);
      derived.push({
        id,
        label: c.def.label,
        expr: c.expr,
        visibility: c.def.visibility,
        deps: c.deps,
        override: c.def.override ?? null,
      });
    }
    return { def: e, resources: [...carried.keys()], derived, effects: [], scope };
  }

  /**
   * One effect of a condition or a pack entry against the actor types `pool` that may host it. Returns the compiled
   * effect for each host it holds for; problems are recorded, and an effect that fails compiles to nothing.
   */
  private effect({
    eff,
    path,
    sourceId,
    sourceVisibility,
    pool,
    entities,
    noHost,
  }: {
    eff: Effect;
    path: string;
    sourceId: string;
    /** How hidden the source itself is: an effect shows that its source is on, like an input. */
    sourceVisibility: Visibility;
    pool: readonly EntityType[];
    entities: Record<string, CompiledEntity>;
    noHost: string;
  }): { host: CompiledEntity; effect: CompiledEffect }[] {
    const target = eff.phase === "derived" ? eff.path.replace(/^derived\./, "") : eff.path;
    if (eff.phase === "derived" && !eff.path.startsWith("derived.")) {
      this.problems.push({ path: `${path}.path`, message: 'a derived-phase effect targets "derived.<id>"' });
      return [];
    }
    // An effect applies to the actor types that have its target; it must reach at least one. Hosts come from
    // the definitions, so an entity that failed to compile (already reported) does not cascade a second error.
    const declared = pool.filter((e) =>
      eff.phase === "derived" ? e.derived.some((d) => d.id === target) : own(e.fields, target)?.type === "int",
    );
    if (declared.length === 0) {
      this.problems.push({ path: `${path}.path`, message: noHost });
      return [];
    }
    const hosts = declared.flatMap((e) => {
      const ce = own(entities, e.id);
      return ce === undefined ? [] : [ce];
    });
    if (hosts.length === 0) return [];
    // Base effects run before derived values exist, so they cannot read them.
    const scopes = hosts.map((h) =>
      eff.phase === "base" ? this.entityScope(h.def, { derived: false, res: true }) : h.scope,
    );
    const value = this.expr({ source: eff.value, scopes, expect: "int", path: `${path}.value` });
    const when =
      eff.when === undefined ? null : this.expr({ source: eff.when, scopes, expect: "bool", path: `${path}.when` });
    if (value === null || (eff.when !== undefined && when === null)) return [];
    const out: { host: CompiledEntity; effect: CompiledEffect }[] = [];
    for (const h of hosts) {
      // Same rule as a derived value: the target shows the effect's inputs and that its source is on, so it
      // must be at least as hidden as all of them.
      const targetVis =
        eff.phase === "derived"
          ? (h.derived.find((d) => d.id === target)?.visibility ?? "gm")
          : (own(h.def.fields, target)?.visibility ?? "gm");
      const derivedVis = new Map(h.derived.map((d) => [d.id, d.visibility]));
      const carried = new Map([...this.resources].filter(([, x]) => carries(x, h.def)));
      const refs = [...value.refs, ...(when?.refs ?? [])];
      const taint = strictestVisibility([
        sourceVisibility,
        ...refs.map((ref) => pathVisibility({ ref, entity: h.def, resources: carried, derived: derivedVis })),
      ]);
      if (VISIBILITY_RANK[targetVis] < VISIBILITY_RANK[taint]) {
        this.problems.push({
          path: `${path}.path`,
          message: `"${eff.path}" on ${h.def.id} is "${targetVis}" but the effect reveals "${taint}" values`,
        });
        continue;
      }
      out.push({
        host: h,
        effect: { sourceId, phase: eff.phase, mode: eff.mode, target, priority: eff.priority ?? 0, value, when },
      });
    }
    return out;
  }

  /** Entries' effects against the actor types `pool`; the problems carry `pathOf(entry index, effect index)`. */
  entryEffects({
    entries,
    pool,
    entities,
    pathOf,
  }: {
    entries: readonly ActiveEntry[];
    pool: readonly EntityType[];
    entities: Record<string, CompiledEntity>;
    pathOf: (entry: number, effect: number) => string;
  }): { host: CompiledEntity; effect: CompiledEffect }[] {
    return entries.flatMap((entry, i) =>
      entry.effects.flatMap((eff, j) =>
        eff.path.startsWith(HOST_PREFIX)
          ? this.hostEffect({ eff, type: entry.type, path: pathOf(i, j) })
          : this.effect({
              eff,
              path: pathOf(i, j),
              sourceId: entrySourceId(entry),
              // The entry's own visibility is who may read its page; what it adds to a number is the same for every seat.
              sourceVisibility: "public",
              pool,
              entities,
              noHost: `${pool.map((e) => e.id).join(", ")} has no integer "${eff.path}"`,
            }),
      ),
    );
  }

  /**
   * An entry's effect on its host's card (house decision #102), `host.<value>`: a value of the card of a kind its kinds
   * fit to, added or overridden by a number that reads nothing (the card shows it while fitted). It never changes the
   * actor, so it compiles to no actor effect.
   */
  private hostEffect({ eff, type, path }: { eff: Effect; type: string; path: string }): [] {
    const name = eff.path.slice(HOST_PREFIX.length);
    if (!hostValuesOf({ items: this.r.items, type }).includes(name))
      this.problems.push({ path: `${path}.path`, message: `"${eff.path}" is not a value of a host's card` });
    else if (eff.mode !== "add" && eff.mode !== "override")
      this.problems.push({ path: `${path}.mode`, message: "a host's value is added to or overridden" });
    this.expr({ source: eff.value, scopes: [{}], expect: "int", path: `${path}.value` });
    if (eff.when !== undefined)
      this.problems.push({ path: `${path}.when`, message: "a host's value takes no condition" });
    return [];
  }

  private effects(entities: Record<string, CompiledEntity>): void {
    this.r.conditions.forEach((cond, i) => {
      cond.effects.forEach((eff, j) => {
        const hits = this.effect({
          eff,
          path: `conditions[${i}].effects[${j}]`,
          sourceId: cond.id,
          sourceVisibility: cond.visibility,
          pool: this.actorEntities(),
          entities,
          noHost: `no actor has an integer "${eff.path}"`,
        });
        for (const { host, effect } of hits) host.effects.push(effect);
      });
    });
    // A spawn option's effects run with the conditions' (house decision #92); only the GM side is told an actor has one.
    this.r.spawn?.options?.forEach((o, i) => {
      o.effects.forEach((eff, j) => {
        const hits = this.effect({
          eff,
          path: `spawn.options[${i}].effects[${j}]`,
          sourceId: spawnSourceId(o.id),
          sourceVisibility: "gm",
          pool: this.actorEntities().filter((e) => o.entities?.includes(e.id) ?? true),
          entities,
          noHost: `no actor it applies to has an integer "${eff.path}"`,
        });
        for (const { host, effect } of hits) host.effects.push(effect);
      });
    });
    // Stable sort keeps declaration order within one condition.
    for (const ce of Object.values(entities)) ce.effects.sort(byOrder);
  }

  private resource(x: Resource, i: number): CompiledResource | null {
    const hosts = this.r.entities.filter((e) => carries(x, e));
    // A bound never reads a current value (`res`): bounds would move with play and could chase each other.
    const scopes: ExprScope[] =
      x.scope === "entity"
        ? hosts.map((e) => this.entityScope(e, { derived: true, res: false }))
        : [{ party: PARTY_SCOPE, ...this.campaignRoot() }];
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
    const start =
      x.start === undefined
        ? null
        : this.expr({ source: x.start, scopes: resetScopes, expect: "int", path: `resources[${i}].start` });
    if (min === null || (x.max !== undefined && max === null)) return null;
    const okResets = resetOn.flatMap((reset) => (reset.to === null ? [] : [{ event: reset.event, to: reset.to }]));
    return { def: x, min, max, resetOn: okResets, start };
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

  /** By actor type: the strictest visibility of anything the expressions read, i.e. who may be told what they say. */
  private seenBy(
    takers: readonly { e: EntityType; ce: CompiledEntity }[],
    exprs: readonly CompiledExpr[],
  ): Record<string, Visibility> {
    return Object.fromEntries(
      takers.map(({ e, ce }): [string, Visibility] => {
        const carried = new Map([...this.resources].filter(([, x]) => carries(x, e)));
        const derived = new Map(ce.derived.map((d) => [d.id, d.visibility]));
        const refs = exprs.flatMap((expr) =>
          expr.refs.map((ref) => pathVisibility({ ref, entity: e, resources: carried, derived })),
        );
        return [e.id, strictestVisibility(refs)];
      }),
    );
  }

  /**
   * `spends` (house decision #84): every expression in the scope of each actor type that may spend it, plus `ctx`, and
   * every `run` op one of a primitive the ruleset declares, its input keys that op's. Read by `planSpend` from the
   * manifest's own text, as `health.harm` is.
   */
  private spends(actorsOf: (ids: readonly string[] | undefined) => { ce: CompiledEntity }[]): void {
    const declared = declaredPrimitives(this.r);
    this.r.spends?.forEach((s, i) => {
      const path = `spends[${i}]`;
      const bases = actorsOf(s.entities).map(({ ce }) => ce.scope);
      const inputs = Object.fromEntries(Object.keys(s.inputs ?? {}).map((k): [string, ExprType] => [k, "int"]));
      const scopes = (withInputs: boolean) =>
        bases.map((b) => ({ ...b, ctx: { record: { ...(withInputs ? inputs : {}), ...SPEND_CTX } } }));
      for (const [name, def] of sortedEntries(s.inputs ?? {}))
        this.expr({ source: def.max, scopes: scopes(false), expect: "int", path: `${path}.inputs.${name}.max` });
      if (s.if !== undefined) this.expr({ source: s.if, scopes: scopes(true), expect: "bool", path: `${path}.if` });
      if (s.then?.if !== undefined)
        this.expr({ source: s.then.if, scopes: scopes(true), expect: "bool", path: `${path}.then.if` });
      s.cost.forEach((c, j) =>
        this.expr({ source: c.amount, scopes: scopes(true), expect: "int", path: `${path}.cost[${j}].amount` }),
      );
      s.run?.forEach((step, j) => {
        const at = `${path}.run[${j}]`;
        if (!declared.includes(step.primitive)) {
          this.problems.push({
            path: `${at}.primitive`,
            message: `"${step.primitive}" is not declared by this ruleset`,
          });
          return;
        }
        const keys = opInputKeys(step.primitive, step.op);
        if (keys === null) {
          this.problems.push({ path: `${at}.op`, message: `"${step.primitive}" has no op "${step.op}"` });
          return;
        }
        for (const [key, value] of sortedEntries(step.input)) {
          if (!keys.includes(key))
            this.problems.push({ path: `${at}.input.${key}`, message: `"${key}" is not an input` });
          else if (typeof value === "string")
            this.expr({ source: value, scopes: scopes(true), path: `${at}.input.${key}` });
        }
      });
    });
  }

  /**
   * `items.acquire` (house decision #102): every expression in the scope of each actor type holding a kind it grants,
   * with `item` (that kind's entry fields and its `tags`) and `ctx` (the picks). Read by `planAcquire` from the
   * manifest's own text.
   */
  private acquire(actorsOf: (ids: readonly string[] | undefined) => { ce: CompiledEntity }[]): void {
    const items = this.r.items;
    const a = items?.acquire;
    if (items === undefined || a === undefined) return;
    const path = "items.acquire";
    const picks = Object.fromEntries(Object.keys(a.picks ?? {}).map((k): [string, ExprType] => [k, "int"]));
    const bases = acquiredKinds(items, a).flatMap((k) => {
      const entry = this.r.entities.find((e) => e.id === k.entry);
      const item: ExprType = { record: { ...fieldScope(entry?.fields ?? {}), tags: { list: "text" } } };
      return actorsOf(k.entities).map(({ ce }) => ({ ...ce.scope, item }));
    });
    const scopes = (withPicks: boolean) => bases.map((b) => ({ ...b, ctx: { record: withPicks ? picks : {} } }));
    for (const [name, def] of sortedEntries(a.picks ?? {}))
      this.expr({ source: def.max, scopes: scopes(false), expect: "int", path: `${path}.picks.${name}.max` });
    if (a.if !== undefined) this.expr({ source: a.if, scopes: scopes(true), expect: "bool", path: `${path}.if` });
    for (const [name, parts] of sortedEntries(a.inputs))
      parts.forEach((p, j) =>
        this.expr({ source: p.value, scopes: scopes(true), expect: "int", path: `${path}.inputs.${name}[${j}].value` }),
      );
    const ints: [string | undefined, string][] = [
      [a.topUp?.max, "topUp.max"],
      [a.quantity, "quantity"],
      [a.load?.quantity, "load.quantity"],
    ];
    for (const [source, at] of ints)
      if (source !== undefined) this.expr({ source, scopes: scopes(true), expect: "int", path: `${path}.${at}` });
  }

  /**
   * `spawn` (house decision #92): an option's and an adjustment's `when` and `add` in the spawn scope of each actor type
   * they apply to; a budget line's `cost` in that of each type a pack entry is spawned as, its `budget` and a switch's
   * `by` in the room's. Read by `planSpawn` and `budgetOf` from the manifest's own text.
   */
  private spawn(): void {
    const spawn = this.r.spawn;
    if (spawn === undefined) return;
    const scopeOf = (e: EntityType, ctx: Record<string, ExprType>): ExprScope => ({
      ...fieldScope(e.fields),
      ...this.roomScope(),
      ctx: { record: ctx },
    });
    const of = (ids: readonly string[] | undefined) => this.actorEntities().filter((e) => ids?.includes(e.id) ?? true);
    spawn.options?.forEach((o, i) => {
      if (o.when !== undefined)
        this.expr({
          source: o.when,
          scopes: of(o.entities).map((e) => scopeOf(e, SPAWN_CTX)),
          expect: "bool",
          path: `spawn.options[${i}].when`,
        });
    });
    spawn.adjust?.forEach((a, i) => {
      const scopes = of(a.entities).map((e) => scopeOf(e, SPAWN_CTX));
      if (a.when !== undefined) this.expr({ source: a.when, scopes, expect: "bool", path: `spawn.adjust[${i}].when` });
      for (const [key, source] of sortedEntries(a.add))
        this.expr({ source, scopes, expect: "int", path: `spawn.adjust[${i}].add.${key}` });
    });
    const b = spawn.budget;
    if (b === undefined) return;
    const built = new Set(this.r.creation.map((s) => s.actor));
    const spawned = this.actorEntities().filter((e) => !built.has(e.id));
    const costScopes = (spawned.length > 0 ? spawned : this.actorEntities()).map((e) => scopeOf(e, BUDGET_COST_CTX));
    b.lines.forEach((l, i) => {
      this.expr({ source: l.cost, scopes: costScopes, expect: "int", path: `spawn.budget.lines[${i}].cost` });
      this.expr({
        source: l.budget,
        scopes: [this.roomScope()],
        expect: "int",
        path: `spawn.budget.lines[${i}].budget`,
      });
    });
    b.switches?.forEach((s, i) =>
      this.expr({
        source: s.by,
        scopes: [{ ...this.roomScope(), ctx: { record: { budget: "int" } } }],
        expect: "int",
        path: `spawn.budget.switches[${i}].by`,
      }),
    );
  }

  /**
   * `strikes` (house decision #99): every expression in the scope of each attacker type, with `ctx` holding the inputs,
   * the means' values, the target's scope for each target type and the mobs' sizes; the outcomes also read the figures
   * and the typed total, the notes the outcome too. Read by `planStrike` from the manifest's own text.
   */
  private strikes(actorsOf: (ids: readonly string[] | undefined) => { ce: CompiledEntity }[]): void {
    this.r.strikes?.forEach((s, i) => {
      const path = `strikes[${i}]`;
      const targets = actorsOf(strikeTargets(this.r, s)).map(({ ce }) => ce.scope);
      const values = Object.fromEntries(
        Object.entries(s.values ?? {}).map(([k, v]): [string, ExprType] => [
          k,
          v.type === "list" ? { list: "text" } : v.type,
        ]),
      );
      const base: Record<string, ExprType> = {
        ...Object.fromEntries((s.inputs ?? []).map((x) => [x.id, x.type === "choice" ? "int" : x.type])),
        means: { record: values },
        attackerMob: "int",
        targetMob: "int",
      };
      const scopes = (extra: Record<string, ExprType>) =>
        actorsOf(s.entities).flatMap(({ ce }) =>
          targets.map((t) => ({ ...ce.scope, ctx: { record: { ...base, target: { record: t }, ...extra } } })),
        );
      const figures = scopes({});
      const figure = (f: StrikeFigure | undefined, at: string) => {
        if (f === undefined) return;
        this.expr({ source: f.expr, scopes: figures, expect: "int", path: `${at}.expr` });
        f.adds?.forEach((a, j) => {
          if (a.when !== undefined)
            this.expr({ source: a.when, scopes: figures, expect: "bool", path: `${at}.adds[${j}].when` });
          this.expr({ source: a.by, scopes: figures, expect: "int", path: `${at}.adds[${j}].by` });
        });
      };
      figure(s.pool, `${path}.pool`);
      figure(s.beat, `${path}.beat`);
      figure(s.soak, `${path}.soak`);
      s.shows?.forEach((f, j) => figure(f, `${path}.shows[${j}]`));
      const read: Record<string, ExprType> = {
        pool: "int",
        beat: "int",
        ...(s.soak === undefined ? {} : { soak: "int" as const }),
        total: "int",
      };
      const typed = scopes(read);
      s.outcomes.forEach((o, j) => {
        const at = `${path}.outcomes[${j}]`;
        this.expr({ source: o.when, scopes: typed, expect: "bool", path: `${at}.when` });
        if (o.wounds !== undefined) this.expr({ source: o.wounds, scopes: typed, expect: "int", path: `${at}.wounds` });
        if (o.shock !== undefined) this.expr({ source: o.shock, scopes: typed, expect: "int", path: `${at}.shock` });
      });
      const after = scopes({ ...read, outcome: "text" });
      s.notes?.forEach((n, j) => {
        if (n.when !== undefined)
          this.expr({ source: n.when, scopes: after, expect: "bool", path: `${path}.notes[${j}].when` });
      });
    });
  }

  /**
   * `panels` (house decision #114): `when`, each line's `when` and each figure in the scope of each actor type that shows
   * it, plus `ctx.self` and `ctx.fight`; the options' `usable` also reads `entry`, the listed entry type's fields. The
   * phone reads them from the manifest's own text.
   */
  private panels(actorsOf: (ids: readonly string[] | undefined) => { ce: CompiledEntity }[]): void {
    this.r.panels?.forEach((p, i) => {
      const path = `panels[${i}]`;
      const scopes = actorsOf(p.entities).map(({ ce }) => ({ ...ce.scope, ctx: { record: SPEND_CTX } }));
      if (p.when !== undefined) this.expr({ source: p.when, scopes, expect: "bool", path: `${path}.when` });
      p.lines?.forEach((l, j) => {
        if (l.when !== undefined)
          this.expr({ source: l.when, scopes, expect: "bool", path: `${path}.lines[${j}].when` });
      });
      p.figures?.forEach((f, j) =>
        this.expr({ source: f.expr, scopes, expect: "int", path: `${path}.figures[${j}].expr` }),
      );
      const o = p.options;
      const entry = o === undefined ? undefined : this.r.entities.find((e) => e.id === o.entry);
      if (o?.usable !== undefined && entry !== undefined) {
        const withEntry = scopes.map((s) => ({ ...s, entry: { record: fieldScope(entry.fields) } }));
        this.expr({ source: o.usable, scopes: withEntry, expect: "bool", path: `${path}.options.usable` });
      }
    });
  }

  /** What a spawn reads of the room: `campaign`, and `party` with `seated` (house decision #92). */
  private roomScope(): Record<string, ExprType> {
    return { party: SPAWN_PARTY_SCOPE, ...this.campaignRoot() };
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

    // The compiled actor types a Test or a health state applies to: the ones it names, or all of them.
    const actorsOf = (ids: readonly string[] | undefined) =>
      this.actorEntities().flatMap((e) => {
        const ce = own(entities, e.id);
        return ce === undefined || (ids !== undefined && !ids.includes(e.id)) ? [] : [{ e, ce }];
      });

    const tests: Record<string, CompiledTest> = {};
    for (const [id, t] of Object.entries(this.r.tests)) {
      // A mark reads as a yes-or-no input (house decision #80).
      const marks = Object.fromEntries(Object.keys(t.marks ?? {}).map((k) => [k, "bool" as const]));
      const ctx: ExprType = { record: { ...t.inputs, ...marks } };
      // A choice the taker sets when reporting (house decision #170) is read by the target and the offers only.
      const choices = Object.fromEntries(
        Object.entries(t.choices ?? {}).map(([k, c]) => [
          k,
          c.max === undefined ? ("bool" as const) : ("int" as const),
        ]),
      );
      const taken: ExprType = { record: { ...t.inputs, ...marks, ...choices } };
      const takers = actorsOf(t.entities);
      const scopes = takers.map(({ ce }) => ({ ...ce.scope, ctx }));
      const takenScopes = takers.map(({ ce }) => ({ ...ce.scope, ctx: taken }));
      // A reported Test has no numbers: the constant 0 keeps every reader of a compiled Test one shape.
      const modifier = this.expr({
        source: t.kind === "reported" ? "0" : t.modifier,
        scopes,
        expect: "int",
        path: `tests.${id}.modifier`,
      });
      const target = this.expr({
        source: t.kind === "reported" ? "0" : t.target,
        scopes: takenScopes,
        expect: "int",
        path: `tests.${id}.target`,
      });
      const pool =
        t.kind === "poolSuccesses"
          ? this.expr({ source: t.pool, scopes, expect: "int", path: `tests.${id}.pool` })
          : null;
      if (modifier === null || target === null || (t.kind === "poolSuccesses" && pool === null)) continue;
      const offers: CompiledOffer[] = [];
      let offersCompile = true;
      (t.offers ?? []).forEach((o, i) => {
        const at = `tests.${id}.offers[${i}]`;
        const when = this.expr({
          source: o.when,
          scopes: [{ ctx: taken, result: RESULT_SCOPE }],
          expect: "bool",
          path: `${at}.when`,
        });
        const changes = o.changes.map((c, j) => ({
          pool: c.pool ?? null,
          resource: c.resource ?? null,
          by: this.expr({
            source: c.by,
            scopes: takenScopes.map((x) => ({ ...x, result: RESULT_SCOPE })),
            expect: "int",
            path: `${at}.changes[${j}].by`,
          }),
        }));
        const whole = changes.flatMap((c) => (c.by === null ? [] : [{ ...c, by: c.by }]));
        if (when === null || whole.length < changes.length) offersCompile = false;
        else offers.push({ def: o, when, changes: whole });
      });
      if (!offersCompile) continue;
      // A value the call computes for an actor is as hidden as its most hidden input, like a derived value.
      const seen = (...exprs: CompiledExpr[]) => this.seenBy(takers, exprs);
      const modifierVisibility = pool === null ? seen(modifier) : seen(modifier, pool);
      // Who may be told what the offers work out on a taker (house decision #170): their changes read its scope.
      const offerVisibility = seen(...offers.flatMap((o) => o.changes.map((c) => c.by)));
      tests[id] = {
        def: t,
        offers,
        modifier,
        target,
        pool,
        modifierVisibility,
        targetVisibility: seen(target),
        offerVisibility,
      };
    }

    const init = this.r.initiative;
    const ranked = init?.strategy === "ranked" ? init : null;
    const score =
      ranked === null
        ? null
        : this.expr({ source: ranked.score, scopes: actorScopes, expect: "int", path: "initiative.score" });
    const tiebreak = (ranked?.tiebreak ?? []).map((src, j) =>
      this.expr({ source: src, scopes: actorScopes, expect: "int", path: `initiative.tiebreak[${j}]` }),
    );

    const scoring = this.scoring(actorScopes);
    const healthStates = this.r.health.states.flatMap((s, j) => {
      const scopes = actorsOf(s.entities).map(({ ce }) => ce.scope);
      const when = this.expr({ source: s.when, scopes, expect: "bool", path: `health.states[${j}].when` });
      return when === null ? [] : [{ id: s.id, label: s.label, when, entities: s.entities ?? null }];
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

    // `health.harm` (house decision #66): checked here, read by the primitive from the manifest's own text.
    this.r.health.harm?.profiles.forEach((p, j) => {
      const scopes = actorsOf(p.entities).map(({ ce }) => ce.scope);
      const path = `health.harm.profiles[${j}]`;
      const check = (source: string | undefined, expect: "bool" | "int", at: string) => {
        if (source !== undefined) this.expr({ source, scopes, expect, path: `${path}.${at}` });
      };
      check(p.shockless, "bool", "shockless");
      check(p.spent?.when, "bool", "spent.when");
      check(p.felled?.when, "bool", "felled.when");
      check(p.felled?.healTo, "int", "felled.healTo");
      check(p.destroyed?.over, "int", "destroyed.over");
      check(p.destroyed?.when, "bool", "destroyed.when");
    });

    const notices = (this.r.notices ?? []).flatMap((n, j): CompiledNotice[] => {
      const takers = actorsOf(n.entities);
      // A ledger actor's notices also read its play as `build` (house decision #168).
      const scopes = takers.map(({ e, ce }) =>
        e.id === this.r.build?.actor ? { ...ce.scope, build: { record: NOTICE_BUILD_SCOPE } } : ce.scope,
      );
      const path = `notices[${j}]`;
      const when = this.expr({ source: n.if, scopes, expect: "bool", path: `${path}.if` });
      // A rule that rises reads how far it rose in this action as `ctx.rose` in its params (house decision #174).
      const paramScopes =
        n.rises === undefined ? scopes : scopes.map((s) => ({ ...s, ctx: { record: { rose: "int" as const } } }));
      const params = sortedEntries(n.params ?? {}).map(
        ([name, source]) => [name, this.expr({ source, scopes: paramScopes, path: `${path}.params.${name}` })] as const,
      );
      const rises =
        n.rises === undefined ? null : this.expr({ source: n.rises, scopes, expect: "int", path: `${path}.rises` });
      const whole = params.flatMap(([name, x]) => (x === null ? [] : [[name, x] as const]));
      if (when === null || whole.length < params.length || (n.rises !== undefined && rises === null)) return [];
      const read = whole.map(([, x]) => x);
      const visibility = this.seenBy(takers, [when, ...read, ...(rises === null ? [] : [rises])]);
      return [
        {
          id: n.id,
          when: n.when,
          entities: n.entities ?? null,
          if: when,
          text: n.text,
          params: Object.fromEntries(whole),
          group: n.group ?? null,
          rises,
          visibility,
        },
      ];
    });
    const reminders = (this.r.reminders ?? []).map((x, j) =>
      x.if === undefined
        ? null
        : this.expr({
            source: x.if,
            scopes: actorsOf(x.entities).map(({ ce }) => ({ ...ce.scope, ...REMINDER_SCOPE })),
            expect: "bool",
            path: `reminders[${j}].if`,
          }),
    );
    // A codex reminder's `if` reads its kind's fields (house decision #89); checked here, evaluated where it is shown.
    for (const kind of Object.keys(this.r.codex?.kinds ?? {}).sort()) {
      const k = own(this.r.codex?.kinds ?? {}, kind);
      k?.reminders?.forEach((x, j) => {
        const scope = codexScope({ fields: k.fields, campaign: this.r.campaignFields });
        this.expr({ source: x.if, scopes: [scope], expect: "bool", path: `codex.kinds.${kind}.reminders[${j}].if` });
      });
    }
    // A rows field's Test inputs read the campaign fields and the row's values (house decision #173).
    for (const kind of Object.keys(this.r.codex?.kinds ?? {}).sort()) {
      const k = own(this.r.codex?.kinds ?? {}, kind);
      for (const id of Object.keys(k?.fields ?? {}).sort()) {
        const def = own(k?.fields ?? {}, id);
        if (def?.type !== "rows") continue;
        const scope = { ...codexScope({ fields: {}, campaign: this.r.campaignFields }), values: rowScope(def.columns) };
        def.columns.forEach((c, i) => {
          if (c.type !== "test") return;
          for (const [name, source] of sortedEntries(c.inputs ?? {}))
            this.expr({
              source,
              scopes: [scope],
              path: `codex.kinds.${kind}.fields.${id}.columns[${i}].inputs.${name}`,
            });
        });
      }
    }
    // A checklist step's room value reads the campaign fields (house decision #173).
    this.r.checklist?.forEach((x, j) => {
      if (x.now === undefined) return;
      const scope = codexScope({ fields: {}, campaign: this.r.campaignFields });
      this.expr({ source: x.now, scopes: [scope], path: `checklist[${j}].now` });
    });
    // A generator's `when`, `filter` and `each.times` read the steps above them (house decision #98).
    this.r.generators?.forEach((g, i) =>
      this.problems.push(...generatorExprProblems({ r: this.r, g, path: `generators[${i}]` })),
    );
    const immune: Record<string, CompiledExpr> = {};
    this.r.conditions.forEach((c, j) => {
      const im = immuneOf(c);
      if (im === null) return;
      const expr = this.expr({
        source: im.if,
        scopes: actorsOf(im.entities ?? undefined).map(({ ce }) => ce.scope),
        expect: "bool",
        path: `conditions[${j}].immune`,
      });
      if (expr !== null) immune[c.id] = expr;
    });
    this.spends(actorsOf);
    this.acquire(actorsOf);
    this.spawn();
    this.strikes(actorsOf);
    this.panels(actorsOf);

    const lookups = this.lookups(actorsOf);

    if (this.problems.length > 0 || scoring === undefined || (ranked !== null && score === null)) return null;
    const b = this.r.build;
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
          : init === undefined
            ? null
            : { def: init as SeatedInitiative | SidesInitiative, score: null, tiebreak: [] },
      healthStates,
      instantDeath,
      build: b === undefined ? null : { actor: b.actor, params: b.params, kinds: b.kinds },
      notices,
      reminders,
      immune,
      lookups,
    };
  }

  /**
   * Each table with a die (house decision #87): the modifier and every effect's expressions over the target's scope,
   * for each actor type the table applies to, with the inputs as `ctx`.
   */
  private lookups(
    actorsOf: (ids: readonly string[] | undefined) => { e: EntityType; ce: CompiledEntity }[],
  ): Record<string, CompiledLookup> {
    const out: Record<string, CompiledLookup> = {};
    for (const [id, t] of Object.entries(this.r.tables ?? {})) {
      if (t.die === undefined) continue;
      const ctx: ExprType = { record: Object.fromEntries((t.inputs ?? []).map((x) => [x.id, x.type])) };
      const scopes = actorsOf(t.entities).map(({ ce }) => ({ ...ce.scope, ctx }));
      const at = `tables.${id}`;
      const one = (source: string | undefined, expect: "int" | "bool", path: string) =>
        source === undefined ? null : this.expr({ source, scopes, expect, path });
      out[id] = {
        modifier: one(t.modifier, "int", `${at}.modifier`),
        effects: t.entries.map((e, i) =>
          (e.apply ?? []).map((x, j) => {
            const path = `${at}.entries[${i}].apply[${j}]`;
            return {
              def: x,
              when: one(x.when, "bool", `${path}.when`),
              times: one(x.times, "int", `${path}.times`),
              wounds: one(x.kind === "harm" ? x.wounds : undefined, "int", `${path}.wounds`),
              shock: one(x.kind === "harm" ? x.shock : undefined, "int", `${path}.shock`),
              by: one(x.kind === "resource" || x.kind === "pool" ? x.by : undefined, "int", `${path}.by`),
            };
          }),
        ),
      };
    }
    return out;
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

/**
 * The compiled effects of the entries an actor of type `entity` chose, against that type alone. An effect that does
 * not compile for it (the pack was written for another version) contributes nothing, never an error.
 */
export function compileEntryEffects({
  compiled,
  entity,
  entries,
}: {
  compiled: CompiledRuleset;
  entity: string;
  entries: readonly ActiveEntry[];
}): CompiledEffect[] {
  const def = own(compiled.entities, entity)?.def;
  if (def === undefined || entries.length === 0) return [];
  const hits = new Compiler(compiled.ruleset).entryEffects({
    entries,
    pool: [def],
    entities: compiled.entities,
    pathOf: () => "",
  });
  return hits.map((h) => h.effect);
}

/**
 * Problems of the effects of `entries` against every actor type in `pool` (the ones a `choose` step picks them
 * for); `pathOf` places each one in the pack. Empty when the ruleset does not compile (it was refused on import).
 */
export function entryEffectProblems({
  ruleset,
  entries,
  pool,
  pathOf,
}: {
  ruleset: Ruleset;
  entries: readonly ActiveEntry[];
  pool: readonly EntityType[];
  pathOf: (entry: number, effect: number) => string;
}): Problem[] {
  const compiled = compileRuleset(ruleset);
  if (!compiled.ok) return [];
  const compiler = new Compiler(compiled.compiled.ruleset);
  compiler.entryEffects({ entries, pool, entities: compiled.compiled.entities, pathOf });
  return compiler.problems;
}
