import { z } from "zod";

import type { FieldDef } from "./manifest.ts";

/** A field value as a pack body or a builder answer carries it. `null` (unset) is not allowed: omit the field. */
export const FieldValueInput = z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]);
export type FieldValueInput = z.infer<typeof FieldValueInput>;

/** Why `value` does not fit `def`, or null when it does. The one place a value is checked against a `FieldDef`. */
export function checkFieldValue({ def, value }: { def: FieldDef; value: unknown }): string | null {
  switch (def.type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return "expected a whole number";
      if (def.min !== undefined && value < def.min) return `below the minimum of ${def.min}`;
      if (def.max !== undefined && value > def.max) return `above the maximum of ${def.max}`;
      return null;
    case "text":
      if (typeof value !== "string") return "expected text";
      return def.maxLength !== undefined && value.length > def.maxLength
        ? `${value.length} characters, over the cap of ${def.maxLength}`
        : null;
    case "enum":
      return typeof value === "string" && def.values.includes(value)
        ? null
        : `expected one of ${def.values.join(", ")}`;
    case "bool":
      return typeof value === "boolean" ? null : "expected true or false";
    case "ref":
      // ponytail: only the shape; whether the key exists in a pack is checked where entries are known (the importer).
      return typeof value === "string" && value.length > 0 && value.length <= 120 ? null : "expected an entry key";
    case "list":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "expected a list of text";
      return def.maxItems !== undefined && value.length > def.maxItems ? `more than ${def.maxItems} items` : null;
  }
}
