import type { RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { isLookupTable } from "@/lib/lookup/lookup";

// Where TRACK shows a ruleset's tables (house decision #225): a table a generator rolls stays in its generator in CODEX,
// a lookup during a fight sits on the selected combatant's panel, every other table is a row of the tables list.

type Entry = [id: string, table: RandomTable];

/** The tables any generator step rolls, `each` steps included. */
export function generatorTables(ruleset: Pick<Ruleset, "generators">): Set<string> {
  const steps = (ruleset.generators ?? []).flatMap((g) => [...g.steps, ...(g.each?.steps ?? [])]);
  return new Set(steps.flatMap((s) => (s.kind === "roll" ? [s.table] : [])));
}

/**
 * The tables TRACK lists, and the lookups the selected combatant's panel holds. `fight`: a combatant is selected and
 * lookups can be worked out (the compiled ruleset is at hand), so lookups leave the list for the panel.
 */
export function trackTables({ ruleset, fight }: { ruleset: Pick<Ruleset, "tables" | "generators">; fight: boolean }): {
  listed: Entry[];
  onPanel: Entry[];
} {
  const rolled = generatorTables(ruleset);
  const all = Object.entries(ruleset.tables ?? {}).filter(([id]) => !rolled.has(id));
  const panel = (t: RandomTable) => fight && isLookupTable(t);
  return { listed: all.filter(([, t]) => !panel(t)), onPanel: all.filter(([, t]) => panel(t)) };
}
