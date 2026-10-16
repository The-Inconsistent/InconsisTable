import type { Ctx } from "@inconsistable/core-schema";
import type { CompiledRuleset, Delta, RuleState, TurnState } from "@inconsistable/rules-engine";
import { applyDeltas } from "../actor/actor.pipeline.ts";
import { type BuiltActor, loadBuilt } from "../actor/actor.values.ts";
import { runningSessionId } from "../campaign/event.log.ts";
import type { Db, Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { activeEncounter, loadTurn } from "../encounter/encounter.turn.ts";
import { loadCompiled } from "./ruleset.compiled.ts";
import { runPrimitive, ruleState } from "./ruleset.run.ts";

// ponytail: refusal texts copied from today's callers (this base has no refusal codes), switch to the codes when they land
export const NO_RULESET = "This game has no ruleset yet";
export const PAUSED = "Start a session to continue";

/** Primitives that read the turn: they wait for a session (house decision #28). */
const TURN_PRIMITIVES = new Set(["initiative.ranked", "conditions.expire"]);

/** House decision #28: an encounter may stay open across sessions, but nothing moves until the next one starts. */
export async function isPaused(conn: Db, campaignId: string): Promise<boolean> {
  return (await activeEncounter(conn, campaignId)) !== null && (await runningSessionId(conn, campaignId)) === null;
}

/** The state an op reads; `exclude` drops actors (e.g. creatures about to be deleted). */
function stateOf({
  built,
  turn,
  exclude,
}: {
  built: Record<string, BuiltActor>;
  turn: TurnState | null;
  exclude?: ReadonlySet<string>;
}): RuleState {
  const kept = exclude ? Object.fromEntries(Object.entries(built).filter(([id]) => !exclude.has(id))) : built;
  return ruleState({ built: kept, turn });
}

/** What `run` decides with nothing left to load: the exclusion, the pause rule exactly as `rule.op` had it, the op. */
export function decideRun({
  ruleset,
  built,
  turn,
  primitive,
  op,
  input,
  exclude,
  sessionRunning,
}: {
  ruleset: CompiledRuleset["ruleset"];
  built: Record<string, BuiltActor>;
  turn: TurnState | null;
  primitive: string;
  op: string;
  input: unknown;
  exclude?: ReadonlySet<string>;
  sessionRunning: boolean;
}): Delta[] {
  if (turn && TURN_PRIMITIVES.has(primitive) && !sessionRunning) fail(PAUSED);
  return runPrimitive({ ruleset, state: stateOf({ built, turn, exclude }), primitive, op, input });
}

export interface RulesetContext {
  compiled: CompiledRuleset;
  built: Record<string, BuiltActor>;
  /** The running encounter's turn, loaded on first ask. */
  turn(): Promise<TurnState | null>;
  /**
   * Runs one op. Like `rule.op`, the turn is loaded (lazily) and passed for every primitive; pass `turn: null` to run
   * without one (rest at a session boundary). The session is only asked for the turn primitives.
   */
  run(args: {
    primitive: string;
    op: string;
    input: unknown;
    exclude?: ReadonlySet<string>;
    turn?: null;
  }): Promise<Delta[]>;
  /** A state for callers that plan their own deltas (the tracker's next/prev). */
  state(args: { exclude?: ReadonlySet<string>; turn: TurnState | null }): RuleState;
  /** The only write of a context: every delta through the pipeline. Returns the logged action id. */
  apply(deltas: Delta[]): Promise<string | null>;
}

/** The pinned ruleset and every actor built, or null when the campaign has no ruleset. */
export async function openRulesetIfPinned(tx: Tx, ctx: Ctx): Promise<RulesetContext | null> {
  const compiled = await loadCompiled(tx, ctx.campaignId);
  if (!compiled) return null;
  const built = await loadBuilt(tx, { campaignId: ctx.campaignId, compiled });
  let turnLoad: Promise<TurnState | null> | undefined;
  const turn = () => (turnLoad ??= loadTurn(tx, ctx.campaignId));
  return {
    compiled,
    built,
    turn,
    async run({ primitive, op, input, exclude, ...rest }) {
      const t = "turn" in rest ? null : await turn();
      const asksSession = t !== null && TURN_PRIMITIVES.has(primitive);
      const sessionRunning = !asksSession || (await runningSessionId(tx, ctx.campaignId)) !== null;
      return decideRun({ ruleset: compiled.ruleset, built, turn: t, primitive, op, input, exclude, sessionRunning });
    },
    state: ({ exclude, turn: t }) => stateOf({ built, turn: t, exclude }),
    apply: (deltas) => applyDeltas(tx, { ctx, compiled, built, deltas }),
  };
}

/** As `openRulesetIfPinned`, refusing when the campaign has no ruleset. */
export async function openRuleset(tx: Tx, ctx: Ctx): Promise<RulesetContext> {
  return (await openRulesetIfPinned(tx, ctx)) ?? fail(NO_RULESET);
}
