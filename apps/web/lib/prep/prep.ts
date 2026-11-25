import { splitMentions, type CodexEntry, type CodexKind } from "@inconsistable/core-schema";

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

/**
 * The entries a scene's text names (a mention in its body or in any text field it holds) that it could link but has
 * not: they exist in `entries`, are not the scene, are of a linkable kind and are not linked yet. Each once, in the
 * order they are first named. Mentions only, nothing is inferred from a title (house decision #108).
 */
export function namedNotLinked({ scene, entries }: { scene: CodexEntry; entries: readonly CodexEntry[] }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const texts = [scene.body, ...Object.values(scene.fields).filter((v): v is string => typeof v === "string")];
  const seen = new Set<string>();
  return texts.flatMap((text) =>
    splitMentions(text).flatMap((part) => {
      const found = "id" in part && !seen.has(part.id) ? byId.get(part.id) : undefined;
      if (
        !found ||
        found.id === scene.id ||
        scene.links.includes(found.id) ||
        !(LINKABLE_KINDS as readonly string[]).includes(found.kind)
      )
        return [];
      seen.add(found.id);
      return [found];
    }),
  );
}

/** True when a typed name is worth offering as a new entry: it is not empty and no entry already has that title. */
export function nameMatchesNone({ entries, name }: { entries: readonly CodexEntry[]; name: string }) {
  const q = name.trim().toLowerCase();
  return q !== "" && !entries.some((e) => e.title.trim().toLowerCase() === q);
}

const PLAYABLE_FIRST = ["active", "planned"];

/**
 * Where ADD TO SCENE can put a creature: each adventure with its scenes, the scene in play first, then planned (or with
 * no status), then the played ones; scenes with no adventure come last.
 */
export function sceneTargets(entries: readonly CodexEntry[]) {
  const rank = (s: CodexEntry) => {
    const at = PLAYABLE_FIRST.indexOf(s.status ?? "planned");
    return at < 0 ? PLAYABLE_FIRST.length : at;
  };
  const tree = prepTree(entries);
  const sorted = (scenes: CodexEntry[]) => [...scenes].sort((a, b) => rank(a) - rank(b));
  return [
    ...tree.adventures.map((a) => ({ adventure: a.adventure as CodexEntry | null, scenes: sorted(a.scenes) })),
    { adventure: null, scenes: sorted(tree.loose) },
  ].filter((g) => g.scenes.length > 0);
}
