import assert from "node:assert/strict";

import { compileRuleset, type CompiledRuleset } from "../compile.ts";
import type { FieldValue } from "../derived.ts";
import { SAMPLE_D20 } from "../fixtures/sample-d20.ts";
import { HealthTracksParams } from "./health-tracks.ts";
import type { ConditionState, Delta, ResourceState, RuleState, TurnState } from "./primitive.ts";
import { runOp } from "./registry.ts";

// Shared by the primitive tests: the compiled sample ruleset, a one-actor state and a stand-in for the write step.

function compiled(): CompiledRuleset {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}
export const C = compiled();
const check = C.tests.check?.def;
if (check?.kind !== "sumVsTarget") throw new Error("the sample ruleset has no check test");
export const CHECK = check;
if (C.initiative === null) throw new Error("the sample ruleset has no initiative");
export const INIT = C.initiative.def;
export const HEALTH = HealthTracksParams.parse(C.ruleset.health);

export function actor({
  id = "pc1",
  hp = { value: 10, min: 0, max: 15 },
  tempHp,
  fields = {},
}: {
  id?: string;
  hp?: ResourceState;
  tempHp?: ResourceState;
  fields?: Record<string, FieldValue>;
}): RuleState {
  const resources: Record<string, ResourceState> = { hp, ...(tempHp === undefined ? {} : { tempHp }) };
  return { actors: { [id]: { id, fields, resources } }, turn: null };
}

export function deltas(args: Parameters<typeof runOp>[0]): Delta[] {
  const r = runOp(args);
  if (!r.ok) throw new Error(`${r.refusal.code}: ${r.refusal.message}`);
  return r.deltas;
}

export function refusal(args: Parameters<typeof runOp>[0]): string {
  const r = runOp(args);
  assert.equal(r.ok, false, "should be refused");
  return r.ok ? "" : r.refusal.code;
}

/** Applies deltas to a copy of the state, the way the pipeline would write them. */
export function applyDeltas(state: RuleState, list: readonly Delta[]): RuleState {
  const actors = structuredClone(state.actors) as Record<
    string,
    {
      id: string;
      fields: Record<string, FieldValue>;
      resources: Record<string, ResourceState>;
      conditions?: ConditionState[];
    }
  >;
  let turn: TurnState | null = state.turn === null ? null : { ...state.turn };
  for (const d of list) {
    const t = d.target;
    if ("turn" in t) {
      turn ??= { round: 0, currentId: null, order: [] };
      if (t.turn === "round" && typeof d.value === "number") turn.round = d.value;
      if (t.turn === "currentId" && (typeof d.value === "string" || d.value === null)) turn.currentId = d.value;
      if (t.turn === "firstId" && (typeof d.value === "string" || d.value === null)) turn.firstId = d.value;
      if (t.turn === "phaseId" && (typeof d.value === "string" || d.value === null)) turn.phaseId = d.value;
      if (t.turn === "done" && Array.isArray(d.value)) turn.done = d.value;
      if (t.turn === "order" && Array.isArray(d.value)) turn.order = d.value;
      continue;
    }
    if (!("actorId" in t)) continue;
    const a = actors[t.actorId];
    assert.ok(a !== undefined);
    if ("resource" in t) {
      const res = a.resources[t.resource];
      assert.ok(res !== undefined && typeof d.value === "number");
      res.value = d.kind === "add" ? res.value + d.value : d.value;
    } else if ("condition" in t) {
      const row = a.conditions?.find((c) => c.id === t.condition);
      assert.ok(row !== undefined && a.conditions !== undefined);
      if (d.kind === "set" && d.value === null) a.conditions = a.conditions.filter((c) => c !== row);
      else if (d.kind === "add" && typeof d.value === "number") row.expiresAfter = (row.expiresAfter ?? 1) + d.value;
      else assert.fail("a condition delta is an add or a removal");
    } else a.fields[t.field] = d.value;
  }
  return { actors, turn };
}
