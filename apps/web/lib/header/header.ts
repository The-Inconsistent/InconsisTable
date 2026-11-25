import type { Encounter } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

/** One thing the GM's header shows beside the room's name (house decision #109). */
export type HeaderItem =
  { kind: "field"; id: string; label: string; value: string | number | boolean } | { kind: "round"; round: number };

/**
 * What the ruleset's `header` block asks the header to draw, in its order: each declared campaign field that holds a
 * value (the ruleset's own label; an enum shows its word), then the fight's round while one runs. No block, an
 * undeclared field or an empty value draws nothing.
 */
export function headerItems({
  ruleset,
  campaign,
  encounter,
}: {
  ruleset: Pick<Ruleset, "header" | "campaignFields"> | null;
  campaign: Readonly<Record<string, unknown>>;
  encounter: Pick<Encounter, "round"> | null;
}): HeaderItem[] {
  const header = ruleset?.header;
  if (!header) return [];
  const items: HeaderItem[] = [];
  for (const id of header.fields ?? []) {
    const def = ruleset?.campaignFields?.[id];
    const value = campaign[id];
    if (!def || value === undefined || value === "") continue;
    if (typeof value === "number" || typeof value === "boolean")
      items.push({ kind: "field", id, label: def.label, value });
    else if (typeof value === "string")
      items.push({ kind: "field", id, label: def.label, value: (def.type === "enum" && def.labels?.[value]) || value });
  }
  if (header.round && encounter) items.push({ kind: "round", round: encounter.round });
  return items;
}
