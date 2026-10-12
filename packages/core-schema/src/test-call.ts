import { z } from "zod";
import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";

// A Test the GM has called (docs/design.md §6.3, docs/p1-plan.md G). The dice stay physical: a seat reports what
// it rolled and the server resolves it with the engine, because the target number may be hidden. Everything here is
// what the *snapshot* carries; `toSeatTests` decides, per seat, which of it leaves the server.

// What the engine calls the outcome (`TestOutcome`) and a Test input's type (`ScalarType`) are the engine's closed
// sets; core-schema can't import the engine, so they travel as strings and the web parses them with the engine's schemas.
export const TestCallStatus = z.enum(["open", "closed"]);
export type TestCallStatus = z.infer<typeof TestCallStatus>;

export const TestInputValue = z.union([z.number(), z.string().max(100), z.boolean()]);
export type TestInputValue = z.infer<typeof TestInputValue>;
export const TestInputs = z.record(z.string().max(64), TestInputValue);
export type TestInputs = z.infer<typeof TestInputs>;

/** A Test of the pinned ruleset the GM can call: what the call form asks for. GM seats only. */
export const TestDef = z.object({
  id: z.string(),
  dice: z.string(),
  advantage: z.boolean(),
  inputs: z.array(z.object({ id: z.string(), type: z.string() })),
});
export type TestDef = z.infer<typeof TestDef>;

/** A reported roll as a seat may see it: a field the seat may not see is null. */
export const TestResult = z.object({
  natural: z.int().nullable(),
  total: z.int().nullable(),
  outcome: z.string().nullable(),
});
export type TestResult = z.infer<typeof TestResult>;

export const TestTargetState = z.object({
  actorId: z.string(),
  /** Added to the die: null when the seat may not be told it (or it was never computed). */
  modifier: z.int().nullable(),
  /** The number to beat: null when it is hidden from the seat. */
  target: z.int().nullable(),
  report: TestResult.nullable(),
});
export type TestTargetState = z.infer<typeof TestTargetState>;

export const TestCall = z.object({
  id: z.string(),
  testId: z.string(),
  dice: z.string(),
  /** Whether the Test allows rolling with advantage or disadvantage. */
  advantage: z.boolean(),
  status: TestCallStatus,
  createdAt: z.string(),
  /** What the GM supplied when calling. Inputs the hidden target reads are removed for seats without GM rights. */
  inputs: TestInputs,
  secretInputs: z.array(z.string()), // GM seats only
  // What the table may be told. The server sets these from the call and the ruleset's declared visibility; a seat
  // below the GM reads them as given. `showOutcome` is already true whenever the target is shown.
  showTarget: z.boolean(),
  showModifier: z.boolean(),
  showOutcome: z.boolean(),
  /** The GM closed the call and showed every result to the characters that were called. */
  revealed: z.boolean(),
  called: z.int(),
  reported: z.int(),
  targets: z.array(TestTargetState),
});
export type TestCall = z.infer<typeof TestCall>;

// Actions. `advantage` and `roll` are the engine's `AdvantageMode` and `SumVsTargetRoll`; the api parses them there.
export const TestCallAction = z.object({
  type: z.literal("test.call"),
  testId: z.string().min(1).max(64),
  actorIds: z.array(z.uuid()).min(1).max(50),
  inputs: TestInputs.default({}),
  hideTarget: z.boolean().default(false),
  // With a hidden target: whether the called players are told success or failure.
  showOutcome: z.boolean().default(false),
});
export const TestReportAction = z.object({
  type: z.literal("test.report"),
  callId: z.uuid(),
  actorId: z.uuid(),
  advantage: z.string().max(20).default("none"),
  roll: z.record(z.string().max(20), z.unknown()),
});
export const TestCloseAction = z.object({
  type: z.literal("test.close"),
  callId: z.uuid(),
  reveal: z.boolean().default(false),
});

/**
 * The calls one seat may see. GM seats (and a co-GM with the session scope) see them whole. The table screen sees that a
 * Test is open and how far it is, never who or what. A player sees only the calls that name a character they hold,
 * and in them: the target only if it is shown, their own result only as far as the call allows, and the other
 * characters' results (outcome and die, never the modifier) only once the GM revealed them.
 */
export function toSeatTests({ tests, ctx }: { tests: readonly TestCall[]; ctx: Ctx }): TestCall[] {
  if (canInCampaign({ ctx, perm: "test:call" })) return [...tests];
  const held = ctx.seat.kind === "admin" ? [] : ctx.seat.characterIds;
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
      }));
  }
  return tests.flatMap((c) => {
    const mine = c.targets.filter((t) => held.includes(t.actorId));
    if (mine.length === 0) return [];
    const targets = (c.revealed ? c.targets : mine).map((t): TestTargetState => {
      const own = held.includes(t.actorId);
      const report = t.report && {
        natural: t.report.natural,
        total: own && c.showModifier ? t.report.total : null,
        outcome: own && !c.showOutcome && !c.revealed ? null : t.report.outcome,
      };
      return {
        actorId: t.actorId,
        modifier: own && c.showModifier ? t.modifier : null,
        target: own && c.showTarget ? t.target : null,
        report,
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
