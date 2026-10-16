import { and, asc, eq } from "drizzle-orm";
import type { TurnState } from "@inconsistable/rules-engine";
import type { Db, Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
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
  };
}

export type TurnValue = number | string | null;

/** A turn value now, for undo to compare with what a step left. The order is never logged, so it isn't read. */
export async function readTurn(
  conn: Db,
  { campaignId, key }: { campaignId: string; key: "round" | "currentId" | "order" },
) {
  const turn = await loadTurn(conn, campaignId);
  if (!turn) return null;
  if (key === "order") return [...turn.order];
  return turn[key];
}

/**
 * Writes `round` or `currentId` of the running encounter and says what it held before. `currentId` is an actor id (or
 * null before anyone has acted). The order belongs to the tracker: initiative scores and the GM's tie moves set it.
 */
export async function writeTurn(
  tx: Tx,
  { campaignId, key, value }: { campaignId: string; key: "round" | "currentId" | "order"; value: unknown },
): Promise<{ before: TurnValue; after: TurnValue }> {
  const e = (await activeEncounter(tx, campaignId)) ?? fail("noEncounterRunning");
  if (key === "round") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail("roundWholeNumber");
    await tx.update(encounter).set({ round: value }).where(eq(encounter.id, e.id));
    return { before: e.round, after: value };
  }
  if (key === "order") return fail("orderFromInitiative");
  const rows = await orderedCombatants(tx, e.id);
  const before = rows.find((c) => c.id === e.currentCombatantId)?.actorId ?? null;
  if (value === null) {
    await tx.update(encounter).set({ currentCombatantId: null }).where(eq(encounter.id, e.id));
    return { before, after: null };
  }
  const next = rows.find((c) => c.actorId === value) ?? fail("notInFight");
  await tx.update(encounter).set({ currentCombatantId: next.id }).where(eq(encounter.id, e.id));
  return { before, after: next.actorId };
}
