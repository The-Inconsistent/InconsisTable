import { and, eq } from "drizzle-orm";
import { canInCampaign, seatRole, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import {
  AdvantageMode,
  PoolRoll,
  type CompiledRuleset,
  type CompiledTest,
  type PoolFlag,
} from "@inconsistable/rules-engine";
import { loadBuilt } from "../actor/actor.values.ts";
import { runningSessionId } from "../campaign/event.log.ts";
import { sessionEvent } from "../campaign/campaign.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { checkInputs, evaluateCall, resolvePoolRoll, resolveRoll } from "./test-call.resolve.ts";
import { testCall, testCallTarget, testReport } from "./test-call.schema.ts";

export type TestCallAction = Extract<Action, { type: "test.call" | "test.report" | "test.close" }>;

const find = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(rec, key) ? rec[key] : undefined;

const testOf = ({ compiled, testId }: { compiled: CompiledRuleset; testId: string }): CompiledTest =>
  find(compiled.tests, testId) ?? fail("noSuchTest", { test: testId });

/** An open call of this campaign; an id from the client is never trusted. */
async function openCall(tx: Tx, { campaignId, callId }: { campaignId: string; callId: string }) {
  const [call] = await tx
    .select()
    .from(testCall)
    .where(and(eq(testCall.id, callId), eq(testCall.campaignId, campaignId)));
  if (!call) fail("testNotHere");
  if (call.status === "closed") fail("testClosed");
  return call;
}

/** The log keeps the whole story (the recap draws on it); it is a GM-side document and never reaches a phone. */
async function log(
  tx: Tx,
  {
    ctx,
    type,
    payload,
  }: { ctx: Ctx; type: "test.call" | "test.report" | "test.close"; payload: Record<string, unknown> },
) {
  const sessionId = await runningSessionId(tx, ctx.campaignId);
  await tx
    .insert(sessionEvent)
    .values({ campaignId: ctx.campaignId, sessionId, type, seatUserId: ctx.userId, payload });
}

type Target = typeof testCallTarget.$inferSelect;

// The columns of a sum Test's report: the faces as read, the die before the modifier, the total and the outcome.
function sumRow({
  test,
  target,
  advantage,
  roll,
}: {
  test: CompiledTest;
  target: Target;
  advantage: AdvantageMode;
  roll: Record<string, unknown>;
}) {
  const resolved = resolveRoll({ test, target: target.target, modifier: target.modifier, advantage, roll });
  if (!resolved.ok) fail("testProblem", { detail: resolved.message });
  const faces = Array.isArray(roll.faces) ? roll.faces.filter((f): f is number => typeof f === "number") : null;
  return {
    faces,
    natural: resolved.natural,
    total: resolved.total,
    outcome: resolved.outcome,
    bandCounts: null,
    specialFaces: null,
    margin: null,
    shifts: null,
    flags: [] as PoolFlag[],
  };
}

// The columns of a Dice pool's report: dice counted per band, the special dice's faces, and what the server worked out.
function poolRow({
  test,
  target,
  advantage,
  roll,
}: {
  test: CompiledTest;
  target: Target;
  advantage: AdvantageMode;
  roll: Record<string, unknown>;
}) {
  if (advantage !== "none") fail("poolNoAdvantage");
  const resolved = resolvePoolRoll({ test, target: target.target, pool: target.pool ?? 0, roll });
  if (!resolved.ok) fail("testProblem", { detail: resolved.message });
  const parsed = PoolRoll.parse(roll); // resolvePoolRoll just accepted it
  return {
    faces: null,
    natural: null,
    total: resolved.score,
    outcome: resolved.outcome,
    bandCounts: parsed.counts,
    specialFaces: parsed.special,
    margin: resolved.margin,
    shifts: resolved.shifts,
    flags: resolved.flags,
  };
}

// `test:call` for the call and the close, `test:report:own` for a report (the permission was checked by the dispatch,
// with the called character as the target). The dice stay physical: nothing here rolls (docs/house-decisions.md #1).
export async function applyTestCallAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: TestCallAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "test.call": {
      const compiled = (await loadCompiled(tx, cid)) ?? fail("noRuleset");
      const test = testOf({ compiled, testId: a.testId });
      const bad = checkInputs({ test, inputs: a.inputs });
      if (bad) fail("testProblem", { detail: bad });
      const built = await loadBuilt(tx, { campaignId: cid, compiled });
      const actorIds = [...new Set(a.actorIds)];
      // Computed now, for each character, and kept: what the phone shows must not move under a player's hand.
      const targets = actorIds.map((actorId) => {
        const actor = find(built, actorId) ?? fail("characterNotFound");
        if (actor.entity === "") fail("notBuilt", { name: actor.row.name });
        if (actor.scope === null) fail("incomplete", { name: actor.row.name, detail: actor.problem ?? "" });
        const r = evaluateCall({ test, scope: actor.scope, inputs: a.inputs });
        if (!r.ok) fail("callProblem", { name: actor.row.name, detail: r.message });
        return { actorId, modifier: r.modifier, target: r.target, pool: r.pool };
      });
      const [call] = await tx
        .insert(testCall)
        .values({
          campaignId: cid,
          sessionId: await runningSessionId(tx, cid),
          testId: a.testId,
          inputs: a.inputs,
          hideTarget: a.hideTarget,
          showOutcome: a.showOutcome,
          createdByUserId: ctx.userId,
        })
        .returning({ id: testCall.id });
      if (!call) fail("cantCallTest"); // the row was just inserted
      await tx.insert(testCallTarget).values(targets.map((t) => ({ callId: call.id, ...t })));
      await log(tx, {
        ctx,
        type: "test.call",
        payload: { callId: call.id, testId: a.testId, inputs: a.inputs, hideTarget: a.hideTarget, targets },
      });
      return { ok: true, id: call.id };
    }

    case "test.report": {
      const call = await openCall(tx, { campaignId: cid, callId: a.callId });
      const compiled = (await loadCompiled(tx, cid)) ?? fail("noRuleset");
      const test = testOf({ compiled, testId: call.testId });
      const [target] = await tx
        .select()
        .from(testCallTarget)
        .where(and(eq(testCallTarget.callId, call.id), eq(testCallTarget.actorId, a.actorId)));
      if (!target) fail("notCalled");
      const [had] = await tx
        .select({ actorId: testReport.actorId })
        .from(testReport)
        .where(and(eq(testReport.callId, call.id), eq(testReport.actorId, a.actorId)));
      // A player's first report stands, so a roll that failed can't be quietly retaken; the GM side corrects one.
      const gmSide = canInCampaign({ ctx, perm: "test:call" });
      if (had && !gmSide) fail("alreadyReported");
      const advantage = AdvantageMode.safeParse(a.advantage);
      if (!advantage.success) fail("badAdvantage", { advantage: a.advantage });
      const row = {
        advantage: advantage.data,
        reportedByUserId: ctx.userId,
        reportedByRole: seatRole(ctx.seat),
        reportedAt: new Date(),
        ...(test.def.kind === "poolSuccesses"
          ? poolRow({ test, target, advantage: advantage.data, roll: a.roll })
          : sumRow({ test, target, advantage: advantage.data, roll: a.roll })),
      };
      await tx
        .insert(testReport)
        .values({ callId: call.id, actorId: a.actorId, ...row })
        .onConflictDoUpdate({ target: [testReport.callId, testReport.actorId], set: row });
      await log(tx, {
        ctx,
        type: "test.report",
        payload: { callId: call.id, actorId: a.actorId, ...row, replaced: had !== undefined },
      });
      return { ok: true };
    }

    case "test.close": {
      const call = await openCall(tx, { campaignId: cid, callId: a.callId });
      await tx
        .update(testCall)
        .set({ status: "closed", closedAt: new Date(), revealed: a.reveal })
        .where(eq(testCall.id, call.id));
      const reports = await tx.select().from(testReport).where(eq(testReport.callId, call.id));
      await log(tx, {
        ctx,
        type: "test.close",
        payload: {
          callId: call.id,
          testId: call.testId,
          revealed: a.reveal,
          reports: reports.map((r) => ({
            actorId: r.actorId,
            natural: r.natural,
            total: r.total,
            margin: r.margin,
            flags: r.flags,
            outcome: r.outcome,
          })),
        },
      });
      return { ok: true };
    }
  }
}
