import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import {
  actorScope,
  evaluate,
  parseExpr,
  planSpend,
  resourceBounds,
  type ActorState,
  type CompiledRuleset,
  type PlannedCost,
  type RuleState,
  type Spend,
  type SpendPlan,
} from "@inconsistable/rules-engine";

// The pure side of spends (house decision #84): what a character may spend now, read as the server reads it, and the
// words a spend or an ask is shown with. The server still decides; this is the preview that hides what it would refuse.

type Table = Pick<LiveState, "pools" | "encounter" | "campaign">;

/** The actor and the room as the engine's planSpend reads them, from what this seat receives. */
export function spendWorld({
  compiled,
  table,
  actor,
  characters,
}: {
  compiled: CompiledRuleset;
  table: Table;
  actor: Actor;
  characters: number;
}): { actor: ActorState; state: RuleState } {
  const scope = actorScope({
    fields: actor.fields,
    derived: actor.derived,
    resources: actor.resources,
    party: { characters },
    campaign: table.campaign.fields,
  });
  const resources: Record<string, ActorState["resources"][string]> = {};
  for (const [id, value] of Object.entries(actor.resources)) {
    try {
      const { min, max } = resourceBounds({ compiled, resource: id, scope });
      resources[id] = { value, min, max };
    } catch {
      resources[id] = { value, min: 0, max: null };
    }
  }
  const pools = Object.fromEntries(table.pools.map((p) => [p.id, { value: p.value, min: p.min, max: p.max }]));
  const e = table.encounter;
  const turn: RuleState["turn"] =
    e === null
      ? null
      : {
          round: e.round,
          currentId: null,
          order: e.combatants.map((c) => c.actorId),
          barred: e.combatants.filter((c) => c.barred === true).map((c) => c.actorId),
        };
  const state: RuleState = { actors: {}, turn, pools };
  const self: ActorState = { id: actor.id, fields: actor.fields, resources, scope, entity: actor.entity ?? undefined };
  return { actor: self, state: { ...state, actors: { [actor.id]: self } } };
}

/** The spends this actor's type may spend, each read now with the given inputs (each input's min when not given). */
export function offersOf({
  compiled,
  table,
  actor,
  characters,
  inputs = {},
}: {
  compiled: CompiledRuleset;
  table: Table;
  actor: Actor;
  characters: number;
  inputs?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}): { spend: Spend; plan: SpendPlan | null }[] {
  const spends = (compiled.ruleset.spends ?? []).filter(
    (s) => actor.entity !== null && (s.entities === undefined || s.entities.includes(actor.entity)),
  );
  if (spends.length === 0) return [];
  const world = spendWorld({ compiled, table, actor, characters });
  return spends.map((spend) => {
    const picked = { ...defaultInputs(spend), ...inputs[spend.id] };
    const r = planSpend({ ruleset: compiled.ruleset, spendId: spend.id, ...world, inputs: picked });
    return { spend, plan: "code" in r ? null : r };
  });
}

/** Each input at its min. */
export const defaultInputs = (spend: Spend): Record<string, number> =>
  Object.fromEntries(Object.entries(spend.inputs ?? {}).map(([name, def]) => [name, def.min]));

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
export const spendOf = (compiled: CompiledRuleset | null, q: Pick<SpendRequest, "spendId">): Spend | undefined =>
  q.spendId === null ? undefined : compiled?.ruleset.spends?.find((s) => s.id === q.spendId);

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
  const t = world.state.turn;
  const id = world.actor.id;
  const fight = {
    on: t !== null,
    in: t?.order.includes(id) ?? false,
    round: t?.round ?? 0,
    barred: t?.barred?.includes(id) ?? false,
  };
  try {
    const v = evaluate({ node: parseExpr(source), scope: { ...world.actor.scope, ctx: { self: id, fight } } });
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}
