import type { CodexEntry, CodexKind } from "@inconsistable/core-schema";

/** The kinds a scene can link, in the order the scene lists them (the api refuses any other). */
export const LINKABLE_KINDS = [
  "npc",
  "location",
  "faction",
  "item",
  "handout",
  "lore",
  "quest",
] as const satisfies readonly CodexKind[];

/** The most Tests a scene plans (the action's own limit). */
export const PLANNED_TESTS_MAX = 10;

const byPosition = (a: CodexEntry, b: CodexEntry) => a.position - b.position;

/** An adventure and its scenes in play order; `loose` are scenes with no adventure. */
export type PrepTree = {
  adventures: { adventure: CodexEntry; scenes: CodexEntry[] }[];
  loose: CodexEntry[];
};

// The prep outline: adventures by position, each with its scenes by position. A scene whose adventure the seat can't
// see is loose, never dropped. `Array.sort` is stable, so equal positions keep the snapshot's order.
export function prepTree(entries: readonly CodexEntry[]): PrepTree {
  const scenes = entries.filter((e) => e.kind === "scene").sort(byPosition);
  const adventures = entries
    .filter((e) => e.kind === "adventure")
    .sort(byPosition)
    .map((adventure) => ({ adventure, scenes: scenes.filter((s) => s.parentId === adventure.id) }));
  const known = new Set(adventures.map((a) => a.adventure.id));
  return { adventures, loose: scenes.filter((s) => s.parentId === null || !known.has(s.parentId)) };
}

// Where a scene goes when moved one step: the index among its siblings the api should insert it at, or null at the end.
export function stepIndex({ siblings, id, step }: { siblings: readonly CodexEntry[]; id: string; step: -1 | 1 }) {
  const at = siblings.findIndex((s) => s.id === id);
  const to = at + step;
  return at < 0 || to < 0 || to >= siblings.length ? null : to;
}

/** A scene's links as entries, grouped by kind in LINKABLE_KINDS order; a link to an entry the seat lost is skipped. */
export function groupLinks({ entry, entries }: { entry: CodexEntry; entries: readonly CodexEntry[] }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const linked = entry.links.flatMap((id) => byId.get(id) ?? []);
  return LINKABLE_KINDS.map((kind) => ({ kind, entries: linked.filter((e) => e.kind === kind) })).filter(
    (g) => g.entries.length > 0,
  );
}

/** Entries a scene can still link: a linkable kind, not already linked, whose title holds the query. */
export function linkCandidates({
  entry,
  entries,
  query,
}: {
  entry: CodexEntry;
  entries: readonly CodexEntry[];
  query: string;
}) {
  const q = query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (LINKABLE_KINDS as readonly string[]).includes(e.kind) &&
      !entry.links.includes(e.id) &&
      (q === "" || e.title.toLowerCase().includes(q)),
  );
}
