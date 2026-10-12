import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { type FieldType, type LogValue, type Written, readTarget, writeDelta } from "../actor/actor.delta.ts";
import { fieldTypeOf } from "../actor/actor.pipeline.ts";
import { loadBuilt } from "../actor/actor.values.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { sessionEvent } from "./campaign.schema.ts";
import { LoggedDelta, runningSessionId } from "./event.log.ts";
import { invertDelta } from "./event.undo.ts";

export type EventAction = Extract<Action, { type: "event.undo" }>;

// Undo (docs/p1-plan.md, decisions 2-3). One logged action of the running session, the newest one that is not undone
// unless the GM names another, is taken back in reverse order inside this transaction, and an `undo` event records it.
// A step that can no longer be taken back refuses the whole undo with a message, and nothing is written. There is no
// redo: the inverse writes are in the undo event, not in new `delta` rows, so they can't be undone in turn.
export async function applyEventAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: EventAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  const sessionId = (await runningSessionId(tx, cid)) ?? fail("No session is running");
  const deltas = and(
    eq(sessionEvent.campaignId, cid),
    eq(sessionEvent.sessionId, sessionId),
    eq(sessionEvent.type, "delta"),
  );

  let actionId: string;
  if (a.actionId !== undefined) {
    const [row] = await tx
      .select({ undoneBy: sessionEvent.undoneBy })
      .from(sessionEvent)
      .where(and(deltas, eq(sessionEvent.actionId, a.actionId)))
      .limit(1);
    if (!row) fail("That step isn't in this session's log");
    if (row.undoneBy) fail("That step is already undone");
    actionId = a.actionId;
  } else {
    const [row] = await tx
      .select({ actionId: sessionEvent.actionId })
      .from(sessionEvent)
      .where(and(deltas, isNull(sessionEvent.undoneBy), isNotNull(sessionEvent.actionId)))
      .orderBy(desc(sessionEvent.createdAt), desc(sessionEvent.id))
      .limit(1);
    if (!row?.actionId) fail("Nothing to undo");
    actionId = row.actionId;
  }

  const compiled = (await loadCompiled(tx, cid)) ?? fail("This game has no ruleset yet");
  const steps = await tx
    .select({ payload: sessionEvent.payload })
    .from(sessionEvent)
    .where(and(deltas, eq(sessionEvent.actionId, actionId)))
    .orderBy(desc(sessionEvent.createdAt), desc(sessionEvent.id));

  const written: Written[] = [];
  for (const step of steps) {
    const logged = LoggedDelta.parse(step.payload);
    const { target } = logged;
    // Read again for every step: an inverse can move another actor's bounds (a level back down lowers the max).
    const built = await loadBuilt(tx, { campaignId: cid, compiled });
    // ponytail: turn and Test steps are never logged yet (writeDelta refuses them); the encounter work undoes them
    if (!("actorId" in target)) fail("Can't undo that kind of step yet");
    const actor = Object.hasOwn(built, target.actorId) ? built[target.actorId] : undefined;
    if (!actor) fail("Can't undo: that character is gone");

    let fieldType: FieldType | undefined;
    let current: LogValue = null;
    if ("field" in target) {
      fieldType = fieldTypeOf({ compiled, actor, field: target.field, samples: [logged.before, logged.after] });
    }
    if (!("resource" in target)) current = await readTarget(tx, { campaignId: cid, target, fieldType });

    const inverse = invertDelta({ logged, current });
    if (!inverse.ok) fail(inverse.message);
    if (inverse.delta === null) continue;
    const bounds = "resource" in target ? actor.bounds[target.resource] : undefined;
    written.push(await writeDelta(tx, { campaignId: cid, delta: inverse.delta, bounds, fieldType }));
  }

  const [event] = await tx
    .insert(sessionEvent)
    .values({
      campaignId: cid,
      sessionId,
      type: "undo",
      actionId: crypto.randomUUID(),
      seatUserId: ctx.userId,
      payload: { undone: actionId, deltas: written },
    })
    .returning({ id: sessionEvent.id });
  await tx
    .update(sessionEvent)
    .set({ undoneBy: event!.id }) // the row was just inserted
    .where(and(deltas, eq(sessionEvent.actionId, actionId)));
  return { ok: true, id: actionId };
}
