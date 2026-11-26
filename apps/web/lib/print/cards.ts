import { splitMentions, type CodexEntry, type HandoutLayout } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { shownFields } from "../entry-fields/entry-fields.ts";
import { transcriptLines, type TranscriptLine } from "../handout/handout.ts";
import { SHARED_LAYOUT, printValue } from "../sheet/sheet.ts";
import { rowFor, type SheetActor, type SheetRow } from "../sheet-widgets/sheet-widgets.ts";

import { CARD_STATS, CARDS_PER_SHEET, CREATURE_STATS, ITEM_TEXT_MAX } from "./constants.ts";
import { fieldText, seenByAll } from "./run-sheet.ts";
import type { PrintWords } from "./sheet.ts";

// Printed props (issue #4, house decision #153): poker cards for creatures and items, a fold-over tent card per
// character, and handouts one to a page. Each is built from what the GM's browser already holds; a card carries names,
// numbers and a cite, never a book's text (principle 2).

export type CardStat = { label: string; value: string };
export type PrintCard =
  | { kind: "tent"; name: string; stats: CardStat[] }
  | { kind: "creature"; name: string; tags: string[]; stats: CardStat[]; cite: string | null }
  | { kind: "item"; name: string; stats: CardStat[]; text: string; cite: string | null };

/** A pack entry a creature card is printed from: a searched entry, or one a scene's roster names. */
export type CreatureSource = {
  name: string;
  type: string;
  body?: Readonly<Record<string, unknown>>;
  tags?: readonly string[];
  cite?: string | null;
};

/**
 * A body's mentions as the table would read them: the title of an entry every seat sees, and "…" (what a phone shows
 * for one it may not see) for the rest. A printed prop goes on the table, so it names nothing a phone would not.
 */
export function tableText({ body, entries }: { body: string; entries: readonly CodexEntry[] }): string {
  const open = new Set(entries.filter(seenByAll).map((e) => e.id));
  return splitMentions(body)
    .map((p) => ("text" in p ? p.text : open.has(p.id) ? p.title : "…"))
    .join("");
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * A character's tent card (house decision #154): the name the table reads, and on the GM's side the numbers of its
 * layout's `trackerRow` (what the tracker shows of it), else its derived values; a resource prints its limit if known.
 */
export function tentCard({
  ruleset,
  actor,
  t,
  maxOf = () => null,
}: {
  ruleset: Ruleset;
  actor: SheetActor & { name: string };
  t: PrintWords;
  maxOf?: (resource: string) => number | null;
}): PrintCard {
  const def = ruleset.entities.find((e) => e.id === actor.entity);
  const tracked = (ruleset.layout[actor.entity] ?? ruleset.layout[SHARED_LAYOUT])?.trackerRow ?? [];
  const pick = (paths: readonly string[]) => paths.flatMap((path) => rowFor({ ruleset, actor, path }) ?? []);
  const fromRow = pick(tracked.flatMap((r) => (typeof r === "string" ? [r] : [])));
  const rows = fromRow.length > 0 ? fromRow : pick((def?.derived ?? []).map((d) => `derived.${d.id}`));
  const valueOf = (r: SheetRow) =>
    r.kind === "resource"
      ? String(maxOf(r.id) ?? actor.resources[r.id] ?? 0)
      : r.kind === "derived"
        ? String(actor.derived[r.id] ?? 0)
        : printValue({ value: actor.fields[r.id], yes: t("yes"), no: t("no") });
  return {
    kind: "tent",
    name: actor.name,
    stats: rows.slice(0, CARD_STATS).map((r) => ({ label: r.label, value: valueOf(r) })),
  };
}

/** A creature's card: its name, tags, the numbers its entry holds for the type's fields, and its cite. */
export function creatureCard({ ruleset, entry }: { ruleset: Ruleset; entry: CreatureSource }): PrintCard {
  const fields = ruleset.entities.find((e) => e.id === entry.type)?.fields ?? {};
  const body = entry.body ?? {};
  const stats = Object.entries(fields).flatMap(([id, f]) => {
    const v = Object.hasOwn(body, id) ? body[id] : undefined;
    return typeof v === "number" ? [{ label: f.label ?? id, value: String(v) }] : [];
  });
  return {
    kind: "creature",
    name: entry.name,
    tags: [...(entry.tags ?? [])],
    stats: stats.slice(0, CREATURE_STATS),
    cite: entry.cite ?? null,
  };
}

/**
 * A codex item's card, a prop for the table: the declared fields every seat may read (a GM-only one stays off), a link
 * named only when every seat reads its entry, its table text (never the GM's notes), and the page it was made from.
 */
export function itemCard({
  ruleset,
  entry,
  entries,
  t,
}: {
  ruleset: Ruleset | null;
  entry: CodexEntry;
  entries: readonly CodexEntry[];
  t: PrintWords;
}): PrintCard {
  return {
    kind: "item",
    name: entry.title,
    stats: shownFields({ ruleset, entry })
      .filter((field) => field.def.visibility !== "gm")
      .slice(0, CARD_STATS)
      .map((field) => ({ label: field.def.label, value: fieldText({ ruleset, entries, field, t, named: seenByAll }) })),
    text: cut(tableText({ body: entry.body, entries }), ITEM_TEXT_MAX),
    cite: entry.source?.cite ?? null,
  };
}

/** Cards onto sheets of 3 × 3, in order; a card never splits across sheets. */
export const layoutCards = (cards: readonly PrintCard[]): PrintCard[][] =>
  Array.from({ length: Math.ceil(cards.length / CARDS_PER_SHEET) }, (_, i) =>
    cards.slice(i * CARDS_PER_SHEET, (i + 1) * CARDS_PER_SHEET),
  );

/** A handout as its printed page: its layout and header, its text as the table reads it, and its picture if sent. */
export type HandoutPage = {
  id: string;
  title: string;
  layout: HandoutLayout;
  header: string;
  body: string;
  /** A transcript's lines, each with its stamp; empty for the other layouts. */
  lines: TranscriptLine[];
  /** The picture's id when this seat received it (house decision #70); null otherwise. */
  imageId: string | null;
};

export function handoutPage({ entry, entries }: { entry: CodexEntry; entries: readonly CodexEntry[] }): HandoutPage {
  const layout = entry.layout ?? "plain";
  const body = tableText({ body: entry.body, entries });
  return {
    id: entry.id,
    title: entry.title,
    layout,
    header: (entry.header ?? "").trim(),
    body,
    lines: layout === "transcript" ? transcriptLines(body) : [],
    imageId: entry.imageId,
  };
}
