import type { BookPage, ConditionTimer } from "@inconsistable/core-schema";
import {
  actorScope,
  resourceBounds,
  type CompiledRuleset,
  stepsFor,
  type FieldValue,
  type LayoutRow,
  type ResetEvent,
  type Ruleset,
  withLists,
} from "@inconsistable/rules-engine";

import { harmOnly } from "../harm/harm.ts";
import { rowFor, type SheetActor, type SheetRow, type WidgetModel, widgetOf } from "../sheet-widgets/sheet-widgets.ts";
import { leftOf } from "../track/track.ts";

// The sheet's pure side: which rows a ruleset's `layout` puts on a character, who may step a resource, which rests the
// manifest declares, and how a printed cite becomes a page of the GM's book. Values never come from here: they are the
// server's, already filtered for the seat (CLAUDE.md, principle 6).

export type { SheetActor, SheetRow } from "../sheet-widgets/sheet-widgets.ts";

/** A run of value rows, or one widget, in the order the layout lists them. */
export type SheetPart = { kind: "rows"; rows: SheetRow[] } | { kind: "widget"; model: WidgetModel };
/** A section of the sheet. `label` is the ruleset's own; null for the three built-in ones, named by the `sheet.section` messages. */
export type SheetSection = { id: string; label: string | null; parts: SheetPart[] };

/** The layout key a ruleset may use for every entity that has no layout of its own. */
export const SHARED_LAYOUT = "sheet";

/** A section's rows as parts: consecutive value rows run together, each widget stands alone; nothing drawn is dropped. */
export function partsOf({ ruleset, actor, show }: { ruleset: Ruleset; actor: SheetActor; show: readonly LayoutRow[] }) {
  const parts: SheetPart[] = [];
  for (const item of show) {
    if (typeof item !== "string") {
      const model = widgetOf({ ruleset, actor, row: item });
      if (model) parts.push({ kind: "widget", model });
      continue;
    }
    const row = rowFor({ ruleset, actor, path: item });
    if (!row) continue;
    const last = parts.at(-1);
    if (last?.kind === "rows") last.rows.push(row);
    else parts.push({ kind: "rows", rows: [row] });
  }
  return parts;
}

const rowsPart = (rows: SheetRow[]): SheetPart[] => (rows.length > 0 ? [{ kind: "rows", rows }] : []);

/** Sections in layout order. No layout for the entity: derived values, then resources, then fields. */
export function sectionsOf({ ruleset, actor }: { ruleset: Ruleset; actor: SheetActor }): SheetSection[] {
  const def = ruleset.entities.find((e) => e.id === actor.entity);
  if (!def) return [];
  const layout = ruleset.layout[actor.entity] ?? ruleset.layout[SHARED_LAYOUT];
  const sections: SheetSection[] = layout
    ? layout.sections.map((s) => ({ id: s.id, label: s.label, parts: partsOf({ ruleset, actor, show: s.show }) }))
    : [
        {
          id: "derived",
          label: null,
          parts: rowsPart(def.derived.flatMap((d) => rowFor({ ruleset, actor, path: `derived.${d.id}` }) ?? [])),
        },
        {
          id: "resources",
          label: null,
          parts: rowsPart(ruleset.resources.flatMap((r) => rowFor({ ruleset, actor, path: `res.${r.id}` }) ?? [])),
        },
        {
          id: "fields",
          label: null,
          parts: rowsPart(
            Object.keys(def.fields).flatMap((f) =>
              f in actor.fields ? (rowFor({ ruleset, actor, path: f }) ?? []) : [],
            ),
          ),
        },
      ];
  return sections.filter((s) => s.parts.length > 0);
}

/** The value rows of a section, in order (widgets left out). */
export const rowsOf = (s: SheetSection): SheetRow[] => s.parts.flatMap((p) => (p.kind === "rows" ? p.rows : []));

/** The value rows a widget draws, in order: the ones a guide can name. Cards, folds and held records name none. */
function modelRows(m: WidgetModel): (SheetRow | null)[] {
  switch (m.widget) {
    case "strip":
      return [m.title, ...m.values];
    case "grid":
      return m.rows.flatMap((r) => [r.rating, r.bonus, r.total, r.link]);
    case "frames":
      return m.values;
    case "sum":
      return [...m.parts, m.total];
    case "track":
      return [m.value, m.max];
    case "pips":
      return [m.value];
    case "notes":
      return m.fields;
    default:
      return [];
  }
}

/** A section of HOW TO READ THIS SHEET (house decision #126): its label and the rows in it that say what they mean. */
export type GuideSection = { id: string; label: string | null; terms: SheetRow[] };

/** The sheet's own sections, each with its rows that carry a summary, once each; a section with none is left out. */
export function guideOf(sections: readonly SheetSection[]): GuideSection[] {
  const seen = new Set<string>();
  return sections.flatMap((s) => {
    const terms = s.parts
      .flatMap((p) => (p.kind === "rows" ? p.rows : modelRows(p.model)))
      .flatMap((r) => {
        const key = r && `${r.kind}.${r.id}`;
        if (!r?.summary || !key || seen.has(key)) return [];
        seen.add(key);
        return [r];
      });
    return terms.length > 0 ? [{ id: s.id, label: s.label, terms }] : [];
  });
}

/** The fewest sections a sheet has before it gets a strip of links to them at the top. */
export const JUMP_FROM = 4;
/** Whether a sheet is long enough for the strip of links to its sections. */
export const showJump = (sections: readonly SheetSection[]): boolean => sections.length >= JUMP_FROM;

