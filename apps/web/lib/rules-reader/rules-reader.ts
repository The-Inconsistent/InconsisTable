import type { Ruleset } from "@inconsistable/rules-engine";

import type { RulesEntry, RulesReply } from "@/lib/library/library";

// The RULES reading view's pure side: the paged, searchable pack entries the seat may read (the api filters them per
// seat), and the filters for the conditions and decisions the manifest carries.

export const RULES_PAGE = 50;

/** What the page reads once on the server for this seat: the manifest as the seat may read it, and the first entries. */
export type RulesView = { ruleset: Ruleset | null; first: RulesReply };

/** The seat-scoped rules route with a search by name, a type filter and a page. */
export function rulesUrl({
  campaignId,
  type,
  q,
  offset,
}: {
  campaignId: string;
  type: string;
  q: string;
  offset: number;
}) {
  const p = new URLSearchParams({ limit: String(RULES_PAGE), offset: String(offset) });
  if (type) p.set("type", type);
  if (q.trim()) p.set("q", q.trim());
  return `/api/campaigns/${encodeURIComponent(campaignId)}/rules?${p}`;
}

/** The types to filter by: the ruleset's entity types and any type an entry carries, each once, in that order. */
export function typeOptions({ ruleset, entries }: { ruleset: Ruleset | null; entries: readonly RulesEntry[] }) {
  return [...new Set([...(ruleset?.entities.map((e) => e.id) ?? []), ...entries.map((e) => e.type)])];
}

/** The next page after the ones shown; an entry already shown (the same pack and key) is not listed twice. */
export function appendPage({ shown, next }: { shown: readonly RulesEntry[]; next: readonly RulesEntry[] }) {
  const seen = new Set(shown.map((e) => `${e.pack}/${e.type}/${e.key}`));
  return [...shown, ...next.filter((e) => !seen.has(`${e.pack}/${e.type}/${e.key}`))];
}

/** Items whose text contains the search, ignoring case; no search keeps them all. */
export function matching<T>({ items, q, text }: { items: readonly T[]; q: string; text: (item: T) => string }) {
  const needle = q.trim().toLowerCase();
  return needle === "" ? [...items] : items.filter((i) => text(i).toLowerCase().includes(needle));
}
