import type { CompiledRuleset } from "./compile.ts";
import type { ReminderAt } from "./enums.ts";
import { ExprError, type ExprRecord } from "./expr/expr.ast.ts";
import { evaluateBool } from "./expr/expr.ts";

// The reminder lines of a fight (house decision #81): the ruleset's own words, never an effect on a number. Pure: the
// api decides which moment it is and who is asked, and sends the lines to the side running the fight only.

/** The part of a combatant a reminder reads. */
export interface ReminderActor {
  scope: ExprRecord | null;
  /** The condition ids it holds. */
  conditions: readonly string[];
  held: boolean;
  barred: boolean;
}

export interface ReminderLine {
  /** A reminder of `reminders`, or a condition that carries `at` and `text`. */
  source: "reminder" | "condition";
  id: string;
  text: string;
  cite: string | null;
  /** The combatants it holds for, in the order given; empty for a reminder with no `if`. */
  actorIds: string[];
}

/**
 * The lines due `at` this moment, asked of the combatants in `order` (the one whose turn it is, or every combatant at
 * the round's end): the declared reminders in manifest order, then the conditions with a line that one of them holds.
 * A reminder with an `if` shows when it holds for at least one; a value it cannot read holds for nobody.
 */
export function remindersOf({
  ruleset,
  at,
  actors,
  order,
  round,
}: {
  ruleset: CompiledRuleset;
  at: ReminderAt;
  actors: Readonly<Record<string, ReminderActor>>;
  order: readonly string[];
  round: number;
}): ReminderLine[] {
  const present = order.flatMap((id) => {
    const a = Object.hasOwn(actors, id) ? actors[id] : undefined;
    return a === undefined ? [] : [{ id, a }];
  });
  const lines: ReminderLine[] = [];
  (ruleset.ruleset.reminders ?? []).forEach((r, i) => {
    if (r.at !== at) return;
    const expr = ruleset.reminders[i] ?? null;
    const line = { source: "reminder" as const, id: r.id, text: r.text, cite: r.cite ?? null };
    if (expr === null) {
      lines.push({ ...line, actorIds: [] });
      return;
    }
    const actorIds = present.flatMap(({ id, a }) => {
      if (a.scope === null) return [];
      try {
        return evaluateBool({ expr, scope: { ...a.scope, round, held: a.held, barred: a.barred } }) ? [id] : [];
      } catch (e) {
        if (e instanceof ExprError) return [];
        throw e;
      }
    });
    if (actorIds.length > 0) lines.push({ ...line, actorIds });
  });
  for (const c of ruleset.ruleset.conditions) {
    if (c.at !== at || c.text === undefined) continue;
    const actorIds = present.flatMap(({ id, a }) => (a.conditions.includes(c.id) ? [id] : []));
    if (actorIds.length > 0)
      lines.push({ source: "condition", id: c.id, text: c.text, cite: c.cite ?? null, actorIds });
  }
  return lines;
}
