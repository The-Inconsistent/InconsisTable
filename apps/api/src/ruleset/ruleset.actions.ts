import { Permission, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import { PRIMITIVES, ResetEvent, type PrimitiveOp } from "@inconsistable/rules-engine";
import type { ConditionRow } from "../actor/actor.delta.ts";
import { applyDeltas, fieldDef } from "../actor/actor.pipeline.ts";
import { type BuiltActor, loadBuilt } from "../actor/actor.values.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { loadTurn } from "../encounter/encounter.turn.ts";
import { requirePerm } from "../table/table.authorize.ts";
import { loadCompiled } from "./ruleset.compiled.ts";
import { runPrimitive, ruleState } from "./ruleset.run.ts";

export type RuleAction = Extract<
  Action,
  { type: "rule.op" | "field.set" | "condition.add" | "condition.remove" | "actor.rest" }
>;

/** The registered op an action names, for the dispatch to read `touches` from. */
export function primitiveOp(primitive: string, op: string): PrimitiveOp<unknown, unknown> | undefined {
  const prim = Object.hasOwn(PRIMITIVES, primitive) ? PRIMITIVES[primitive] : undefined;
  return prim && Object.hasOwn(prim.ops, op) ? prim.ops[op] : undefined;
}

const find = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(rec, key) ? rec[key] : undefined;

async function load(tx: Tx, campaignId: string) {
  const compiled = (await loadCompiled(tx, campaignId)) ?? fail("This game has no ruleset yet");
  return { compiled, built: await loadBuilt(tx, { campaignId, compiled }), turn: await loadTurn(tx, campaignId) };
}

/** The actor and its entity, or a refusal: values are only written to an actor the ruleset has a type for. */
function entityActor({ built, actorId }: { built: Record<string, BuiltActor>; actorId: string }) {
  const actor = find(built, actorId) ?? fail("Character not found");
  if (actor.entity === "") fail(`${actor.row.name} isn't built for this ruleset yet`);
  return actor;
}

/**
 * Applies a rest or boundary event to one actor or to all of them through the engine's `rest` primitive, and logs it
 * as one action. Used by `actor.rest` and by session start/end (the caller holds `session:run`); with no ruleset
 * pinned there is nothing to reset.
 */
export async function restActors(
  tx: Tx,
  { ctx, event, actorId }: { ctx: Ctx; event: ResetEvent; actorId?: string },
): Promise<{ pinned: boolean; actionId: string | null }> {
  const compiled = await loadCompiled(tx, ctx.campaignId);
  if (!compiled) return { pinned: false, actionId: null };
  const built = await loadBuilt(tx, { campaignId: ctx.campaignId, compiled });
  const input = { event, actorIds: actorId === undefined ? undefined : [actorId] };
  const deltas = runPrimitive({
    ruleset: compiled.ruleset,
    state: ruleState({ built, turn: null }),
    primitive: "rest",
    op: "apply",
    input,
  });
  return { pinned: true, actionId: await applyDeltas(tx, { ctx, compiled, built, deltas }) };
}

export async function applyRuleAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: RuleAction },
): Promise<ActionResult> {
  switch (a.type) {
    case "rule.op": {
      // Steps 3-7 of docs/design.md §5.3: the op's own permission, the op, then every delta through the pipeline.
      const op = primitiveOp(a.primitive, a.op) ?? fail(`No operation "${a.primitive}.${a.op}"`);
      const perm = Permission.safeParse(op.perm);
      if (!perm.success) fail(`"${a.primitive}.${a.op}" declares no permission`);
      const actorId = a.input.actorId;
      requirePerm({ ctx, perm: perm.data, target: typeof actorId === "string" ? { actorId } : undefined });
      const { compiled, built, turn } = await load(tx, ctx.campaignId);
      const deltas = runPrimitive({
        ruleset: compiled.ruleset,
        state: ruleState({ built, turn }),
        primitive: a.primitive,
        op: a.op,
        input: a.input,
      });
      const id = await applyDeltas(tx, { ctx, compiled, built, deltas });
      return { ok: true, id: id ?? undefined };
    }

    case "field.set": {
      const { compiled, built } = await load(tx, ctx.campaignId);
      const actor = entityActor({ built, actorId: a.actorId });
      if (!fieldDef({ compiled, actor, field: a.field })) fail(`${actor.row.name} has no field "${a.field}"`);
      const id = await applyDeltas(tx, {
        ctx,
        compiled,
        built,
        deltas: [{ target: { actorId: a.actorId, field: a.field }, kind: "set", value: a.value }],
      });
      return { ok: true, id: id ?? undefined };
    }

    case "condition.add": {
      const { compiled, built } = await load(tx, ctx.campaignId);
      const actor = entityActor({ built, actorId: a.actorId });
      const def = find(compiled.conditions, a.condition) ?? fail(`No condition "${a.condition}" in this ruleset`);
      // One row per condition: applying it again stacks or refreshes that row, as the manifest says.
      const had = Object.entries(actor.conditions).find(([, c]) => c.conditionId === a.condition);
      let rowId: string = crypto.randomUUID();
      let row: ConditionRow = {
        conditionId: a.condition,
        stacks: 1,
        source: a.source,
        expiresOn: def.duration,
        expiresAfter: a.expiresAfter ?? null,
      };
      if (had) {
        if (def.stacking === "none") return { ok: true }; // applying it again does nothing
        rowId = had[0];
        row =
          def.stacking === "stack"
            ? { ...had[1], stacks: Math.min(had[1].stacks + 1, def.maxStacks ?? 100) }
            : { ...had[1], source: a.source || had[1].source, expiresAfter: a.expiresAfter ?? null };
      }
      const id = await applyDeltas(tx, {
        ctx,
        compiled,
        built,
        deltas: [{ target: { actorId: a.actorId, condition: rowId }, kind: "set", value: row }],
      });
      return { ok: true, id: id ?? undefined };
    }

    case "condition.remove": {
      const { compiled, built } = await load(tx, ctx.campaignId);
      const actor = entityActor({ built, actorId: a.actorId });
      const rows = Object.entries(actor.conditions).filter(([, c]) => c.conditionId === a.condition);
      if (rows.length === 0) fail(`${actor.row.name} doesn't have that condition`);
      const id = await applyDeltas(tx, {
        ctx,
        compiled,
        built,
        deltas: rows.map(([rowId]) => ({
          target: { actorId: a.actorId, condition: rowId },
          kind: "set" as const,
          value: null,
        })),
      });
      return { ok: true, id: id ?? undefined };
    }

    case "actor.rest": {
      const event = ResetEvent.safeParse(a.event);
      if (!event.success) fail(`No rest called "${a.event}"`);
      const rest = await restActors(tx, { ctx, event: event.data, actorId: a.actorId });
      if (!rest.pinned) fail("This game has no ruleset yet");
      return { ok: true, id: rest.actionId ?? undefined };
    }
  }
}
