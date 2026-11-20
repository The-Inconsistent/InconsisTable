import type { CodexEntry, CodexKind, HandoutLayout } from "@inconsistable/core-schema";

/** The most readers a listed audience can hold (the action's own limit). */
export const AUDIENCE_MAX = 50;

/** The most characters a session recap holds (the action's own limit). */
export const RECAP_MAX = 10_000;

/** The list's filter: every entry, or one kind. */
export type KindFilter = CodexKind | "all";

/** What the editor changes; `gmNotes` is only ever sent when the seat may read it. A handout's draft also holds its
 * layout and header (house decision #72); another kind's holds neither. */
export type EntryDraft = { title: string; body: string; gmNotes: string; layout?: HandoutLayout; header?: string };

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
