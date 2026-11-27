import type { Actor, LiveState } from "@inconsistable/core-schema";
import type { LayoutRow, Ruleset } from "@inconsistable/rules-engine";

import { layoutRows } from "../panels/panels.ts";

/** One card of the table screen: an actor and the rows its ruleset lays out for the screen. */
export type ScreenCardOf = { actor: Actor; rows: readonly LayoutRow[] };

/**
 * The cards the table screen draws (house decision #127): every party character, and in a fight every creature the GM
 * shows in full, each whose entity (or the shared layout) declares a `screen` target. Without one, no card: the screen
 * stays as it was.
 */
export function screenCardsOf({
  ruleset,
  state,
}: {
  ruleset: Ruleset | null | undefined;
  state: Pick<LiveState, "actors" | "encounter">;
}): { party: ScreenCardOf[]; shown: ScreenCardOf[] } {
  if (!ruleset) return { party: [], shown: [] };
  const card = (actor: Actor): ScreenCardOf[] => {
    const rows = layoutRows({ ruleset, entity: actor.entity, target: "screen" });
    return rows && rows.length > 0 ? [{ actor, rows }] : [];
  };
  const full = new Set(
    (state.encounter?.combatants ?? []).filter((c) => c.visibility === "full").map((c) => c.actorId),
  );
  return {
    party: state.actors.filter((a) => a.kind === "pc").flatMap(card),
    shown: state.actors.filter((a) => a.kind !== "pc" && full.has(a.id)).flatMap(card),
  };
}
