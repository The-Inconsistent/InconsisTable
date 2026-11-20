import type { CodexEntry, CodexKind } from "@inconsistable/core-schema";

/** The most readers a listed audience can hold (the action's own limit). */
export const AUDIENCE_MAX = 50;

/** The most characters a session recap holds (the action's own limit). */
export const RECAP_MAX = 10_000;

/** The list's filter: every entry, or one kind. */
export type KindFilter = CodexKind | "all";

/** What the editor changes; `gmNotes` is only ever sent when the seat may read it. */
export type EntryDraft = { title: string; body: string; gmNotes: string };

// The entries of the chosen kind whose title or body holds the query, case-insensitively. GM notes are not searched:
// a co-GM without secrets would otherwise find entries by text they cannot read.
export function filterEntries({
  entries,
  kind,
  query,
}: {
  entries: readonly CodexEntry[];
  kind: KindFilter;
  query: string;
}): CodexEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(
    (e) => (kind === "all" || e.kind === kind) && (q === "" || `${e.title}\n${e.body}`.toLowerCase().includes(q)),
  );
}

/** One row of a drawn tree: the entry, how deep it sits (0 for a root) and how many entries sit anywhere inside it. */
export type TreeRow = { entry: CodexEntry; depth: number; inside: number };

// The entries as a tree, depth first: each under its parent, siblings by position. An entry whose parent is not among
// them (hidden from the seat, or filtered out) is a root; roots keep the order given (house decision #69).
export function treeRows(entries: readonly CodexEntry[]): TreeRow[] {
  const ids = new Set(entries.map((e) => e.id));
  const under = new Map<string, CodexEntry[]>();
  for (const e of entries) {
    if (e.parentId !== null && ids.has(e.parentId)) under.set(e.parentId, [...(under.get(e.parentId) ?? []), e]);
  }
  const rows: TreeRow[] = [];
  const walk = (entry: CodexEntry, depth: number) => {
    const row = { entry, depth, inside: 0 };
    const at = rows.push(row);
    for (const child of [...(under.get(entry.id) ?? [])].sort((a, b) => a.position - b.position))
      walk(child, depth + 1);
    row.inside = rows.length - at;
  };
  for (const e of entries) if (e.parentId === null || !ids.has(e.parentId)) walk(e, 0);
  return rows;
}

// The rows left once the folded entries' insides are dropped (a folded entry itself stays).
export function unfolded({ rows, folded }: { rows: readonly TreeRow[]; folded: ReadonlySet<string> }): TreeRow[] {
  let hideBelow = Infinity;
  return rows.filter((r) => {
    if (r.depth > hideBelow) return false;
    hideBelow = folded.has(r.entry.id) ? r.depth : Infinity;
    return true;
  });
}

// The entries `entry` may be moved under, in tree order: the server's rule (a scene under an adventure, anything else
// under its own kind), minus the entry and everything inside it, which would loop.
export function parentOptions({ entries, entry }: { entries: readonly CodexEntry[]; entry: CodexEntry }): TreeRow[] {
  const kind = entry.kind === "scene" ? "adventure" : entry.kind;
  const rows = treeRows(entries.filter((e) => e.kind === kind));
  const at = rows.findIndex((r) => r.entry.id === entry.id);
  const self = rows[at];
  return self ? [...rows.slice(0, at), ...rows.slice(at + self.inside + 1)] : rows;
}

// The ancestors of an entry, root first, as far as this seat reads them: the server sends no parent it may not read.
export function entryPath({ entries, entry }: { entries: readonly CodexEntry[]; entry: CodexEntry }): CodexEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path: CodexEntry[] = [];
  for (let at = byId.get(entry.parentId ?? ""); at && path.length < entries.length; at = byId.get(at.parentId ?? "")) {
    path.unshift(at);
  }
  return path;
}

// The fields of a codex.save patch: only what differs from the saved entry, because the api writes exactly what it is
// sent. `gmNotes` is left out unless `canSecrets`, so a seat that never saw them cannot blank them.
export function savePatch({
  entry,
  draft,
  canSecrets,
}: {
  entry: CodexEntry;
  draft: EntryDraft;
  canSecrets: boolean;
}): Partial<EntryDraft> {
  const patch: Partial<EntryDraft> = {};
  const title = draft.title.trim();
  if (title !== entry.title) patch.title = title;
  if (draft.body !== entry.body) patch.body = draft.body;
  if (canSecrets && draft.gmNotes !== entry.gmNotes) patch.gmNotes = draft.gmNotes;
  return patch;
}
