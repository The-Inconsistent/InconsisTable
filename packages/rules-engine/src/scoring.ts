import type { CompiledRuleset } from "./compile.ts";
import { ExprError, type ExprRecord } from "./expr/expr.ast.ts";
import { evaluateBool, evaluateInt } from "./expr/expr.ts";
import type { GameOutcome, Scoring } from "./manifest.ts";

// The end of a game (house decisions #38-#40): which `endWhen` triggers hold, each actor's final score and the ranking.
// Pure: the api reads the actors and writes the results.

/** The part of a built actor these functions read. */
export interface ScoredActor {
  scope: ExprRecord | null;
}

/** Indexes of the `endWhen` triggers that hold for any actor of the order. An actor whose values are missing meets none. */
export function endMet({
  ruleset,
  actors,
  order,
  round,
}: {
  ruleset: CompiledRuleset;
  actors: Readonly<Record<string, ScoredActor>>;
  order: readonly string[];
  round: number;
}): number[] {
  const scoring = ruleset.scoring;
  if (scoring === null) return [];
  const scopes = order.flatMap((id) => {
    const scope = Object.hasOwn(actors, id) ? actors[id]?.scope : null;
    return scope ? [{ ...scope, round }] : [];
  });
  return scoring.endWhen.flatMap((expr, i) =>
    scopes.some((scope) => {
      try {
        return evaluateBool({ expr, scope });
      } catch (e) {
        if (e instanceof ExprError) return false;
        throw e;
      }
    })
      ? [i]
      : [],
  );
}

export interface ScoreRow {
  actorId: string;
  score: number;
  tiebreaks: number[];
}

/** Each actor's score and tiebreak values, in the order given. An actor that cannot be evaluated yet scores 0. */
export function scoreRows({
  ruleset,
  actors,
  order,
}: {
  ruleset: CompiledRuleset;
  actors: Readonly<Record<string, ScoredActor>>;
  order: readonly string[];
}): ScoreRow[] {
  const scoring = ruleset.scoring;
  if (scoring === null) return [];
  return order.map((actorId) => {
    const scope = Object.hasOwn(actors, actorId) ? actors[actorId]?.scope : null;
    if (!scope) return { actorId, score: 0, tiebreaks: scoring.tiebreaks.map(() => 0) };
    // ponytail: a value missing from the scope fails the whole game end; a ruleset that scores a field must set it
    return {
      actorId,
      score: evaluateInt({ expr: scoring.score, scope }),
      tiebreaks: scoring.tiebreaks.map((expr) => evaluateInt({ expr, scope })),
    };
  });
}

export interface RankedRow extends ScoreRow {
  place: number | null;
  outcome: GameOutcome | null;
}

/**
 * Ranks by score in `order`, then each tiebreak in its own order. Rows still tied share the place and the next place is
 * skipped (1, 1, 3). A cooperative game ranks nobody: every row gets the outcome of the first trigger in `met` (indexes
 * of `endWhen`, in manifest order), or `lose` when none is met (the table stopped early).
 */
export function rankResults({
  scoring,
  rows,
  met = [],
}: {
  scoring: Pick<Scoring, "mode" | "order" | "tiebreaks" | "endWhen">;
  rows: readonly ScoreRow[];
  met?: readonly number[];
}): RankedRow[] {
  if (scoring.mode === "coop") {
    const first = [...met].sort((a, b) => a - b)[0];
    const outcome = (first === undefined ? undefined : scoring.endWhen[first]?.outcome) ?? "lose";
    return rows.map((r) => ({ ...r, place: null, outcome }));
  }
  const sign = (o: "high" | "low") => (o === "high" ? -1 : 1);
  const compare = (a: ScoreRow, b: ScoreRow) => {
    if (a.score !== b.score) return sign(scoring.order) * (a.score - b.score);
    for (const [i, t] of scoring.tiebreaks.entries()) {
      const d = (a.tiebreaks[i] ?? 0) - (b.tiebreaks[i] ?? 0);
      if (d !== 0) return sign(t.order) * d;
    }
    return 0;
  };
  const sorted = [...rows].sort(compare);
  let place = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (prev === undefined || compare(prev, r) !== 0) place = i + 1;
    return { ...r, place, outcome: null };
  });
}
