import { OWN_FALLBACK, canInCampaign, type Ctx, type Permission, type Target } from "@inconsistable/core-schema";
import { fail } from "../core/errors.ts";

// `can(perm)` for an action or an op (docs/design.md §5.3, step 3): the permission itself, or the GM-side one an `:own`
// permission falls back to. Throws the refusal the sender reads.
export function requirePerm({ ctx, perm, target }: { ctx: Ctx; perm: Permission; target?: Target }) {
  const fallback = OWN_FALLBACK[perm];
  if (canInCampaign({ ctx, perm, target })) return;
  if (fallback && canInCampaign({ ctx, perm: fallback, target })) return;
  if (ctx.seat.kind === "token" && ctx.seat.role === "screen") fail("screenReadOnly");
  fail(perm.endsWith(":own") ? "notYourCharacter" : "noPermission");
}
