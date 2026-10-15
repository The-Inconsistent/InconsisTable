import type { Ctx } from "@inconsistable/core-schema";
import { checkFieldValue, type CompiledRuleset, type EditableBy, type Visibility } from "@inconsistable/rules-engine";
import { recordWritten } from "../campaign/event.log.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { type DeltaInput, type FieldType, type LogValue, type Written, writeDelta } from "./actor.delta.ts";
import { checkEditable } from "./actor.edit.ts";
import type { BuiltActor } from "./actor.values.ts";

/** The type of a field the ruleset doesn't declare (the engine's own bookkeeping), read off the value written. */
export function inferFieldType(...samples: LogValue[]): FieldType {
  const v = samples.find((s) => s !== null);
  return Array.isArray(v) ? "list" : typeof v === "boolean" ? "bool" : typeof v === "number" ? "int" : "text";
}

/** A field's declared type, or the best guess from the values seen. */
export function fieldTypeOf({
  compiled,
  actor,
  field,
  samples,
}: {
  compiled: CompiledRuleset;
  actor: BuiltActor;
  field: string;
  samples: LogValue[];
}): FieldType {
  const def = fieldDef({ compiled, actor, field });
  return def?.type ?? inferFieldType(...samples);
}

export function fieldDef({ compiled, actor, field }: { compiled: CompiledRuleset; actor: BuiltActor; field: string }) {
  const ce = Object.hasOwn(compiled.entities, actor.entity) ? compiled.entities[actor.entity] : undefined;
  return ce && Object.hasOwn(ce.def.fields, field) ? ce.def.fields[field] : undefined;
}

/**
 * Pipeline steps 6-7 of docs/design.md §5.3: every delta is checked against what this seat may write (`editableBy`,
 * the declared type and range), written through `writeDelta`, and the whole action is logged under one id, which this
 * returns (null when nothing changed). The caller has already run `can(perm)` and the op. Any refusal throws, so the
 * transaction writes nothing.
 */
export async function applyDeltas(
  tx: Tx,
  {
    ctx,
    compiled,
    built,
    deltas,
    trusted = false,
  }: {
    ctx: Ctx;
    compiled: CompiledRuleset;
    built: Record<string, BuiltActor>;
    deltas: readonly DeltaInput[];
    /** Skips `editableBy`: for the values the engine's own `creation` or a pack entry decided (the types still apply). */
    trusted?: boolean;
  },
): Promise<string | null> {
  const written: Written[] = [];
  for (const delta of deltas) {
    const { target } = delta;
    // ponytail: turn and Test targets have no home until the combat tracker; writeDelta refuses them
    if (!("actorId" in target)) {
      written.push(await writeDelta(tx, { campaignId: ctx.campaignId, delta }));
      continue;
    }
    const actor = Object.hasOwn(built, target.actorId) ? built[target.actorId] : undefined;
    if (!actor) fail("Character not found");
    let editableBy: EditableBy = "gm";
    let visibility: Visibility = "gm"; // undeclared is `gm`, fail-closed
    let what = "that";
    let write: Parameters<typeof writeDelta>[1] = { campaignId: ctx.campaignId, delta };
    if ("resource" in target) {
      const res = Object.hasOwn(compiled.resources, target.resource) ? compiled.resources[target.resource] : undefined;
      const bounds = Object.hasOwn(actor.bounds, target.resource) ? actor.bounds[target.resource] : undefined;
      if (!res || !bounds) fail(`This character has no ${target.resource} to change`);
      editableBy = res.def.editableBy;
      visibility = res.def.visibility;
      what = res.def.label;
      write = { ...write, bounds };
    } else if ("field" in target) {
      const def = fieldDef({ compiled, actor, field: target.field });
      if (def) {
        // Unsetting a field is always allowed; any other value must fit the declaration.
        const bad = delta.value === null ? null : checkFieldValue({ def, value: delta.value });
        if (bad) fail(`${def.label}: ${bad}`);
        editableBy = def.editableBy;
        visibility = def.visibility;
        what = def.label;
      }
      write = { ...write, fieldType: def?.type ?? inferFieldType(delta.value) };
    } else {
      what = `the ${target.condition} condition`;
      const cond = Object.hasOwn(compiled.conditions, target.condition)
        ? compiled.conditions[target.condition]
        : undefined;
      visibility = cond?.visibility ?? "gm";
    }
    const refused = trusted
      ? null
      : checkEditable({ ctx, editableBy, actorId: target.actorId, kind: actor.row.kind, visibility, delta, what });
    if (refused) fail(refused);
    written.push(await writeDelta(tx, write));
  }
  const actionId = crypto.randomUUID();
  return (await recordWritten(tx, { ctx, actionId, written })) ? actionId : null;
}
