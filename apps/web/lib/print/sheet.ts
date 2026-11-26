import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { boxKinds, itemLines, withFitted, type ItemLine } from "../items/items.ts";
import { sheetLinesOf, type LedgerSheetLines } from "../ledger/table.ts";
import { printValue, sectionsOf, type SheetRow } from "../sheet/sheet.ts";
import {
  effectOf,
  ledgerLaidOut,
  numberOf,
  signed,
  type PipStep,
  type SheetActor,
  type WidgetModel,
} from "../sheet-widgets/sheet-widgets.ts";

import { MAX_TRACK_BOXES, PENCIL_LINES } from "./constants.ts";

// The printed character sheet (issue #4, house decision #151): the ruleset's sheet layout reflowed onto paper. It is
// built from `sectionsOf`, so it holds only what this seat received: a value the seat was not sent is not on the
// paper. What a pencil changes during play (resources, tracks, pips, conditions, notes) prints blank.

/** The `print` namespace's words a printed page reads (next-intl's `t`, narrowed to a plain function). */
export type PrintWords = (key: string, values?: Record<string, string | number>) => string;

/** One value in a box: its label and printed value, or blank for pencil with its limit beside it. */
export type PrintCell = { label: string; value: string; cite: string | null; pencil: boolean; max: string | null };
export type PrintItem = { name: string; detail: string | null; cite: string | null };
export type PrintBlock =
  | { kind: "cells"; label: string | null; cells: PrintCell[] }
  | { kind: "boxes"; label: string; boxes: number; cite: string | null }
  | { kind: "pips"; label: string; steps: PipStep[] }
  | { kind: "table"; label: string | null; head: string[]; rows: string[][] }
  | { kind: "list"; label: string | null; items: PrintItem[] }
  | { kind: "text"; label: string; text: string; lines: number };
export type PrintSection = { title: string; blocks: PrintBlock[] };
export type PrintedSheet = { name: string; sections: PrintSection[] };

export type PrintActor = SheetActor & Pick<Actor, "name" | "conditions">;

type Env = { ruleset: Ruleset; actor: PrintActor; t: PrintWords; maxOf: (resource: string) => number | null };

const valueText = ({ actor, row, t }: Pick<Env, "actor" | "t"> & { row: SheetRow }): string =>
  row.kind === "derived"
    ? String(actor.derived[row.id] ?? 0)
    : printValue({ value: actor.fields[row.id], yes: t("yes"), no: t("no") });

/** A value row as a box: a resource blank for pencil, with its limit when the formulas give one. */
function cellOf(env: Env, row: SheetRow): PrintCell {
  if (row.kind === "resource") {
    const max = env.maxOf(row.id);
    return { label: row.label, value: "", cite: row.cite, pencil: true, max: max === null ? null : String(max) };
  }
  return { label: row.label, value: valueText({ ...env, row }), cite: row.cite, pencil: false, max: null };
}

const cells = (env: Env, label: string | null, rows: readonly SheetRow[]): PrintBlock[] =>
  rows.length > 0 ? [{ kind: "cells", label, cells: rows.map((r) => cellOf(env, r)) }] : [];

const list = (label: string | null, items: PrintItem[]): PrintBlock[] =>
  items.length > 0 ? [{ kind: "list", label, items }] : [];

/** The items a block lists: name (and count), what is fitted to it, its cite. */
const itemList = (label: string | null, lines: readonly ItemLine[]): PrintBlock[] =>
  list(
    label,
    lines.map(({ item, fitted }) => ({
      name: item.quantity === null ? item.name : `${item.name} ×${item.quantity}`,
      detail: fitted.length > 0 ? fitted.map((f) => f.name).join(", ") : null,
      cite: item.cite,
    })),
  );

