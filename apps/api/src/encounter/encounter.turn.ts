import { and, asc, eq, inArray } from "drizzle-orm";
import type { TurnState } from "@inconsistable/rules-engine";
import type { Db, Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { combatant, encounter } from "./encounter.schema.ts";

// The running encounter's turn as the engine reads it, and the one place a `turn` delta is written (actor.delta.ts
// calls writeTurn). Combatants are named by their actor id in the engine's state: an actor is in an encounter once.

/** The campaign's running encounter, or null. */
export async function activeEncounter(conn: Db, campaignId: string) {
  const [row] = await conn
    .select()
    .from(encounter)
    .where(and(eq(encounter.campaignId, campaignId), eq(encounter.active, true)));
  return row ?? null;
}

/** The combatants of one encounter in turn order. */
export function orderedCombatants(conn: Db, encounterId: string) {
  return conn
    .select()
    .from(combatant)
    .where(eq(combatant.encounterId, encounterId))
    .orderBy(asc(combatant.ord), asc(combatant.id));
}

/** What `initiative.ranked` reads: the round, whose turn it is and the order, all as actor ids. Null with no encounter. */
export async function loadTurn(conn: Db, campaignId: string): Promise<TurnState | null> {
  const e = await activeEncounter(conn, campaignId);
  if (!e) return null;
  const rows = await orderedCombatants(conn, e.id);
  return {
    round: e.round,
    currentId: rows.find((c) => c.id === e.currentCombatantId)?.actorId ?? null,
    order: rows.map((c) => c.actorId),
    firstId: rows.find((c) => c.id === e.firstCombatantId)?.actorId ?? null,
    phaseId: e.phaseId,
    done: rows.filter((c) => c.done).map((c) => c.actorId),
  };
}

export type TurnValue = number | string | string[] | null;
export type TurnKey = "round" | "currentId" | "order" | "firstId" | "phaseId" | "done";

/** A turn value now, for undo to compare with what a step left. The order is never logged, so it isn't read. */
export async function readTurn(conn: Db, { campaignId, key }: { campaignId: string; key: TurnKey }) {
  const turn = await loadTurn(conn, campaignId);
  if (!turn) return null;
  if (key === "order") return [...turn.order];
  if (key === "firstId") return turn.firstId ?? null;
  if (key === "phaseId") return turn.phaseId ?? null;
  if (key === "done") return [...(turn.done ?? [])];
  return turn[key];
}

/**
 * Writes `round`, `currentId`, `firstId`, `phaseId` or `done` of the running encounter and says what it held before.
 * `currentId` is an actor id (or null before anyone has acted). The order belongs to the tracker: initiative scores
 * and the GM's tie moves set it.
 */
export async function writeTurn(
  tx: Tx,
  { campaignId, key, value }: { campaignId: string; key: TurnKey; value: unknown },
): Promise<{ before: TurnValue; after: TurnValue }> {
  const e = (await activeEncounter(tx, campaignId)) ?? fail("noEncounterRunning");
  if (key === "round") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail("roundWholeNumber");
    await tx.update(encounter).set({ round: value }).where(eq(encounter.id, e.id));
    return { before: e.round, after: value };
  }
  if (key === "order") return fail("orderFromInitiative");
  if (key === "phaseId") {
    const phases = (await loadCompiled(tx, campaignId))?.ruleset.phases ?? [];
    if (value !== null && !(typeof value === "string" && phases.some((p) => p.id === value))) fail("noSuchPhase");
    await tx
      .update(encounter)
      .set({ phaseId: value as string | null })
      .where(eq(encounter.id, e.id));
    return { before: e.phaseId, after: value as string | null };
  }
  const rows = await orderedCombatants(tx, e.id);
  if (key === "done") {
    // Actor ids of the fight; one that has left (Undo bringing back an earlier list) is dropped without a word.
    const want = new Set(Array.isArray(value) ? value : []);
    const doneNow = (r: { actorId: string }) => want.has(r.actorId);
    for (const flag of [true, false]) {
      const ids = rows.filter((r) => doneNow(r) === flag).map((r) => r.id);
      if (ids.length > 0) await tx.update(combatant).set({ done: flag }).where(inArray(combatant.id, ids));
    }
    return {
      before: rows.filter((r) => r.done).map((r) => r.actorId),
      after: rows.filter(doneNow).map((r) => r.actorId),
    };
  }
  // `firstId` is held exactly like `currentId`: an actor id of the fight, or null.
  const column = key === "firstId" ? "firstCombatantId" : "currentCombatantId";
  const before = rows.find((c) => c.id === e[column])?.actorId ?? null;
  if (value === null) {
    await tx
      .update(encounter)
      .set({ [column]: null })
      .where(eq(encounter.id, e.id));
    return { before, after: null };
  }
  const next = rows.find((c) => c.actorId === value) ?? fail("notInFight");
  await tx
    .update(encounter)
    .set({ [column]: next.id })
    .where(eq(encounter.id, e.id));
  return { before, after: next.actorId };
}
