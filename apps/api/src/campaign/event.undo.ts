import type { RefusalKey, RefusalParams } from "@inconsistable/core-schema";
import { sameValue, type DeltaInput, type LogTarget, type LogValue } from "../actor/actor.delta.ts";
import type { LoggedDelta } from "./event.log.ts";

// Undo of one logged delta (docs/design.md §5.4, docs/p1-plan.md "Quyết định đã chốt" 2-3). Pure, so the rules are unit
// tested without a database.

export type Inverse = { ok: true; delta: DeltaInput | null } | { ok: false; code: RefusalKey; params: RefusalParams };

/** A target in words, for a refusal the GM reads. */
export function describeTarget(t: LogTarget): string {
  if ("resource" in t) return `resource "${t.resource}"`;
  if ("field" in t) return `field "${t.field}"`;
  if ("condition" in t) return `condition "${t.condition}"`;
  if ("turn" in t) return `turn "${t.turn}"`;
  return `test "${t.test}"`;
}

/**
 * The delta that takes a logged one back, or why it can't.
 * - A resource is counted, so the inverse is the change that was made (`before − after`), never `SET value = before`:
 *   a delta written since keeps its effect. The server clamps it like any other.
 * - Anything else (field, condition, turn) is set. It is undone only while it still holds what the step left
 *   (`after`); once a later step changed it, undoing this one would silently overwrite that step.
 * `current` is the value now; a resource's is not needed.
 */
export function invertDelta({ logged, current }: { logged: LoggedDelta; current: LogValue }): Inverse {
  const { target, before, after } = logged;
  if ("resource" in target) {
    const change = (typeof before === "number" ? before : 0) - (typeof after === "number" ? after : 0);
    return { ok: true, delta: change === 0 ? null : { target, kind: "add", value: change } };
  }
  // A condition's count is counted too: a tick down is undone by the tick back, whatever else happened to the row.
  if ("condition" in target && logged.kind === "add") {
    const left = (v: LogValue) =>
      v !== null && typeof v === "object" && !Array.isArray(v) ? (v.expiresAfter ?? 1) : null;
    const [was, now] = [left(before), left(after)];
    if (was === null || now === null)
      return { ok: false, code: "undoGone", params: { target: describeTarget(target) } };
    return { ok: true, delta: was === now ? null : { target, kind: "add", value: was - now } };
  }
  if (!sameValue({ a: current, b: after })) {
    return {
      ok: false,
      code: "undoChanged",
      params: { target: describeTarget(target), now: JSON.stringify(current), left: JSON.stringify(after) },
    };
  }
  return { ok: true, delta: { target, kind: "set", value: before } };
}
