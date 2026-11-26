import { CodexKind, QuestStatus, type CodexEntry, type HandoutLayout } from "@inconsistable/core-schema";

/** The most readers a listed audience can hold (the action's own limit). */
export const AUDIENCE_MAX = 50;

/** The most characters a session recap holds (the action's own limit). */
export const RECAP_MAX = 10_000;

/** The list's filter: every entry, or one kind. */
export type KindFilter = CodexKind | "all";

/** What the editor changes; `gmNotes` is only ever sent when the seat may read it. A handout's draft also holds its
 * layout and header (house decision #72); another kind's holds neither. */
export type EntryDraft = { title: string; body: string; gmNotes: string; layout?: HandoutLayout; header?: string };

// The words of an entry a search reads: its title, its body and the values of its declared fields (a tags field's words
// too). GM notes are not read: a co-GM without secrets would otherwise find entries by text they cannot read, and the
// server sends a seat only the fields it may see.
const searchText = (e: CodexEntry) =>
  [
    e.title,
    e.body,
    ...Object.values(e.fields).flatMap((v) =>
      Array.isArray(v) ? v.filter((w) => typeof w === "string") : [String(v)],
    ),
  ]
    .join("\n")
    .toLowerCase();

// The entries of the chosen kind whose words hold the query, case-insensitively.
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
  return entries.filter((e) => (kind === "all" || e.kind === kind) && (q === "" || searchText(e).includes(q)));
}

/** The entries by kind, in the codex's kind order, each kind with at least one entry. */
export function byKind(entries: readonly CodexEntry[]): { kind: CodexKind; entries: CodexEntry[] }[] {
  return CodexKind.options.flatMap((kind) => {
    const of = entries.filter((e) => e.kind === kind);
    return of.length > 0 ? [{ kind, entries: of }] : [];
  });
}

/** The entries newest revealed first (house decision #86); one with no time (revealed before it was kept) goes last. */
export function newestRevealed(entries: readonly CodexEntry[]): CodexEntry[] {
  return [...entries].sort((a, b) => (b.revealedAt ?? "").localeCompare(a.revealedAt ?? ""));
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
  if (draft.layout !== undefined && draft.layout !== entry.layout) patch.layout = draft.layout;
  if (draft.header !== undefined && draft.header !== entry.header) patch.header = draft.header;
  return patch;
}

/** A run of plain text, or an entry a name in it spells. */
export type NamePart = { text: string } | { entry: CodexEntry };

// Shorter names are left alone: a two-letter name would link half the prose.
const MIN_NAME = 3;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linkers = new WeakMap<readonly CodexEntry[], (args: { text: string; self?: string }) => NamePart[]>();

// Auto-link (#218, Auspex's nameLinker): plain text that spells an entry's whole title, case and all, as a whole word,
// over the entries this seat holds only. Longest title first, so "Old Maren" wins over "Maren"; on a shared title an NPC
// wins, then the codex's kind order. `self` keeps an entry from linking itself. Built once per list of entries.
export function nameLinker(entries: readonly CodexEntry[]): (args: { text: string; self?: string }) => NamePart[] {
  const cached = linkers.get(entries);
  if (cached) return cached;
  const rank = (e: CodexEntry) => (e.kind === "npc" ? -1 : CodexKind.options.indexOf(e.kind));
  const byTitle = new Map<string, CodexEntry>();
  for (const e of [...entries].sort((a, b) => rank(a) - rank(b)))
    if (e.title.length >= MIN_NAME && !byTitle.has(e.title)) byTitle.set(e.title, e);
  const alts = [...byTitle.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = alts.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null;
  const link = ({ text, self }: { text: string; self?: string }): NamePart[] => {
    const parts: NamePart[] = [];
    let at = 0;
    for (const m of re ? text.matchAll(re) : []) {
      const hit = byTitle.get(m[0]);
      if (!hit || hit.id === self) continue;
      if (m.index > at) parts.push({ text: text.slice(at, m.index) });
      parts.push({ entry: hit });
      at = m.index + m[0].length;
    }
    if (at < text.length) parts.push({ text: text.slice(at) });
    return parts;
  };
  linkers.set(entries, link);
  return link;
}

// FOR YOUR EYES ONLY (#218): the entry was revealed to listed characters and this seat holds one of them. A phone's
// audience is already cut to the characters it holds; a seat holding none (the GM side) never reads it so.
export const forYourEyes = ({ entry, held }: { entry: CodexEntry; held: readonly string[] }): boolean =>
  entry.visibility !== "gm" && entry.audienceMode === "listed" && entry.audience.some((a) => held.includes(a));

/** The first line of a body that holds words, trimmed, for a compact card. */
export const firstLine = (body: string): string =>
  body
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";

/** MISSION's quest groups in the order drawn: YOUR ORDERS (folded), then each quest status. */
export const QUEST_GROUPS = ["orders", ...QuestStatus.options] as const;
export type QuestGroup = (typeof QUEST_GROUPS)[number];

// The quests by group (#218): one revealed to listed characters this seat holds is in YOUR ORDERS only, any other by its
// own status. Groups without a quest are left out; each keeps the order given.
export function questGroups({
  entries,
  held,
}: {
  entries: readonly CodexEntry[];
  held: readonly string[];
}): { group: QuestGroup; entries: CodexEntry[] }[] {
  const quests = entries.filter((e) => e.kind === "quest");
  const groupOf = (e: CodexEntry): QuestGroup | null => {
    if (forYourEyes({ entry: e, held })) return "orders";
    const status = QuestStatus.safeParse(e.status);
    return status.success ? status.data : null;
  };
  return QUEST_GROUPS.flatMap((group) => {
    const of = quests.filter((e) => groupOf(e) === group);
    return of.length > 0 ? [{ group, entries: of }] : [];
  });
}