/** A saved build's lines of one card variant, as the `cards` widget reads them, with what is fitted to each. */
function cardBlocks({
  env,
  lines,
  variant,
  label,
}: {
  env: Env;
  lines: LedgerSheetLines;
  variant: "weapons" | "armour" | "gear" | "powers";
  label: string | null;
}): PrintBlock[] {
  const { t, actor } = env;
  const fitted = <T extends Record<string, unknown>>(ref: string, card: T) =>
    withFitted({ card, fitted: (actor.items ?? []).filter((x) => x.fittedLine === ref) });
  const by = (names: readonly string[]) => (names.length > 0 ? [t("with", { list: names.join(", ") })] : []);
  if (variant === "weapons") {
    if (lines.weapons.length === 0) return [];
    const rows = lines.weapons.map((line) => {
      const w = fitted(`weapons/${line.name}`, line);
      const rules = [
        t("range", { range: w.range.join(" / ") }),
        ...(w.salvo !== undefined && w.salvo !== null ? [t("salvo", { salvo: w.salvo })] : []),
        ...w.traits,
        ...by(w.by),
      ];
      return [
        w.count && w.count > 1 ? t("count", { name: w.name, count: w.count }) : w.name,
        `${w.damage} ${t("ed", { ed: String(w.ed) })}`,
        w.ap ? String(w.ap) : "–",
        rules.join(" · "),
      ];
    });
    return [{ kind: "table", label: label ?? t("weapons"), head: [t("name"), t("damage"), t("ap"), t("rules")], rows }];
  }
  if (variant === "armour") {
    const a = lines.armour && fitted(`armour/${lines.armour.name}`, lines.armour);
    return a
      ? list(label ?? t("armourTitle"), [
          { name: a.name, detail: [t("armour", { ar: a.ar }), ...a.traits, ...by(a.by)].join(" · "), cite: null },
        ])
      : [];
  }
  if (variant === "gear")
    return list(
      label ?? t("gear"),
      lines.gear.map((g) => ({ name: g, detail: null, cite: null })),
    );
  return list(
    label ?? t("powers"),
    lines.powers.map((p) => ({
      name: p.name,
      detail: [
        t("power", { dn: String(p.dn), activation: p.activation, duration: p.duration, range: p.range }),
        p.summary,
      ]
        .filter(Boolean)
        .join(" · "),
      cite: p.page,
    })),
  );
}

/** Talents and abilities, as the `folds` widget reads them: name, the importer's own summary, the page. */
function foldBlock({
  lines,
  variant,
  label,
  t,
}: {
  lines: LedgerSheetLines;
  variant: "both" | "talents" | "abilities";
  label: string | null;
  t: PrintWords;
}): PrintBlock[] {
  const entries = [
    ...(variant === "talents" ? [] : lines.abilities.map((r) => ({ ...r, talent: false }))),
    ...(variant === "abilities" ? [] : lines.talents.map((r) => ({ ...r, talent: variant === "both" }))),
  ];
  return list(
    label,
    entries.map((e) => ({
      name: e.talent ? `${e.name} (${t("talent")})` : e.name,
      detail: e.summary ?? null,
      cite: e.page ?? null,
    })),
  );
}

