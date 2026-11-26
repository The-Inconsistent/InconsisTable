import {
  canInCampaign,
  type Ctx,
  type TestCall,
  type TestTargetState,
} from "../../../../packages/core-schema/src/index.ts";
import { heldBy, type Sight } from "./view.sight.ts";

/**
 * The calls one seat receives. The session side sees them whole. The table screen sees that a Test is open and how far
 * it is, never who or what. A player sees only the calls that name a character they hold, and in them: the target only
 * if it is shown, their own result only as far as the call allows, and the other characters' results (outcome and die,
 * never the modifier) only once the GM revealed them.
 */
export function seatTests({ tests, ctx, sight }: { tests: readonly TestCall[]; ctx: Ctx; sight: Sight }): TestCall[] {
  if (sight.session) return [...tests];
  const held = heldBy(ctx);
  // Without a GM every call is the whole table's: the targets are public, so each character counts as the seat's own.
  const mineOf = (actorId: string) => sight.tableRun || held.includes(actorId);
  // Without a GM a seat that may call Tests is the table's GM side for offers (house decision #170).
  const offering = sight.tableRun && canInCampaign({ ctx, perm: "test:call" });
  const stripped = { secretInputs: [] };
  if (ctx.seat.kind === "token" && ctx.seat.role === "screen") {
    return tests
      .filter((c) => c.status === "open")
      .map((c) => ({
        ...c,
        ...stripped,
        inputs: {},
        showTarget: false,
        showModifier: false,
        showOutcome: false,
        revealed: false,
        targets: [],
        // What a seat asks to acquire is not the room's screen's (house decision #102).
        acquire: undefined,
      }));
  }
  return tests.flatMap((c) => {
    const mine = c.targets.filter((t) => mineOf(t.actorId));
    if (mine.length === 0) return [];
    const targets = (c.revealed ? c.targets : mine).map((t): TestTargetState => {
      const own = mineOf(t.actorId);
      // A Dice pool's margin and shifts give the difficulty number away (score minus margin), so they follow the
      // number itself, or the GM revealing it; the flags come from the dice the seat read out, so they leak nothing
      // (house decision #30).
      const knowsNumber = c.revealed || (own && c.showTarget);
      const report = t.report && {
        natural: t.report.natural,
        total: own && c.showModifier ? t.report.total : null,
        outcome: own && !c.showOutcome && !c.revealed ? null : t.report.outcome,
        margin: knowsNumber ? t.report.margin : null,
        shifts: knowsNumber ? t.report.shifts : null,
        flags: t.report.flags,
      };
      return {
        actorId: t.actorId,
        modifier: own && c.showModifier ? t.modifier : null,
        target: own && c.showTarget ? t.target : null,
        pool: own && c.showModifier ? t.pool : null,
        report,
        // The state keeps a gmless room's offers only where the call shows what they read (house decision #170).
        ...(offering && (t.offers?.length ?? 0) > 0 ? { offers: t.offers } : {}),
      };
    });
    return [
      {
        ...c,
        ...stripped,
        inputs: Object.fromEntries(Object.entries(c.inputs).filter(([k]) => !c.secretInputs.includes(k))),
        // Players count what concerns them, not how many others were called.
        called: mine.length,
        reported: mine.filter((t) => t.report !== null).length,
        targets,
      },
    ];
  });
}
