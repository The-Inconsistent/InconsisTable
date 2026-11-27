import type { Actor, LiveState } from "@inconsistable/core-schema";
import {
  actorScope,
  evaluate,
  fightOf,
  parseExpr,
  withLists,
  type EntityType,
  type ExprRecord,
  type ExprValue,
  type LayoutRow,
  type LayoutTarget,
  type Panel,
  type PanelOptions,
  type Ruleset,
} from "@inconsistable/rules-engine";

import { turnOf } from "@/lib/fight/fight";
import type { RulesEntry } from "@/lib/library/library";
import { SHARED_LAYOUT } from "@/lib/sheet/sheet";

// The phone's panels (house decision #114), read from the seat's own manifest and what this seat was sent. A panel
// changes no number: this only decides whether it holds and which of its lines and figures show.

type Table = Pick<LiveState, "encounter" | "campaign">;

/** The rows a layout target holds for this character's type: its own layout's, else the shared one's; null when absent. */
export function layoutRows({
  ruleset,
  entity,
  target,
}: {
  ruleset: Ruleset;
  entity: string | null;
  target: LayoutTarget;
}): readonly LayoutRow[] | null {
  const own = entity !== null && Object.hasOwn(ruleset.layout, entity) ? ruleset.layout[entity] : undefined;
  return (own ?? ruleset.layout[SHARED_LAYOUT])?.[target] ?? null;
}

/** The panel a layout row names, when it is a panel row. */
export const panelOfRow = (ruleset: Ruleset, row: LayoutRow): Panel | undefined =>
  typeof row === "string" || row.widget !== "panel" ? undefined : ruleset.panels?.find((p) => p.id === row.variant);

/** The character's scope with `ctx.self` and `ctx.fight`, as a panel's expressions read it. */
export function panelScope({
  ruleset,
  actor,
  table,
  characters,
}: {
  ruleset: Ruleset;
  actor: Actor;
  table: Table;
  characters: number;
}): ExprRecord {
  const scope = withLists({
    ruleset,
    scope: actorScope({
      fields: actor.fields,
      derived: actor.derived,
      resources: actor.resources,
      party: { characters },
      campaign: table.campaign.fields,
    }),
  });
  return { ...scope, ctx: { self: actor.id, fight: fightOf({ turn: turnOf(table.encounter) }, actor.id) } };
}

/** An expression read in a scope; undefined when it cannot be (a value the seat was not sent). */
function read(source: string, scope: ExprRecord): ExprValue | undefined {
  try {
    return evaluate({ node: parseExpr(source), scope });
  } catch {
    return undefined;
  }
}

export type PanelNow = {
  panel: Panel;
  lines: { text: string; cite: string | null }[];
  figures: { label: string; value: number; cite: string | null }[];
};

/**
 * The panel as it holds now for this character, or null: not for its type, its health state `holds` does not hold or
 * `unless` does (states are the fight's, so outside a fight none holds), or its `when` does not hold. Only the lines whose
 * `when` holds and the figures that read a number are kept.
 */
export function panelNow({
  ruleset,
  panel,
  actor,
  table,
  characters,
}: {
  ruleset: Ruleset;
  panel: Panel;
  actor: Actor;
  table: Table;
  characters: number;
}): PanelNow | null {
  if (actor.entity === null || (panel.entities !== undefined && !panel.entities.includes(actor.entity))) return null;
  const states = table.encounter?.combatants.find((c) => c.actorId === actor.id)?.states.map((s) => s.id) ?? [];
  if (panel.holds !== undefined && !states.includes(panel.holds)) return null;
  if (panel.unless !== undefined && states.includes(panel.unless)) return null;
  const scope = panelScope({ ruleset, actor, table, characters });
  const holds = (source: string | undefined) => source === undefined || read(source, scope) === true;
  if (!holds(panel.when)) return null;
  return {
    panel,
    lines: (panel.lines ?? []).filter((l) => holds(l.when)).map((l) => ({ text: l.text, cite: l.cite ?? null })),
    figures: (panel.figures ?? []).flatMap((f) => {
      const value = read(f.expr, scope);
      return typeof value === "number" ? [{ label: f.label, value, cite: f.cite ?? null }] : [];
    }),
  };
}

export type OptionLine = {
  key: string;
  name: string;
  summary: string;
  cite: string | null;
  usable: boolean;
  /** The entry's own words for what it needs, shown beside a sunk one. */
  needs: string | null;
};
export type OptionGroup = { key: string; label: string | null; lines: OptionLine[] };

/** An entry's values as `entry` reads them: each declared field, its value or the type's empty one. */
function entryRecord(def: EntityType, body: Readonly<Record<string, unknown>>): ExprRecord {
  const out: Record<string, ExprValue> = {};
  for (const [id, f] of Object.entries(def.fields)) {
    const v = Object.hasOwn(body, id) ? body[id] : undefined;
    if (f.type === "int") out[id] = typeof v === "number" ? v : 0;
    else if (f.type === "bool") out[id] = typeof v === "boolean" ? v : false;
    else if (f.type === "list") out[id] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    else out[id] = typeof v === "string" ? v : "";
  }
  return out;
}

/**
 * The entries a panel lists (house decision #114), grouped by the `group` field in the order the groups first appear,
 * each with the importer's summary (its first text field other than `needs`) and cite; within a group the ones `usable`
 * does not hold for sink below the rest, with the entry's `needs`.
 */
export function optionGroups({
  ruleset,
  options,
  entries,
  scope,
}: {
  ruleset: Ruleset;
  options: PanelOptions;
  entries: readonly RulesEntry[];
  scope: ExprRecord;
}): OptionGroup[] {
  const def = ruleset.entities.find((e) => e.id === options.entry);
  if (def === undefined) return [];
  const groupDef = options.group === undefined ? undefined : def.fields[options.group];
  const groups = new Map<string, OptionGroup>();
  for (const e of entries.filter((x) => x.type === options.entry)) {
    const raw = options.group === undefined ? "" : e.body[options.group];
    const key = raw === undefined || raw === null ? "" : String(raw);
    const words = groupDef?.type === "enum" ? groupDef.labels : undefined;
    const label = key === "" ? null : words !== undefined && Object.hasOwn(words, key) ? (words[key] ?? key) : key;
    const usable =
      options.usable === undefined || read(options.usable, { ...scope, entry: entryRecord(def, e.body) }) === true;
    const text = (id: string | undefined) => {
      const v = id === undefined ? undefined : e.body[id];
      return typeof v === "string" && v !== "" ? v : null;
    };
    const summaryField = Object.entries(def.fields).find(([id, f]) => f.type === "text" && id !== options.needs)?.[0];
    const line: OptionLine = {
      key: `${e.pack}/${e.key}`,
      name: e.name,
      summary: text(summaryField) ?? e.tags.join(", "),
      cite: e.cite,
      usable,
      needs: usable ? null : text(options.needs),
    };
    const g = groups.get(key) ?? { key, label, lines: [] };
    g.lines.push(line);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    lines: [...g.lines].sort((a, b) => Number(b.usable) - Number(a.usable)),
  }));
}
