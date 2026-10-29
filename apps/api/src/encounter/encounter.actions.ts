import { and, eq, inArray } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { runningSessionId } from "../campaign/event.log.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { isPaused, openRuleset, openRulesetIfPinned } from "../ruleset/ruleset.context.ts";
import { addCombatants, ownCombatant, renumber, rerank } from "./encounter.combatants.ts";
import { movedIds, planDone, planNext, planPrev } from "./encounter.plan.ts";
import { combatant, encounter } from "./encounter.schema.ts";
import { activeEncounter, orderedCombatants, writeTurn } from "./encounter.turn.ts";

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
      | "turn.prev"
      | "turn.first"
      | "phase.done";
  }
>;

const running = async (tx: Tx, campaignId: string) =>
  (await activeEncounter(tx, campaignId)) ?? fail("noEncounterRunning");

/** The room's ruleset runs a seated order (house decision #36): no scores, a first player. */
const isSeated = async (tx: Tx, campaignId: string) =>
  (await loadCompiled(tx, campaignId))?.ruleset.initiative.strategy === "seated";

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
      // A ruleset with phases opens the game in its first one (house decision #37).
      const phaseId = (await loadCompiled(tx, cid))?.ruleset.phases?.[0]?.id ?? null;
      const [row] = await tx
        .insert(encounter)
        .values({ campaignId: cid, sessionId, phaseId })
        .returning({ id: encounter.id });
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
      await tx
        .update(encounter)
        .set({ active: false, currentCombatantId: null, firstCombatantId: null })
        .where(eq(encounter.id, e.id));
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
      // A seated game has a first player from the first seat on; the table's seat order is `ord`.
      if (e.firstCombatantId === null && (await isSeated(tx, cid))) {
        const [top] = await orderedCombatants(tx, e.id);
        await tx
          .update(encounter)
          .set({ firstCombatantId: top?.id ?? null })
          .where(eq(encounter.id, e.id));
      }
      return { ok: true };
    }

    case "encounter.remove": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      const e = await running(tx, cid);
      const rows = await orderedCombatants(tx, c.encounterId);
      const rc = (await isSeated(tx, cid)) ? await openRuleset(tx, ctx) : null;
      if (rc) {
        // Seated: the engine moves the first player and the turn (#36, #3); the order itself is the tracker's.
        const actorId = rows.find((r) => r.id === c.id)?.actorId ?? fail("notInFight");
        // With phases, the one acting leaves as if their turn ended, so the phase or round moves on as #37 says.
        let after = rc;
        if (rc.compiled.ruleset.phases && e.currentCombatantId === c.id && rows.length > 1) {
          const turn = (await rc.turn()) ?? fail("noEncounterRunning");
          await rc.apply(planNext({ ruleset: rc.compiled.ruleset, state: rc.state({ turn }) }));
          after = await openRuleset(tx, ctx); // the context holds the turn it first read
        }
        const deltas = await after.run({ primitive: "initiative.seated", op: "remove", input: { id: actorId } });
        for (const d of deltas) {
          if ("turn" in d.target && d.target.turn !== "order") {
            await writeTurn(tx, { campaignId: cid, key: d.target.turn, value: d.value });
          }
        }
      } else if (e.currentCombatantId === c.id) {
        // The one whose turn it is leaves: the turn passes to whoever follows, or to nobody when they were last.
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
      if (await isSeated(tx, cid)) fail("noSeatedScores");
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
      const { ruleset } = rc.compiled;
      const deltas = a.type === "turn.next" ? planNext({ ruleset, state }) : planPrev({ ruleset, state });
      const id = await rc.apply(deltas);
      return { ok: true, id: id ?? undefined };
    }

    case "phase.done": {
      const rc = await openRuleset(tx, ctx);
      const turn = (await rc.turn()) ?? fail("noEncounterRunning");
      const deltas = planDone({ ruleset: rc.compiled.ruleset, state: rc.state({ turn }), actorId: a.actorId });
      const id = await rc.apply(deltas);
      return { ok: true, id: id ?? undefined };
    }

    case "turn.first": {
      const c = await ownCombatant(tx, { campaignId: cid, id: a.combatantId });
      if (!(await isSeated(tx, cid))) fail("notSeated");
      const rc = await openRuleset(tx, ctx);
      const actorId =
        (await orderedCombatants(tx, c.encounterId)).find((r) => r.id === c.id)?.actorId ?? fail("notInFight");
      const id = await rc.apply(await rc.run({ primitive: "initiative.seated", op: "first", input: { id: actorId } }));
      return { ok: true, id: id ?? undefined };
    }
  }
}
