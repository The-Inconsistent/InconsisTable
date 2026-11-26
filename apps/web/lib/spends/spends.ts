import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import {
  actorScope,
  evaluate,
  fightOf,
  parseExpr,
  planSpend,
  resourceBounds,
  withLists,
  type ActorState,
  type CompiledRuleset,
  type PlannedCost,
  type Refusal,
  type RuleState,
  type Ruleset,
  type Spend,
  type SpendPlan,
} from "@inconsistable/rules-engine";

import { turnOf } from "@/lib/fight/fight";

// The pure side of spends (house decision #84): what a character may spend now, read as the server reads it, and the
// words a spend or an ask is shown with. The server still decides; this is the preview that hides what it would refuse.
// It reads the seat's own manifest, which compiles (house decision #101: the parts naming a `gm` resource are cut with
// it): a compiled ruleset only gives a resource its bounds, and without one a resource reads from 0.

type Table = Pick<LiveState, "pools" | "encounter" | "campaign">;

/** The actor and the room as the engine's planSpend reads them, from what this seat receives. */
export function spendWorld({
  ruleset,
  compiled,
  table,
  actor,
  characters,
}: {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  table: Table;
  actor: Actor;
  characters: number;
}): { actor: ActorState; state: RuleState } {
  // An unset list reads as empty, as on the server (house decision #91).
  const scope = withLists({
    ruleset,
    scope: actorScope({
      fields: actor.fields,
      derived: actor.derived,
      resources: actor.resources,
      party: { characters },
      campaign: table.campaign.fields,
    }),
  });
  const resources: Record<string, ActorState["resources"][string]> = {};
  for (const [id, value] of Object.entries(actor.resources)) {
    try {
      if (compiled === null) throw new Error("no bounds");
      const { min, max } = resourceBounds({ compiled, resource: id, scope });
      resources[id] = { value, min, max };
    } catch {
      resources[id] = { value, min: 0, max: null };
    }
  }
  const pools = Object.fromEntries(table.pools.map((p) => [p.id, { value: p.value, min: p.min, max: p.max }]));
  const state: RuleState = { actors: {}, turn: turnOf(table.encounter), pools };
  const self: ActorState = { id: actor.id, fields: actor.fields, resources, scope, entity: actor.entity ?? undefined };
  return { actor: self, state: { ...state, actors: { [actor.id]: self } } };
}

/** The spends this actor's type may spend, each read now with the given inputs (each input's min when not given). */
export function offersOf({
  ruleset,
  compiled,
  table,
  actor,
  characters,
  inputs = {},
}: {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  table: Table;
  actor: Actor;
  characters: number;
  inputs?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}): { spend: Spend; plan: SpendPlan | null; refusal: Refusal | null }[] {
  const spends = (ruleset.spends ?? []).filter(
    (s) => actor.entity !== null && (s.entities === undefined || s.entities.includes(actor.entity)),
  );
  if (spends.length === 0) return [];
  const world = spendWorld({ ruleset, compiled, table, actor, characters });
  return spends.map((spend) => {
    const picked = { ...defaultInputs(spend), ...inputs[spend.id] };
    const r = planSpend({ ruleset, spendId: spend.id, ...world, inputs: picked });
    return "code" in r ? { spend, plan: null, refusal: r } : { spend, plan: r, refusal: null };
  });
}

/** A spend to show: one the server would take now, or one whose limit this round is reached (house decision #91). */
export const shown = (o: { plan: SpendPlan | null; refusal: Refusal | null }) => o.plan !== null || usedUp(o);

/** The spend's limit is reached this round: shown, disabled, with the reason. */
export const usedUp = (o: { refusal: Refusal | null }) => o.refusal?.code === "usedThisRound";

/** Each input at its min. */
export const defaultInputs = (spend: Spend): Record<string, number> =>
  Object.fromEntries(Object.entries(spend.inputs ?? {}).map(([name, def]) => [name, def.min]));

/**
 * The table a spend opens next (house decision #91), with each spend input its `then` names carried onto the table's
 * input: a number on a stepper, held to its bounds, or a switch, on when not 0. Null without one.
 */
export function nextTable({
  ruleset,
  spend,
  inputs,
}: {
  ruleset: Ruleset;
  /** A spend, or anything else with its `then` (a strike, house decision #99). */
  spend: Pick<Spend, "then"> & { inputs?: Spend["inputs"] };
  inputs: Readonly<Record<string, number | boolean>>;
}): { tableId: string; title: string; inputs: Record<string, number | boolean> } | null {
  const then = spend.then;
  const table = then === undefined ? undefined : ruleset.tables?.[then.table];
  if (then === undefined || table === undefined) return null;
  const carried: Record<string, number | boolean> = {};
  for (const x of table.inputs ?? []) {
    const from = then.inputs?.[x.id];
    const v = from === undefined ? undefined : (inputs[from] ?? spend.inputs?.[from]?.min);
    if (v === undefined) continue;
    const n = Number(v);
    carried[x.id] = x.type === "bool" ? n !== 0 : Math.max(x.min ?? -Infinity, Math.min(x.max ?? Infinity, n));
  }
  return { tableId: then.table, title: table.title, inputs: carried };
}

/** A cost in the ruleset's words: "2 Momentum, 1 Resolve"; empty for a free spend. */
export const costText = ({ costs, labels }: { costs: readonly PlannedCost[]; labels: ReadonlyMap<string, string> }) =>
  costs
    .map((c) => {
      const id = c.pool ?? c.resource ?? "";
      return `${c.amount} ${labels.get(id) ?? id}`;
    })
    .join(", ");

/** The inputs of an ask in the spend's words: "Dice 2". */
export const inputsText = ({ spend, inputs }: { spend: Spend | undefined; inputs: Readonly<Record<string, number>> }) =>
  Object.entries(inputs)
    .map(([name, v]) => `${spend?.inputs?.[name]?.label ?? name} ${v}`)
    .join(", ");

/** The spend an ask names, by its id. */
export const spendOf = (ruleset: Ruleset | null, q: Pick<SpendRequest, "spendId">): Spend | undefined =>
  q.spendId === null ? undefined : ruleset?.spends?.find((s) => s.id === q.spendId);

/** The pending spend-asks for one character. */
export const askedFor = ({ requests, actorId }: { requests: readonly SpendRequest[]; actorId: string }) =>
  requests.filter((q) => q.actorId === actorId && q.spendId !== null);

/** The most an input of a spend takes for this actor now (its `max` read as the server reads it); null when unreadable. */
export function inputMax({
  world,
  source,
}: {
  world: { actor: ActorState; state: RuleState };
  source: string;
}): number | null {
  const id = world.actor.id;
  const fight = fightOf(world.state, id);
  try {
    const v = evaluate({ node: parseExpr(source), scope: { ...world.actor.scope, ctx: { self: id, fight } } });
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}
