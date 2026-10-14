import type { ActorKind, Ctx } from "@inconsistable/core-schema";
import { stepsFor, type DeltaKind, type EditableBy, type Visibility } from "@inconsistable/rules-engine";
import { actorWriteSide, heldBy } from "../view/view.ts";

// What a seat may write (docs/design.md §5.3, step 6). Pure, so it is unit tested without a database.

/**
 * A refusal message when the seat may not write `delta` to a value declared `editableBy`, else null. The GM side of
 * the actor's kind writes any value; a co-GM outside it only the values everyone sees, the hidden ones needing the scope
 * that shows them (the Seat view module's rule, house decision #31).
 * `owner` writes only a character the seat holds; `ownerSpendOnly` only a negative delta on one it holds.
 * Fail-closed: an undeclared value is `gm`.
 */
export function checkEditable({
  ctx,
  editableBy,
  actorId,
  kind,
  visibility,
  delta,
  what,
}: {
  ctx: Ctx;
  editableBy: EditableBy;
  actorId: string;
  kind: ActorKind;
  /** Who may see the value: a co-GM outside its scope writes only what everyone sees. */
  visibility: Visibility;
  delta: { kind: DeltaKind; value: unknown };
  what: string;
}): string | null {
  if (actorWriteSide({ ctx, kind, visibility })) return null;
  if (!heldBy(ctx).includes(actorId)) return "Not your character";
  const { dec, inc } = stepsFor({ editableBy, gmSide: false });
  if (!dec && !inc) return "Only the GM can change that";
  if (inc) return null;
  return delta.kind === "add" && typeof delta.value === "number" && delta.value < 0
    ? null
    : `You can only spend ${what}`;
}
