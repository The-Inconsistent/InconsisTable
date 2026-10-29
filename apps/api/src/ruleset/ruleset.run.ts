import { runOp, type Delta, type Ruleset, type RuleState, type TurnState } from "@inconsistable/rules-engine";
import type { BuiltActor } from "../actor/actor.values.ts";
import { fail } from "../core/errors.ts";

// Steps 4-5 of docs/design.md §5.3 with no database in sight: an op runs against the state it is handed. Kept apart from
// ruleset.actions.ts so the turn planner can be unit tested.

// Where each primitive reads its params in the pinned ruleset (docs/design.md §4.1): `rule.op` never takes params from
// the client. A primitive missing here is not run through `rule.op` yet.
// dice.sumVsTarget takes its params from a named Test, not from the ruleset's one block, so it runs through the
// test.* actions (test-call/). A primitive added to the engine is one line here until the manifest says where its
// params live.
const PRIMITIVE_PARAMS: Readonly<Record<string, (r: Ruleset) => unknown>> = {
  "initiative.ranked": (r) => r.initiative,
  "initiative.seated": (r) => r.initiative,
  "health.tracks": (r) => r.health,
  "resource.capped": () => ({}),
  "conditions.expire": () => ({}),
  rest: () => ({}),
};

/** What the ops read: every actor of the campaign as it is now, and the running encounter's turn (null with none). */
export function ruleState({ built, turn }: { built: Record<string, BuiltActor>; turn: TurnState | null }): RuleState {
  return { actors: Object.fromEntries(Object.entries(built).map(([id, b]) => [id, b.state])), turn };
}

/** Parse, validate and apply one op; its deltas are checked against the op's targets. Refuses with the engine's words. */
export function runPrimitive({
  ruleset,
  state,
  primitive,
  op,
  input,
}: {
  ruleset: Ruleset;
  state: RuleState;
  primitive: string;
  op: string;
  input: unknown;
}): Delta[] {
  const params = Object.hasOwn(PRIMITIVE_PARAMS, primitive) ? PRIMITIVE_PARAMS[primitive] : undefined;
  if (!params) fail("notRunThisWay", { primitive });
  const target = typeof input === "object" && input !== null && "resource" in input ? input.resource : undefined;
  if (primitive === "resource.capped" && ruleset.health.tracks.some((t) => t.resource === target))
    fail("hpThroughDamage");
  const run = runOp({ primitive, op, params: params(ruleset), state, input });
  if (!run.ok) fail(run.refusal.code, { detail: run.refusal.message });
  return run.deltas;
}
