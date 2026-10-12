import type { Ctx } from "@inconsistable/core-schema";
import type { DeltaKind, EditableBy } from "@inconsistable/rules-engine";

// What a seat may write (docs/design.md §5.3, step 6). Pure, so it is unit tested without a database.

/** The GM side of the table: the owner and GMs, a co-GM, and an admin who opened the room. They write any value. */
export function isGmSide(ctx: Ctx): boolean {
  return ctx.seat.kind === "admin" || (ctx.seat.kind === "member" && ctx.seat.role !== "player");
}

/** The characters this seat holds. An admin who opened the room holds none. */
export const heldBy = (ctx: Ctx): readonly string[] => (ctx.seat.kind === "admin" ? [] : ctx.seat.characterIds);

/**
 * A refusal message when the seat may not write `delta` to a value declared `editableBy`, else null.
 * `owner` writes only a character the seat holds; `ownerSpendOnly` only a negative delta on one it holds.
 * Fail-closed: an undeclared value is `gm`.
 */
export function checkEditable({
  ctx,
  editableBy,
  actorId,
  delta,
  what,
}: {
  ctx: Ctx;
  editableBy: EditableBy;
  actorId: string;
  delta: { kind: DeltaKind; value: unknown };
  what: string;
}): string | null {
  if (isGmSide(ctx)) return null;
  if (!heldBy(ctx).includes(actorId)) return "Not your character";
  switch (editableBy) {
    case "gm":
      return `Only the GM can change ${what}`;
    case "owner":
      return null;
    case "ownerSpendOnly":
      return delta.kind === "add" && typeof delta.value === "number" && delta.value < 0
        ? null
        : `You can only spend ${what}`;
  }
}
