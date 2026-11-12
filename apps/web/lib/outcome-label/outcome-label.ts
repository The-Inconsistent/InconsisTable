import type { OutcomeSpec } from "@inconsistable/core-schema";

/**
 * The label of a reported Test's outcome, from the list the call carries. Null while the seat may not be told the
 * result; the id itself for one the list no longer has (the server recorded it, so show something).
 */
export function outcomeLabel({ outcomes, id }: { outcomes: readonly OutcomeSpec[]; id: string | null }): string | null {
  if (id === null) return null;
  return outcomes.find((o) => o.id === id)?.label ?? id;
}
