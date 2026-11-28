import {
  MAX_CHAIN,
  askedSteps,
  roundsOf,
  type Generator,
  type GeneratorStep,
  type RandomTable,
  type Ruleset,
  type StepValue,
  type TableEntry,
} from "@inconsistable/rules-engine";

import type { KindFilter } from "@/lib/codex/codex";

type Answers = Readonly<Record<string, StepValue>>;

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

/** The generators CODEX's GENERATE offers on a kind filter (house decision #226): those making that kind; all on "all". */
export function generatorsFor({
  generators,
  kind,
}: {
  generators: readonly Generator[];
  kind: KindFilter;
}): readonly Generator[] {
  return kind === "all" ? generators : generators.filter((g) => g.make.kind === kind);
}

/** A roll ROLL ALL makes: in which round (null for the run's own steps), for which step, on which table. */
export type NextRoll = { round: number | null; step: string; table: string };

/**
 * ROLL ALL's next roll (house decision #226): the first asked roll step whose chain is not done, the run's own steps
 * first, then each round's in order. A chain is done once its last line sends nowhere (or to a table the ruleset lacks),
 * or at the engine's longest chain. Null once nothing is left to roll.
 */
export function nextRoll({
  ruleset,
  generator: g,
  answers,
  rounds,
  campaign = {},
}: {
  ruleset: Ruleset;
  generator: Generator;
  answers: Answers;
  rounds: readonly Answers[];
  campaign?: Readonly<Record<string, string | number | boolean>>;
}): NextRoll | null {
  const open = (steps: readonly GeneratorStep[], on: readonly boolean[], given: Answers) => {
    for (const [j, s] of steps.entries()) {
      if (!on[j] || s.kind !== "roll") continue;
      const rows = given[s.id]?.rows ?? [];
      const { next } = rollChain({ ruleset, table: s.table, rows });
      if (next !== undefined && ruleset.tables?.[next] && rows.length < MAX_CHAIN) return { step: s.id, table: next };
    }
    return null;
  };
  const own = open(g.steps, askedSteps({ ruleset, steps: g.steps, answers, campaign }), answers);
  if (own) return { round: null, ...own };
  const count = roundsOf({ ruleset, generator: g, answers, campaign }) ?? 0;
  const eachSteps = g.each?.steps ?? [];
  for (let i = 0; i < count; i++) {
    const given = { ...answers, ...(rounds[i] ?? {}) };
    const on = askedSteps({ ruleset, steps: eachSteps, above: g.steps, answers: given, campaign });
    const found = open(eachSteps, on, rounds[i] ?? {});
    if (found) return { round: i, ...found };
  }
  return null;
}
