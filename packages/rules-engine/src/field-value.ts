import { z } from "zod";

import type { CampaignField, CodexField, FieldDef } from "./manifest.ts";

// Server-side ceilings for a field value; a manifest's own `maxLength` / `maxItems` may only tighten them.
// core-schema repeats these numbers (it can't import the engine): keep `FieldValue` there in step.
export const MAX_TEXT_CHARS = 10_000;
export const MAX_LIST_ITEMS = 500;
export const MAX_LIST_ITEM_CHARS = 1_000;
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/** A field value as a pack body or a builder answer carries it. `null` (unset) is not allowed: omit the field. */
export const FieldValueInput = z.union([
  z.number().min(INT4_MIN).max(INT4_MAX),
  z.string().max(MAX_TEXT_CHARS),
  z.boolean(),
  z.array(z.string().max(MAX_LIST_ITEM_CHARS)).max(MAX_LIST_ITEMS),
]);
export type FieldValueInput = z.infer<typeof FieldValueInput>;

/** Why `value` does not fit `def`, or null when it does. The one place a value is checked against a `FieldDef`. */
export function checkFieldValue({ def, value }: { def: FieldDef | CodexField; value: unknown }): string | null {
  switch (def.type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return "expected a whole number";
      if (value < INT4_MIN || value > INT4_MAX) return "outside the range of a whole number";
      if (def.min !== undefined && value < def.min) return `below the minimum of ${def.min}`;
      if (def.max !== undefined && value > def.max) return `above the maximum of ${def.max}`;
      return null;
    case "text": {
      if (typeof value !== "string") return "expected text";
      const cap = Math.min(def.maxLength ?? MAX_TEXT_CHARS, MAX_TEXT_CHARS);
      return value.length > cap ? `${value.length} characters, over the cap of ${cap}` : null;
    }
    case "enum":
      return typeof value === "string" && def.values.includes(value)
        ? null
        : `expected one of ${def.values.join(", ")}`;
    case "bool":
      return typeof value === "boolean" ? null : "expected true or false";
    case "ref":
      // ponytail: only the shape; whether the key exists in a pack is checked where entries are known (the importer).
      return typeof value === "string" && value.length > 0 && value.length <= 120 ? null : "expected an entry key";
    case "list": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "expected a list of text";
      const cap = Math.min(def.maxItems ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS);
      if (value.length > cap) return `more than ${cap} items`;
      return value.some((v: string) => v.length > MAX_LIST_ITEM_CHARS)
        ? `an item is over ${MAX_LIST_ITEM_CHARS} characters`
        : null;
    }
  }
}

/** Why `value` does not fit a campaign field, or null when it does; worded like `checkFieldValue`. */
export function checkCampaignValue({ def, value }: { def: CampaignField; value: unknown }): string | null {
  switch (def.type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return "expected a whole number";
      if (value < def.min) return `below the minimum of ${def.min}`;
      return value > def.max ? `above the maximum of ${def.max}` : null;
    case "enum":
      return typeof value === "string" && def.values.includes(value)
        ? null
        : `expected one of ${def.values.join(", ")}`;
    case "bool":
      return typeof value === "boolean" ? null : "expected true or false";
  }
}
