import { and, eq, inArray } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { runningSessionId } from "../campaign/event.log.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { isPaused, openRuleset, openRulesetIfPinned } from "../ruleset/ruleset.context.ts";
import { addCombatants, ownCombatant, renumber, rerank } from "./encounter.combatants.ts";
import { movedIds, planNext, planPrev } from "./encounter.plan.ts";
import { combatant, encounter } from "./encounter.schema.ts";
import { activeEncounter, orderedCombatants } from "./encounter.turn.ts";

export type EncounterRunAction = Extract<
  Action,
  {
    type:
      | "encounter.start"
      | "encounter.end"
      | "encounter.add"
      | "encounter.remove"
      | "encounter.setInitiative"
      | "encounter.move"
      | "encounter.setVisibility"
      | "encounter.keep"
      | "turn.next"
      | "turn.prev";
  }
>;

const running = async (tx: Tx, campaignId: string) =>
  (await activeEncounter(tx, campaignId)) ?? fail("noEncounterRunning");

// The combat tracker (docs/p1-plan.md, F). Every action here is the combat side's (`encounter:run`). A turn change runs
// the engine and writes its deltas through the same pipeline as any rule, so the log and Undo cover it.
export async function applyEncounterAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: EncounterRunAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  // House decision #28: an encounter may stay open across sessions, but nothing moves until the next one starts.
  if (a.type !== "encounter.start" && (await isPaused(tx, cid))) fail("sessionPaused");
  switch (a.type) {
    case "encounter.start": {
      const sessionId = (await runningSessionId(tx, cid)) ?? fail("startSessionFirst");
      if (await activeEncounter(tx, cid)) fail("encounterRunning");
      const [row] = await tx.insert(encounter).values({ campaignId: cid, sessionId }).returning({ id: encounter.id });
      return { ok: true, id: row!.id }; // the row was just inserted
    }

    case "encounter.end": {
      const e = await running(tx, cid);
      const rows = await tx
        .select({ id: combatant.id, actorId: combatant.actorId, keep: combatant.keep, temporary: actor.temporary })
        .from(combatant)
        .innerJoin(actor, eq(actor.id, combatant.actorId))
        .where(and(eq(combatant.encounterId, e.id), eq(actor.kind, "creature")));
      const doomed = new Set(rows.filter((r) => r.temporary && !r.keep).map((r) => r.actorId));

      // Expiry, then the rest, as one logged action (house decision #15) for everyone who stays; the creatures about to
      // be deleted have nothing to restore.
      let actionId: string | null = null;
      // The top guard refused a paused tracker, so a session runs here and `conditions.expire` may run.
      const rc = await openRulesetIfPinned(tx, ctx);
      if (rc) {
        const exclude = doomed;
        const deltas = [
          ...(await rc.run({ primitive: "conditions.expire", op: "encounterEnd", input: {}, exclude })),
          ...(await rc.run({ primitive: "rest", op: "apply", input: { event: "encounterEnd" }, exclude })),
        ];
        actionId = await rc.apply(deltas);
      }
      await tx.update(encounter).set({ active: false, currentCombatantId: null }).where(eq(encounter.id, e.id));
      // ponytail: these deletes can't be undone (house decision #26); undo skips their steps like any deleted actor
      if (doomed.size > 0) await tx.delete(actor).where(and(eq(actor.campaignId, cid), inArray(actor.id, [...doomed])));
      return { ok: true, id: actionId ?? undefined };
    }

    case "encounter.add": {
      const e = await running(tx, cid);
      await addCombatants(tx, {
        campaignId: cid,
        encounterId: e.id,
        actorIds: a.actorIds,
        side: a.side,
        visibility: a.visibility,
      });
      return { ok: true };
    }

    case "encounter.remove": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      const e = await running(tx, cid);
      const rows = await orderedCombatants(tx, c.encounterId);
      // The one whose turn it is leaves: the turn passes to whoever follows, or to nobody when they were last.
      if (e.currentCombatantId === c.id) {
        const following = rows[rows.findIndex((r) => r.id === c.id) + 1];
        await tx
          .update(encounter)
          .set({ currentCombatantId: following?.id ?? null })
          .where(eq(encounter.id, e.id));
      }
      await tx.delete(combatant).where(eq(combatant.id, c.id));
      await renumber(
        tx,
        rows.filter((r) => r.id !== c.id).map((r) => r.id),
      );
      return { ok: true };
    }

    case "encounter.setInitiative": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      await tx.update(combatant).set({ initiativeScore: a.score }).where(eq(combatant.id, c.id));
      await rerank(tx, c.encounterId);
      return { ok: true };
    }

    case "encounter.move": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      const rows = await orderedCombatants(tx, c.encounterId);
      await renumber(tx, movedIds({ rows, id: c.id, direction: a.direction }));
      return { ok: true };
    }

    case "encounter.setVisibility": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      await tx.update(combatant).set({ visibility: a.visibility }).where(eq(combatant.id, c.id));
      return { ok: true };
    }

    case "encounter.keep": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      await tx.update(combatant).set({ keep: a.keep }).where(eq(combatant.id, c.id));
      return { ok: true };
    }

    case "turn.next":
    case "turn.prev": {
      const rc = await openRuleset(tx, ctx);
      const turn = (await rc.turn()) ?? fail("noEncounterRunning");
      const state = rc.state({ turn });
      const deltas = a.type === "turn.next" ? planNext({ ruleset: rc.compiled.ruleset, state }) : planPrev({ state });
      const id = await rc.apply(deltas);
      return { ok: true, id: id ?? undefined };
    }
  }
}
