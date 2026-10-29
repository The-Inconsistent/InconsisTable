import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Game } from "@inconsistable/core-schema";
import type { Db } from "../core/db.ts";
import { sessionResult } from "./game.schema.ts";

/**
 * The campaign's ended games, newest first, each with its rows in place order (a cooperative game's by name). Every seat
 * is sent them all (house decision #40).
 */
// ponytail: last 20 games only, paginate when a campaign keeps more
export async function loadGames(conn: Db, campaignId: string): Promise<Game[]> {
  const recent = await conn
    .select({ encounterId: sessionResult.encounterId, endedAt: max(sessionResult.createdAt) })
    .from(sessionResult)
    .where(eq(sessionResult.campaignId, campaignId))
    .groupBy(sessionResult.encounterId)
    .orderBy(desc(max(sessionResult.createdAt)))
    .limit(20);
  if (recent.length === 0) return [];
  const rows = await conn
    .select()
    .from(sessionResult)
    .where(
      and(
        eq(sessionResult.campaignId, campaignId),
        inArray(
          sessionResult.encounterId,
          recent.map((r) => r.encounterId),
        ),
      ),
    )
    .orderBy(sql`${sessionResult.place} asc nulls last`, asc(sessionResult.name), asc(sessionResult.id));
  return recent.flatMap((g) => {
    const mine = rows.filter((r) => r.encounterId === g.encounterId);
    const first = mine[0];
    if (!first || !g.endedAt) return [];
    return [
      {
        encounterId: g.encounterId,
        endedAt: g.endedAt.toISOString(),
        endedEarly: first.endedEarly,
        mode: first.outcome === null ? ("compete" as const) : ("coop" as const),
        rows: mine.map((r) => ({
          resultId: r.id,
          actorId: r.actorId,
          name: r.name,
          score: r.score,
          tiebreaks: r.tiebreaks,
          place: r.place,
          outcome: r.outcome,
        })),
      },
    ];
  });
}