/** A field value as the sheet prints it. */
export function printValue({ value: v, yes, no }: { value: FieldValue | undefined; yes: string; no: string }): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? yes : no;
  return Array.isArray(v) ? (v.length ? v.join(", ") : "—") : String(v);
}

/** Which of the − and + a resource gets: the GM's seat both, a player's by the resource's `editableBy`. */
export function stepsOf({ ruleset, resource, gm }: { ruleset: Ruleset; resource: string; gm: boolean }): {
  dec: boolean;
  inc: boolean;
} {
  const r = ruleset.resources.find((x) => x.id === resource);
  // A health track's resource moves only through the track, whose ops need `encounter:run`; a harm one only through a
  // hit or a muster, for every seat (house decision #66).
  const trackOnly = !gm && ruleset.health.tracks.some((t) => t.resource === resource);
  if (!r || trackOnly || harmOnly(ruleset).has(resource)) return { dec: false, inc: false };
  return stepsFor({ editableBy: r.editableBy, gmSide: gm });
}

/**
 * Whether a player may ask the GM to spend this resource (house decision #43): a visible, entity-scoped one they cannot
 * change themselves, outside a health track and `health.harm`.
 */
export function canAskToSpend({ ruleset, resource }: { ruleset: Ruleset; resource: string }): boolean {
  const r = ruleset.resources.find((x) => x.id === resource);
  if (!r || r.scope !== "entity" || r.visibility === "gm") return false;
  if (ruleset.health.tracks.some((t) => t.resource === resource) || harmOnly(ruleset).has(resource)) return false;
  const { dec, inc } = stepsFor({ editableBy: r.editableBy, gmSide: false });
  return !dec && !inc;
}

/**
 * The `rule.op` that moves one resource of one character by `delta`. A health track's resource goes through the track
 * (damage or heal, so dying and temporary points apply); any other resource is a clamped adjust the server applies.
 */
export function stepAction({
  ruleset,
  actorId,
  resource,
  delta,
}: {
  ruleset: Ruleset;
  actorId: string;
  resource: string;
  delta: number;
}) {
  if (ruleset.health.tracks.some((t) => t.resource === resource)) {
    return delta < 0
      ? ({
          type: "rule.op",
          primitive: "health.tracks",
          op: "damage",
          input: { actorId, amount: -delta, track: resource, critical: false },
        } as const)
      : ({
          type: "rule.op",
          primitive: "health.tracks",
          op: "heal",
          input: { actorId, amount: delta, track: resource },
        } as const);
  }
  return { type: "rule.op", primitive: "resource.capped", op: "adjust", input: { actorId, resource, delta } } as const;
}

/** The rests the manifest declares, in the order the table says them. A rest nothing resets on is not offered. */
export const REST_BUTTONS = [{ event: "shortRest" }, { event: "longRest" }] as const satisfies readonly {
  event: ResetEvent;
}[];

export function restsOf(ruleset: Ruleset) {
  const declared = new Set(ruleset.resources.flatMap((r) => r.resetOn.map((x) => x.event)));
  return REST_BUTTONS.filter((b) => declared.has(b.event));
}

/** When each resource refills, for its chip. */
export function resetsOn({ ruleset, resource }: { ruleset: Ruleset; resource: string }): ResetEvent[] {
  return ruleset.resources.find((r) => r.id === resource)?.resetOn.map((x) => x.event) ?? [];
}

/** A resource's bounds for this character, when the formulas can be worked out here; null shows the bare value. */
export function rangeOf({
  compiled,
  resource,
  actor,
  characters,
  campaign,
}: {
  compiled: CompiledRuleset;
  resource: string;
  actor: SheetActor;
  characters: number;
  /** The campaign's values in play (`state.campaign.fields`); a bound that reads `campaign.*` needs them. */
  campaign?: Readonly<Record<string, number | string | boolean>>;
}): { min: number; max: number | null } | null {
  try {
    const scope = withLists({
      ruleset: compiled.ruleset,
      scope: actorScope({
        fields: actor.fields,
        derived: actor.derived,
        resources: actor.resources,
        party: { characters },
        campaign,
      }),
    });
    const { min, max } = resourceBounds({ compiled, resource, scope });
    return { min, max };
  } catch {
    return null;
  }
}

/**
 * The book page a cite such as "Core p.164" or "Sample p.8-9" points at (the first page), when the cite names one of
 * the ruleset's sources by id or by the start of its title; a ruleset with one source needs no name.
 */
export function pageOfCite({ cite, ruleset }: { cite: string; ruleset: Ruleset }): BookPage | null {
  const m = /^(.*?)\s*\bp{1,2}\.?\s*(\d+)/i.exec(cite);
  const page = Number(m?.[2]);
  if (!m || !Number.isInteger(page) || page < 1) return null;
  const name = (m[1] ?? "").trim().toLowerCase();
  const source =
    ruleset.sources.find(
      (s) => name !== "" && (s.id.toLowerCase() === name || s.title.toLowerCase().startsWith(name)),
    ) ?? (name === "" && ruleset.sources.length === 1 ? ruleset.sources[0] : undefined);
  return source ? { source: source.id, page } : null;
}

/** What is left of a condition's count (2 rounds, 1 turn), or null when the condition has no count or no timer. */
export function timeLeft({ timers, id }: { timers: readonly ConditionTimer[]; id: string }) {
  const t = timers.find((x) => x.id === id);
  return t ? leftOf({ left: t.expiresAfter, expiresOn: t.expiresOn }) : null;
}
