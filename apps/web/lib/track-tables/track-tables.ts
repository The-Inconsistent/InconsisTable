import type { Actor } from "@inconsistable/core-schema";
import type { RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { appliesTo, isLookupTable } from "@/lib/lookup/lookup";

// Where TRACK shows a ruleset's tables (house decision #225): a table rolled elsewhere (a generator, a codex field) stays
// there, a lookup that applies to the selected combatant sits on its panel, every other table is a row of the list.

type Entry = [id: string, table: RandomTable];
type UsedFrom = Pick<Ruleset, "tables" | "generators" | "codex">;

/**
 * The tables rolled outside TRACK: those any generator step rolls (`each` steps included), those a codex kind rolls into
 * a field or its title (`roll`, `titleRoll`, their `per` tables, house decisions #97, #178), and every table their lines
 * lead on to through `next`.
 */
export function usedTables(ruleset: UsedFrom): Set<string> {
  const steps = (ruleset.generators ?? []).flatMap((g) => [...g.steps, ...(g.each?.steps ?? [])]);
  const rolls = Object.values(ruleset.codex?.kinds ?? {}).flatMap((k) => [
    ...(k?.titleRoll ? [k.titleRoll] : []),
    ...Object.values(k?.fields ?? {}).flatMap((f) => ("roll" in f && f.roll ? [f.roll] : [])),
  ]);
  const todo = [
    ...steps.flatMap((s) => (s.kind === "roll" ? [s.table] : [])),
    ...rolls.flatMap((r) => [...r.tables, ...Object.values(r.per?.tables ?? {}).flat()]),
  ];
  const used = new Set<string>();
  for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
    if (used.has(id)) continue;
    used.add(id);
    for (const e of ruleset.tables?.[id]?.entries ?? []) if (e.next !== undefined) todo.push(e.next);
  }
  return used;
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
  ruleset: UsedFrom;
  panelFor: Pick<Actor, "entity"> | null;
  hasGm: boolean;
}): { listed: Entry[]; onPanel: Entry[] } {
  const used = usedTables(ruleset);
  // A lookup that reads or changes someone (effects, inputs, a modifier) stays on TRACK wherever else it is rolled; one
  // that only leads on through `next` is a chain of the place that rolls it.
  const readsSomeone = (t: RandomTable) => appliesTo(t) || t.inputs !== undefined || t.modifier !== undefined;
  const all = Object.entries(ruleset.tables ?? {}).filter(([id, t]) => !used.has(id) || readsSomeone(t));
  const panel = (table: RandomTable) => panelFor !== null && lookupFor({ table, actor: panelFor, hasGm });
  return { listed: all.filter(([, t]) => !panel(t)), onPanel: all.filter(([, t]) => panel(t)) };
}
