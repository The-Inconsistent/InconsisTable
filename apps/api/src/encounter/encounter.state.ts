import { and, eq } from "drizzle-orm";
import type { Combatant, Encounter } from "@inconsistable/core-schema";
import type { CompiledRuleset } from "@inconsistable/rules-engine";
import { actor } from "../actor/actor.schema.ts";
import type { BuiltActor } from "../actor/actor.values.ts";
import type { Db } from "../core/db.ts";
import { isPaused } from "../ruleset/ruleset.context.ts";
import { combatant } from "./encounter.schema.ts";
import { activeEncounter } from "./encounter.turn.ts";

/** The resource the tracker draws as health: the ruleset's first health track. */
export const healthResource = (compiled: CompiledRuleset | null) => compiled?.ruleset.health.tracks[0]?.resource;

const COUNTED = new Set(["ownTurnEnd", "roundEnd"]);

/** One actor's health as the tracker shows it: the numbers, and the fraction for the bar. */
function healthOf({ built, resource }: { built: BuiltActor | undefined; resource: string | undefined }) {
  const value = resource === undefined ? undefined : built?.resources[resource];
  const bounds = resource === undefined ? undefined : built?.bounds[resource];
  if (value === undefined || !bounds) return { hp: null, bar: null };
  const span = bounds.max === null ? 0 : bounds.max - bounds.min;
  return {
    hp: { value, max: bounds.max },
    bar: span > 0 ? Math.min(1, Math.max(0, (value - bounds.min) / span)) : null,
  };
}

/**
 * The running encounter as the GM sees it, whole: combatants in turn order, each with its health and conditions.
 * the Seat view module (`seatView`) cuts it down for every other seat.
 */
export async function loadEncounter(
  conn: Db,
  {
    campaignId,
    compiled,
    built,
  }: { campaignId: string; compiled: CompiledRuleset | null; built: Record<string, BuiltActor> },
): Promise<Encounter | null> {
  const e = await activeEncounter(conn, campaignId);
  if (!e) return null;
  const rows = await conn
    .select({ c: combatant, name: actor.name })
    .from(combatant)
    .innerJoin(actor, eq(actor.id, combatant.actorId))
    .where(and(eq(combatant.encounterId, e.id), eq(actor.campaignId, campaignId)))
    .orderBy(combatant.ord, combatant.id);
  const resource = healthResource(compiled);
  return {
    id: e.id,
    round: e.round,
    currentId: e.currentCombatantId,
    paused: await isPaused(conn, campaignId),
    health:
      resource === undefined
        ? null
        : {
            resource,
            temp: compiled?.ruleset.health.tracks[0]?.temp ?? null,
            deathSaves: compiled?.ruleset.health.tracks[0]?.deathSaves !== undefined,
          },
    conditionDefs: Object.entries(compiled?.conditions ?? {}).map(([id, c]) => ({
      id,
      label: c.label,
      duration: c.duration,
    })),
    combatants: rows.map(({ c, name }): Combatant => {
      const b = Object.hasOwn(built, c.actorId) ? built[c.actorId] : undefined;
      return {
        id: c.id,
        actorId: c.actorId,
        name,
        side: c.side,
        ord: c.ord,
        initiative: c.initiativeScore,
        visibility: c.visibility,
        keep: c.keep,
        ...healthOf({ built: b, resource }),
        conditions: Object.values(b?.conditions ?? {}).map((r) => ({
          id: r.conditionId,
          left: COUNTED.has(r.expiresOn) ? (r.expiresAfter ?? 1) : null,
          expiresOn: r.expiresOn,
        })),
      };
    }),
  };
}
