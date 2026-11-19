import type { CampaignField } from "@inconsistable/rules-engine";

/** An int range this short is shown as one chip per value; a longer one is a number input. */
export const MAX_INT_CHIPS = 10;

export type FieldControl =
  { kind: "chips"; options: (number | string)[] } | { kind: "number"; min: number; max: number } | { kind: "switch" };

/** Which control a campaign field gets, and its options. */
export function controlOf(field: CampaignField): FieldControl {
  if (field.type === "bool") return { kind: "switch" };
  if (field.type === "enum") return { kind: "chips", options: field.values };
  const count = field.max - field.min + 1;
  if (count > MAX_INT_CHIPS) return { kind: "number", min: field.min, max: field.max };
  return { kind: "chips", options: Array.from({ length: Math.max(count, 0) }, (_, i) => field.min + i) };
}
