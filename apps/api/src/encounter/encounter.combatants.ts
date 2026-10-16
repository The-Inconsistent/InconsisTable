import { sql } from "drizzle-orm";
import type { CombatSide, CombatVisibility } from "@inconsistable/core-schema";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { combatant } from "./encounter.schema.ts";
import { orderedCombatants } from "./encounter.turn.ts";
import { rankIds } from "./encounter.plan.ts";

/** Writes `ord` 0..n-1 in the order given. */
export async function renumber(tx: Tx, ids: readonly string[]) {
  if (ids.length === 0) return;
  await tx.execute(sql`
    UPDATE combatant c SET ord = u.n::int - 1
    FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) WITH ORDINALITY AS u(v, n)
    WHERE c.id = u.v::uuid`);
}

/** Ranks the whole encounter again by initiative (those without one last) and numbers it. */
export async function rerank(tx: Tx, encounterId: string) {
  await renumber(tx, rankIds(await orderedCombatants(tx, encounterId)));
}

/**
 * Puts actors of this campaign into an encounter. The caller has checked the encounter is the campaign's; the actors
 * are looked up here against `campaignId`, never trusted from the client.
 */
export async function addCombatants(
  tx: Tx,
  {
    campaignId,
    encounterId,
    actorIds,
    side,
    visibility,
  }: {
    campaignId: string;
    encounterId: string;
    actorIds: readonly string[];
    side: CombatSide;
    visibility: CombatVisibility;
  },
) {
  const wanted = [...new Set(actorIds)];
  const found = await tx.execute<{ id: string; name: string }>(sql`
    SELECT a.id, a.name FROM actor a
    WHERE a.campaign_id = ${campaignId}::uuid AND a.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb)::uuid)`);
  if (found.rows.length !== wanted.length) fail("characterNotFound");
  const rows = await orderedCombatants(tx, encounterId);
  const present = new Set(rows.map((c) => c.actorId));
  const dupe = found.rows.find((a) => present.has(a.id));
  if (dupe) fail("alreadyInFight", { name: dupe.name });
  const next = rows.reduce((n, c) => Math.max(n, c.ord + 1), 0);
  await tx
    .insert(combatant)
    .values(wanted.map((actorId, i) => ({ encounterId, actorId, side, visibility, ord: next + i })));
  await rerank(tx, encounterId);
}

/** One combatant of the campaign's running encounter, or a refusal. */
export async function ownCombatant(tx: Tx, { campaignId, id }: { campaignId: string; id: string }) {
  const res = await tx.execute<{ id: string; encounter_id: string }>(sql`
    SELECT c.id, c.encounter_id FROM combatant c JOIN encounter e ON e.id = c.encounter_id
    WHERE c.id = ${id}::uuid AND e.campaign_id = ${campaignId}::uuid AND e.active`);
  const row = res.rows[0] ?? fail("notInFight");
  return { id: row.id, encounterId: row.encounter_id };
}
