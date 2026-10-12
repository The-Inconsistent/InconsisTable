import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@inconsistable/core-schema";
import { DeltaKind } from "@inconsistable/rules-engine";
import { LogTarget, LogValue, sameValue, type Written } from "../actor/actor.delta.ts";
import type { Db, Tx } from "../core/db.ts";
import { session, sessionEvent } from "./campaign.schema.ts";

// The session log (docs/design.md §5.4): one `delta` row per write, which is what undo reads back. Payloads are JSONB
// documents read whole, so they go through this schema when they come out.
export const LoggedDelta = z.object({ target: LogTarget, kind: DeltaKind, before: LogValue, after: LogValue });
export type LoggedDelta = z.infer<typeof LoggedDelta>;

/** The session being played, or null between sessions (nothing logged then can be undone). */
export async function runningSessionId(conn: Db, campaignId: string): Promise<string | null> {
  const [row] = await conn
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.campaignId, campaignId), isNull(session.endedAt)));
  return row?.id ?? null;
}

/** Logs what an action wrote and says whether it wrote anything. A write that changed nothing leaves no row. */
export async function recordWritten(
  tx: Tx,
  { ctx, actionId, written }: { ctx: Ctx; actionId: string; written: readonly Written[] },
): Promise<boolean> {
  const changed = written.filter((w) => !sameValue(w.before, w.after));
  if (changed.length === 0) return false;
  const sessionId = await runningSessionId(tx, ctx.campaignId);
  await tx.insert(sessionEvent).values(
    changed.map((w) => ({
      campaignId: ctx.campaignId,
      sessionId,
      type: "delta",
      actionId,
      seatUserId: ctx.userId,
      payload: { target: w.target, kind: w.kind, before: w.before, after: w.after } satisfies LoggedDelta,
    })),
  );
  return true;
}
