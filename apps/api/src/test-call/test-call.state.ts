import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { TestCall, TestDef } from "@inconsistable/core-schema";
import { VISIBILITY_RANK, type CompiledRuleset, type Visibility } from "@inconsistable/rules-engine";
import type { BuiltActor } from "../actor/actor.values.ts";
import type { Db } from "../core/db.ts";
import { targetInputs } from "./test-call.resolve.ts";
import { testCall, testCallTarget, testReport } from "./test-call.schema.ts";

// Closed calls older than the session are history, not state. A busy table calls a few Tests an hour.
// ponytail: the newest 50 calls; page the rest into a results screen if a session ever calls more
const MAX_CALLS = 50;

/** The pinned ruleset's Tests as the GM's call form needs them. */
export function testDefsOf(compiled: CompiledRuleset | null): TestDef[] {
  return Object.entries(compiled?.tests ?? {}).map(([id, t]) => ({
    id,
    dice: t.def.dice,
    advantage: t.def.advantage,
    inputs: Object.entries(t.def.inputs).map(([inputId, type]) => ({ id: inputId, type })),
  }));
}

/**
 * The open calls and this session's closed ones, whole (every target number and result): the GM's copy. `toSeatTests`
 * decides what each other seat gets. A number the call computed is told to the table only if the GM didn't hide it and
 * the ruleset lets every called character's owner see what it was computed from.
 */
export async function loadTests(
  conn: Db,
  {
    campaignId,
    sessionId,
    compiled,
    built,
  }: {
    campaignId: string;
    sessionId: string | null;
    compiled: CompiledRuleset | null;
    built: Record<string, BuiltActor>;
  },
): Promise<TestCall[]> {
  if (!compiled) return [];
  const calls = await conn
    .select()
    .from(testCall)
    .where(
      and(
        eq(testCall.campaignId, campaignId),
        or(eq(testCall.status, "open"), sessionId === null ? undefined : eq(testCall.sessionId, sessionId)),
      ),
    )
    .orderBy(desc(testCall.createdAt), desc(testCall.id))
    .limit(MAX_CALLS);
  const callIds = calls.map((c) => c.id);
  if (callIds.length === 0) return [];
  const [targets, reports] = await Promise.all([
    conn.select().from(testCallTarget).where(inArray(testCallTarget.callId, callIds)),
    conn.select().from(testReport).where(inArray(testReport.callId, callIds)),
  ]);
  return calls.flatMap((c) => {
    const test = Object.hasOwn(compiled.tests, c.testId) ? compiled.tests[c.testId] : undefined;
    if (!test) return []; // a Test the pinned ruleset no longer has
    const mine = targets.filter((t) => t.callId === c.id);
    // Never "visible" for an actor the ruleset has no entry for: fail closed, like everything else.
    const everyoneMay = (vis: Record<string, Visibility>) =>
      mine.every((t) => {
        const v = Object.hasOwn(built, t.actorId) ? vis[built[t.actorId]?.entity ?? ""] : undefined;
        return v !== undefined && VISIBILITY_RANK[v] < VISIBILITY_RANK.gm;
      });
    const showTarget = !c.hideTarget && everyoneMay(test.targetVisibility);
    return [
      {
        id: c.id,
        testId: c.testId,
        dice: test.def.dice,
        advantage: test.def.advantage,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        inputs: c.inputs,
        secretInputs: showTarget ? [] : targetInputs(test),
        showTarget,
        showModifier: everyoneMay(test.modifierVisibility),
        showOutcome: c.showOutcome || showTarget,
        revealed: c.revealed,
        called: mine.length,
        reported: reports.filter((r) => r.callId === c.id).length,
        targets: mine.map((t) => {
          const r = reports.find((x) => x.callId === c.id && x.actorId === t.actorId);
          return {
            actorId: t.actorId,
            modifier: t.modifier,
            target: t.target,
            report: r ? { natural: r.natural, total: r.total, outcome: r.outcome } : null,
          };
        }),
      },
    ];
  });
}
