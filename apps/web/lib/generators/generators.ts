import type { RandomTable, Ruleset, TableEntry } from "@inconsistable/rules-engine";

/**
 * A roll step's chain so far (house decision #98): each table and the line read on it, starting on the step's table and
 * going on through each line's `next`; and the table rolled next, undefined once a line sends nowhere.
 */
export function rollChain({ ruleset, table, rows }: { ruleset: Ruleset; table: string; rows: readonly string[] }): {
  trail: { title: string; label: string }[];
  next: string | undefined;
} {
  const trail: { title: string; label: string }[] = [];
  let at: string | undefined = table;
  for (const id of rows) {
    const t: RandomTable | undefined = at === undefined ? undefined : ruleset.tables?.[at];
    const line: TableEntry | undefined = t?.entries.find((e) => e.id === id);
    trail.push({ title: t?.title ?? at ?? "", label: line?.label ?? id });
    at = line?.next;
  }
  return { trail, next: at };
}