/** One widget as printed blocks. */
function widgetBlocks(env: Env, m: WidgetModel): PrintBlock[] {
  const { t, actor, ruleset } = env;
  switch (m.widget) {
    case "strip":
      return cells(env, m.label, [...(m.title ? [m.title] : []), ...m.values]);
    case "frames":
      return cells(env, m.label, m.values);
    case "sum":
      return cells(env, m.label, [...m.parts, m.total]);
    case "grid": {
      const head = [
        t("name"),
        ...(m.columns.link ? [t("link")] : []),
        t("rating"),
        ...(m.columns.bonus && m.variant === "columns" ? [t("bonus")] : []),
        ...(m.columns.total ? [t("total")] : []),
      ];
      const rows = m.rows.map((r) => [
        r.rating.label,
        ...(m.columns.link && r.link ? [r.link.label] : []),
        valueText({ actor, row: r.rating, t }),
        ...(m.columns.bonus && m.variant === "columns" && r.bonus ? [signed(numberOf({ actor, row: r.bonus }))] : []),
        ...(m.columns.total && r.total ? [valueText({ actor, row: r.total, t })] : []),
      ]);
      return [{ kind: "table", label: m.label, head, rows }];
    }
    case "track": {
      const label = m.label ?? m.value.label;
      const max = m.max ? numberOf({ actor, row: m.max }) : m.value.kind === "resource" ? env.maxOf(m.value.id) : null;
      return max !== null && max > 0 && max <= MAX_TRACK_BOXES
        ? [{ kind: "boxes", label, boxes: max, cite: m.value.cite }]
        : [
            {
              kind: "cells",
              label: null,
              cells: [
                { ...cellOf(env, m.value), label, value: "", pencil: true, max: max === null ? null : String(max) },
              ],
            },
          ];
    }
    case "pips":
      return [{ kind: "pips", label: m.label ?? m.value.label, steps: m.steps }];
    case "cards":
      return [
        ...cardBlocks({ env, lines: m.lines, variant: m.variant, label: m.label }),
        ...itemList(m.label, m.items),
      ];
    case "folds":
      return foldBlock({ lines: m.lines, variant: m.variant, label: m.label, t });
    case "notes":
      return m.fields.map((f) => {
        const text = valueText({ actor, row: f, t });
        const empty = text === "—";
        return {
          kind: "text",
          label: f.label,
          text: empty ? "" : text,
          lines: empty ? PENCIL_LINES.empty : PENCIL_LINES.filled,
        };
      });
    case "held":
      return m.groups.flatMap((g) =>
        list(
          g.label,
          g.records.map((r) => ({
            name: r.name,
            detail:
              r.effects
                .map((e) => {
                  const w = effectOf({ ruleset, entity: actor.entity, effect: e });
                  return w.by === null ? `${w.label} ${w.value}` : `${w.label} ${signed(w.by)}`;
                })
                .join(", ") || null,
            cite: r.cite,
          })),
        ),
      );
  }
}

/**
 * A character's printed sheet: its layout's sections in order, then what the screen lists outside the layout (the
 * saved build's lines and the items no widget draws), then its conditions with room to pencil more.
 */
export function printSheet({
  ruleset,
  actor,
  t,
  maxOf = () => null,
}: {
  ruleset: Ruleset;
  actor: PrintActor;
  t: PrintWords;
  /** A resource's limit for this character, when the formulas can be worked out here. */
  maxOf?: (resource: string) => number | null;
}): PrintedSheet {
  const env: Env = { ruleset, actor, t, maxOf };
  const sections = sectionsOf({ ruleset, actor });
  const printed: PrintSection[] = sections.map((s) => ({
    title: s.label ?? t(`section.${s.id}`),
    blocks: s.parts.flatMap((p) => (p.kind === "rows" ? cells(env, null, p.rows) : widgetBlocks(env, p.model))),
  }));

  const models = sections.flatMap((s) => s.parts.flatMap((p) => (p.kind === "widget" ? [p.model] : [])));
  const drawn = ledgerLaidOut(models);
  const lines = sheetLinesOf(actor.ledger?.sheet);
  const more: PrintBlock[] = [
    ...(lines
      ? [
          ...(["weapons", "armour", "gear", "powers"] as const).flatMap((v) =>
            drawn.has(v) ? [] : cardBlocks({ env, lines, variant: v, label: null }),
          ),
          ...(["abilities", "talents"] as const).flatMap((v) =>
            drawn.has(v) ? [] : foldBlock({ lines, variant: v, label: t(v), t }),
          ),
        ]
      : []),
    ...itemList(t("items"), itemLines({ ruleset, items: actor.items ?? [], kinds: boxKinds({ ruleset, drawn }) })),
  ];
  const conditions = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id)?.label ?? []);
  const pencilled: PrintSection = {
    title: t("conditions"),
    blocks: [{ kind: "text", label: "", text: conditions.join(", "), lines: PENCIL_LINES.conditions }],
  };
  return {
    name: actor.name,
    sections: [...printed, ...(more.length > 0 ? [{ title: t("more"), blocks: more }] : []), pencilled].filter(
      (s) => s.blocks.length > 0,
    ),
  };
}
