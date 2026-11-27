import type { Actor, FightLogLine, HistoryLine } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

// The fight's log on the GM's tracker (house decision #100): what each logged action of the running fight did, in the
// platform's words: who, what, how much. Read-only; Undo and TURN BACK stay the tracker's buttons.

/** One thing an action did, for the component to word with its messages. */
export type LogPart =
  | { kind: "strike"; attacker: string; target: string; means: string | null; outcome: string; total: number }
  | { kind: "change"; name: string | null; label: string; by: number }
  | { kind: "set"; name: string; label: string; value: string }
  | { kind: "condition"; name: string; label: string; on: boolean }
  | { kind: "acts"; name: string }
  | { kind: "ends"; name: string }
  | { kind: "round"; round: number }
  /** HISTORY only: an action whose writes the log does not tell, by how many there were. */
  | { kind: "other"; count: number };

/** One action as a line: its parts in order, and whether Undo or TURN BACK took it back. */
export type LogLine = { id: string; parts: LogPart[]; undone: boolean };
/** The lines of one turn: whoever was acting when they were taken (null between turns), newest first. */
export type LogTurn = { actorId: string | null; name: string | null; lines: LogLine[] };
/** One round's turns, newest first. */
export type LogRound = { round: number; turns: LogTurn[] };

type Names = ReadonlyMap<string, Pick<Actor, "name">>;

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** What one logged write did, in parts; nothing for a write the log does not tell (a turn's bookkeeping). */
function partsOf({
  w,
  names,
  ruleset,
}: {
  w: FightLogLine["writes"][number];
  names: Names;
  ruleset: Pick<Ruleset, "resources" | "conditions" | "entities" | "strikes"> | null;
}): LogPart[] {
  const t = w.target;
  const name = (id: string | undefined) => (id === undefined ? null : (names.get(id)?.name ?? null));
  const resourceLabel = (id: string) => ruleset?.resources.find((r) => r.id === id)?.label ?? id;
  if (t.resource !== undefined || t.pool !== undefined) {
    const by = num(w.after) - num(w.before);
    const id = t.resource ?? t.pool ?? "";
    return by === 0 ? [] : [{ kind: "change", name: name(t.actorId), label: resourceLabel(id), by }];
  }
  if (t.condition !== undefined && t.actorId !== undefined) {
    const row = (v: unknown) =>
      typeof v === "object" && v !== null && "conditionId" in v
        ? String((v as { conditionId: unknown }).conditionId)
        : null;
    const before = row(w.before);
    const after = row(w.after);
    const id = after ?? before;
    if (id === null || (before !== null && after !== null)) return [];
    const label = ruleset?.conditions.find((c) => c.id === id)?.label ?? id;
    return [{ kind: "condition", name: name(t.actorId) ?? "", label, on: after !== null }];
  }
  if (t.field !== undefined && t.actorId !== undefined) {
    const label =
      ruleset?.entities.flatMap((e) => Object.entries(e.fields)).find(([id]) => id === t.field)?.[1].label ?? t.field;
    const value = Array.isArray(w.after) ? w.after.join(", ") : w.after === null ? "–" : String(w.after);
    return [{ kind: "set", name: name(t.actorId) ?? "", label, value }];
  }
  if (t.turn === "currentId") {
    if (typeof w.after === "string") return [{ kind: "acts", name: name(w.after) ?? "" }];
    if (typeof w.before === "string") return [{ kind: "ends", name: name(w.before) ?? "" }];
    return [];
  }
  if (t.turn === "round" && typeof w.after === "number" && w.after !== w.before)
    return [{ kind: "round", round: w.after }];
  return [];
}

/** What one logged action did, in parts: its strike first, then what its writes did; empty when the log tells nothing. */
export function actionParts({
  entry,
  names,
  ruleset,
}: {
  entry: Pick<FightLogLine, "strike" | "writes">;
  names: Names;
  ruleset: Pick<Ruleset, "resources" | "conditions" | "entities" | "strikes"> | null;
}): LogPart[] {
  const s = entry.strike;
  const strike: LogPart[] =
    s === undefined
      ? []
      : [
          {
            kind: "strike",
            attacker: names.get(s.attackerId)?.name ?? "",
            target: names.get(s.targetId)?.name ?? "",
            means: s.means,
            outcome:
              ruleset?.strikes?.find((k) => k.id === s.strikeId)?.outcomes.find((o) => o.id === s.outcome)?.label ??
              s.outcome,
            total: s.total,
          },
        ];
  return [...strike, ...entry.writes.flatMap((w) => partsOf({ w, names, ruleset }))];
}

/** One HISTORY line: an action of the session, when it was taken, and what it did. */
export type HistoryEntry = LogLine & { at: string };

/**
 * HISTORY (house decision #133): every logged action of the session the seat is sent, newest first, each worded as the
 * fight's log words it. Unlike the log it leaves none out, since each line can be undone: one the log tells nothing of
 * reads as its count of changes.
 */
export function historyLines({
  history,
  names,
  ruleset,
}: {
  history: readonly HistoryLine[];
  names: Names;
  ruleset: Pick<Ruleset, "resources" | "conditions" | "entities" | "strikes"> | null;
}): HistoryEntry[] {
  return history.map((entry) => {
    const parts = actionParts({ entry, names, ruleset });
    return {
      id: entry.id,
      at: entry.at,
      undone: entry.undone,
      parts: parts.length > 0 ? parts : [{ kind: "other", count: entry.writes.length }],
    };
  });
}

/**
 * The log as rounds of turns of lines, newest first, from the encounter's `log` (already newest first). A strike is one
 * part before what its writes did; an action that left nothing the log tells is left out.
 */
export function fightLog({
  log,
  names,
  ruleset,
}: {
  log: readonly FightLogLine[];
  names: Names;
  ruleset: Pick<Ruleset, "resources" | "conditions" | "entities" | "strikes"> | null;
}): LogRound[] {
  const rounds: LogRound[] = [];
  for (const entry of log) {
    const parts = actionParts({ entry, names, ruleset });
    if (parts.length === 0) continue;
    let round = rounds.at(-1);
    if (round?.round !== entry.round) {
      round = { round: entry.round, turns: [] };
      rounds.push(round);
    }
    let turn = round.turns.at(-1);
    if (turn === undefined || turn.actorId !== entry.actorId) {
      turn = {
        actorId: entry.actorId,
        name: entry.actorId === null ? null : (names.get(entry.actorId)?.name ?? null),
        lines: [],
      };
      round.turns.push(turn);
    }
    turn.lines.push({ id: entry.id, parts, undone: entry.undone });
  }
  return rounds;
}
