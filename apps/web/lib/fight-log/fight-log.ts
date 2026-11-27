import type { Actor, FieldValue, FightLogLine, HistoryLine } from "@inconsistable/core-schema";
import {
  actorScope,
  campaignValues,
  healthStatesOf,
  withLists,
  type CompiledRuleset,
  type Ruleset,
} from "@inconsistable/rules-engine";

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
  | { kind: "other"; count: number }
  | { kind: "warn"; name: string; text: string };

/** One action as a line: its parts in order, and whether Undo or TURN BACK took it back. */
export type LogLine = { id: string; parts: LogPart[]; undone: boolean };
/** The lines of one turn: whoever was acting when they were taken (null between turns), newest first. */
export type LogTurn = { actorId: string | null; name: string | null; lines: LogLine[] };
/** One round's turns, newest first. */
export type LogRound = { round: number; turns: LogTurn[] };

type Names = ReadonlyMap<
  string,
  Pick<Actor, "name"> & Partial<Pick<Actor, "entity" | "fields" | "resources" | "derived">>
>;

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
  const outcome =
    s === undefined
      ? undefined
      : ruleset?.strikes?.find((k) => k.id === s.strikeId)?.outcomes.find((o) => o.id === s.outcome);
  const target = s === undefined ? "" : (names.get(s.targetId)?.name ?? "");
  const strike: LogPart[] =
    s === undefined
      ? []
      : [
          {
            kind: "strike",
            attacker: names.get(s.attackerId)?.name ?? "",
            target,
            means: s.means,
            outcome: outcome?.label ?? s.outcome,
            total: s.total,
          },
          ...(outcome?.warn === undefined ? [] : [{ kind: "warn" as const, name: target, text: outcome.warn }]),
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

const fieldValue = (v: unknown): v is FieldValue =>
  v === null ||
  typeof v === "number" ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (Array.isArray(v) && v.every((x) => typeof x === "string"));

/**
 * The warnings a line's writes raise (house decision #190): for each actor it wrote, every health state the ruleset
 * words a `warn` for that holds once the writes are made and did not before them. The actor's other values are read as
 * they stand now.
 */
// ponytail: an older line reads the actor's unwritten values as they stand now, so a state that also reads one changed
// since may warn differently than it would have then; the server would keep each actor's values per action to do better
function warningsOf({
  entry,
  names,
  compiled,
  campaign,
}: {
  entry: FightLogLine;
  names: Names;
  compiled: CompiledRuleset;
  campaign?: Readonly<Record<string, number | string | boolean>>;
}): LogPart[] {
  const warned = new Map(compiled.ruleset.health.states.flatMap((s) => (s.warn === undefined ? [] : [[s.id, s.warn]])));
  if (warned.size === 0) return [];
  const written = new Set(
    entry.writes.flatMap((w) =>
      w.target.actorId !== undefined && (w.target.resource !== undefined || w.target.field !== undefined)
        ? [w.target.actorId]
        : [],
    ),
  );
  return [...written].flatMap((id) => {
    const a = names.get(id);
    if (a?.entity === undefined) return [];
    const entity = a.entity;
    // The actor's states with its written values as they were before the line (the first write's) or after (the last).
    const states = (side: "before" | "after") => {
      const fields: Record<string, FieldValue> = { ...a.fields };
      const resources: Record<string, number> = { ...a.resources };
      const writes = entry.writes.filter((w) => w.target.actorId === id);
      for (const w of side === "after" ? writes : writes.toReversed()) {
        const v = w[side];
        if (w.target.resource !== undefined && typeof v === "number") resources[w.target.resource] = v;
        if (w.target.field !== undefined && fieldValue(v)) fields[w.target.field] = v;
      }
      try {
        const scope = actorScope({ fields, derived: a.derived, resources, campaign });
        return healthStatesOf({ compiled, entity, scope: withLists({ ruleset: compiled.ruleset, scope }) });
      } catch {
        return null;
      }
    };
    const before = states("before");
    const after = states("after");
    if (before === null || after === null) return [];
    return after.flatMap((s) =>
      before.includes(s) || !warned.has(s) ? [] : [{ kind: "warn" as const, name: a.name, text: warned.get(s)! }],
    );
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
  compiled = null,
  campaign,
}: {
  log: readonly FightLogLine[];
  names: Names;
  ruleset: Pick<Ruleset, "resources" | "conditions" | "entities" | "strikes"> | null;
  /** The ruleset compiled, for the health states a line's writes bring an actor into; without it, none are told. */
  compiled?: CompiledRuleset | null;
  /** The room's stored campaign values, which a health state may read. */
  campaign?: Readonly<Record<string, unknown>>;
}): LogRound[] {
  const rounds: LogRound[] = [];
  const inPlay = compiled === null ? undefined : campaignValues({ compiled, stored: campaign ?? {} });
  for (const entry of log) {
    const parts = [
      ...actionParts({ entry, names, ruleset }),
      ...(compiled === null ? [] : warningsOf({ entry, names, compiled, campaign: inPlay })),
    ];
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
