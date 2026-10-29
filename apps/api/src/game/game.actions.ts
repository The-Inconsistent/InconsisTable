import { and, eq } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { endMet, ExprError, rankResults, scoreRows } from "@inconsistable/rules-engine";
import { sessionEvent } from "../campaign/campaign.schema.ts";
import { runningSessionId } from "../campaign/event.log.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { closeEncounter } from "../encounter/encounter.actions.ts";
import { activeEncounter } from "../encounter/encounter.turn.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { isPaused, openRuleset } from "../ruleset/ruleset.context.ts";
import { sessionResult } from "./game.schema.ts";

export type GameAction = Extract<Action, { type: "game.end" | "result.set" }>;

const logEvent = async (
  tx: Tx,
  { ctx, type, payload }: { ctx: Ctx; type: "game.end" | "result.set"; payload: Record<string, unknown> },
) => {
  const sessionId = await runningSessionId(tx, ctx.campaignId);
  await tx
    .insert(sessionEvent)
    .values({ campaignId: ctx.campaignId, sessionId, type, seatUserId: ctx.userId, payload });
};

// The end of a game (house decisions #38-#40). Both actions are the combat side's (`encounter:run`); they are logged
// as events of their own, not as deltas, so Undo never takes them back.
export async function applyGameAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: GameAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "game.end": {
      // House decision #28, as encounter.end: nothing ends while the table is away.
      if (await isPaused(tx, cid)) fail("sessionPaused");
      const e = (await activeEncounter(tx, cid)) ?? fail("noEncounterRunning");
      const rc = await openRuleset(tx, ctx);
      const scoring = rc.compiled.scoring ?? fail("noScoring");
      const order = (await rc.turn())?.order ?? [];
      const sight = { ruleset: rc.compiled, actors: rc.built, order };
      // The server sees every value, hidden ones too (house decision #40).
      let rows;
      try {
        rows = scoreRows(sight);
      } catch (err) {
        if (!(err instanceof ExprError)) throw err;
        return fail("callProblem", { name: "score", detail: err.message });
      }
      const met = endMet({ ...sight, round: e.round });
      const ranked = rankResults({ scoring: scoring.def, rows, met });
      const endedEarly = met.length === 0;
      const sessionId = await runningSessionId(tx, cid);
      if (ranked.length > 0) {
        await tx.insert(sessionResult).values(
          ranked.map((r) => ({
            campaignId: cid,
            sessionId,
            encounterId: e.id,
            actorId: r.actorId,
            name: rc.built[r.actorId]?.row.name ?? "",
            score: r.score,
            tiebreaks: r.tiebreaks,
            place: r.place,
            outcome: r.outcome,
            endedEarly,
          })),
        );
      }
      await logEvent(tx, {
        ctx,
        type: "game.end",
        payload: { encounterId: e.id, endedEarly, results: ranked },
      });
      const id = await closeEncounter(tx, { ctx, encounterId: e.id });
      return { ok: true, id: id ?? undefined };
    }

    case "result.set": {
      // The id comes from the client: the row must be this campaign's.
      const [row] = await tx
        .select()
        .from(sessionResult)
        .where(and(eq(sessionResult.id, a.resultId), eq(sessionResult.campaignId, cid)));
      if (!row) return fail("resultNotFound");
      if (row.outcome !== null) return fail("coopNoScore");
      const scoring = (await loadCompiled(tx, cid))?.scoring ?? fail("noScoring");
      const game = await tx
        .select()
        .from(sessionResult)
        .where(and(eq(sessionResult.encounterId, row.encounterId), eq(sessionResult.campaignId, cid)));
      // The row ids stand in for actor ids: a character who is gone has none.
      const ranked = rankResults({
        scoring: scoring.def,
        rows: game.map((r) => ({
          actorId: r.id,
          score: r.id === row.id ? a.score : r.score,
          tiebreaks: r.tiebreaks,
        })),
      });
      for (const r of ranked) {
        await tx.update(sessionResult).set({ score: r.score, place: r.place }).where(eq(sessionResult.id, r.actorId));
      }
      await logEvent(tx, {
        ctx,
        type: "result.set",
        payload: { resultId: row.id, name: row.name, before: row.score, after: a.score },
      });
      return { ok: true };
    }
  }
}
