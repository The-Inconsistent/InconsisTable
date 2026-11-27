import type { Actor } from "@inconsistable/core-schema";
import type { RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { isLookupTable } from "@/lib/lookup/lookup";

// Where TRACK shows a ruleset's tables (house decision #225): a table a generator rolls stays in its generator in CODEX,
// a lookup that applies to the selected combatant sits on its panel, every other table is a row of the tables list.

type Entry = [id: string, table: RandomTable];

/** The tables any generator step rolls, `each` steps included. */
export function generatorTables(ruleset: Pick<Ruleset, "generators">): Set<string> {
  const steps = (ruleset.generators ?? []).flatMap((g) => [...g.steps, ...(g.each?.steps ?? [])]);
  return new Set(steps.flatMap((s) => (s.kind === "roll" ? [s.table] : [])));
}

/**
 * Whether a lookup is worked out on this actor's panel: the actor has a type, the table applies to that type, and a
 * `gm` table has a GM to keep it from (the server refuses it otherwise).
 */
export function lookupFor({
  table,
  actor,
  hasGm,
}: {
  table: RandomTable;
  actor: Pick<Actor, "entity">;
  hasGm: boolean;
}): boolean {
  return (
    isLookupTable(table) &&
    actor.entity !== "" &&
    (hasGm || table.visibility !== "gm") &&
    (table.entities === undefined || table.entities.includes(actor.entity))
  );
}

/**
 * The tables TRACK lists, and the lookups the selected combatant's panel holds. `panelFor`: the selected combatant's
 * actor when there is a panel and lookups can be worked out (the compiled ruleset is at hand), else null.
 */
export function trackTables({
  ruleset,
  panelFor,
  hasGm,
}: {
  ruleset: Pick<Ruleset, "tables" | "generators">;
  panelFor: Pick<Actor, "entity"> | null;
  hasGm: boolean;
}): { listed: Entry[]; onPanel: Entry[] } {
  const rolled = generatorTables(ruleset);
  const all = Object.entries(ruleset.tables ?? {}).filter(([id]) => !rolled.has(id));
  const panel = (table: RandomTable) => panelFor !== null && lookupFor({ table, actor: panelFor, hasGm });
  return { listed: all.filter(([, t]) => !panel(t)), onPanel: all.filter(([, t]) => panel(t)) };
}
