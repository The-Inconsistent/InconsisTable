import { z } from "zod";

import {
  MAX_CELL_CHARS,
  MAX_EACH_WORDS,
  MAX_ROWS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  type CampaignField,
  type CodexField,
  type FieldDef,
  type RowColumn,
} from "./manifest.ts";

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
    case "entry":
      // Only the shape; the server checks the id names an entry of the room and of the kind (house decision #76).
      return z.uuid().safeParse(value).success ? null : "expected an entry id";
    case "list": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "expected a list of text";
      const cap = Math.min(def.maxItems ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS);
      if (value.length > cap) return `more than ${cap} items`;
      return value.some((v: string) => v.length > MAX_LIST_ITEM_CHARS)
        ? `an item is over ${MAX_LIST_ITEM_CHARS} characters`
        : null;
    }
    case "tags": {
      // Only the shape; whether a word is one of the suggestions is checked where the packs are known (the server).
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "expected a list of words";
      const cap = Math.min(def.maxItems ?? MAX_TAGS, MAX_TAGS);
      if (value.length > cap) return `more than ${cap} words`;
      const words = value as string[];
      if (words.some((v) => v.trim() === "")) return "a word is empty";
      if (words.some((v) => v.length > MAX_TAG_CHARS)) return `a word is over ${MAX_TAG_CHARS} characters`;
      return new Set(words).size === words.length ? null : "a word is there twice";
    }
    case "rows":
      return checkRows({ def, value });
  }
}

type RowsDef = Extract<CodexField, { type: "rows" }>;
const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ROW_KEYS = new Set(["id", "from", "values"]);
const FROM_KEYS = new Set(["entity", "key", "cite"]);
const TEST_KEYS = new Set(["testId", "inputs"]);

/** Why a cell does not fit its column, or null (house decision #89). */
function checkCell({ col, value }: { col: RowColumn; value: unknown }): string | null {
  switch (col.type) {
    case "int":
    case "enum":
    case "bool":
    case "ref":
      return checkFieldValue({ def: { ...col, visibility: "gm" } as CodexField, value });
    case "text": {
      if (typeof value !== "string") return "expected text";
      const cap = Math.min(col.maxLength ?? MAX_CELL_CHARS, MAX_CELL_CHARS);
      return value.length > cap ? `${value.length} characters, over the cap of ${cap}` : null;
    }
    case "test": {
      // A prepared Test line's `testId` and `inputs` (core-schema TestLine): the Test's id and its inputs' values.
      if (!plain(value) || Object.keys(value).some((k) => !TEST_KEYS.has(k))) return "expected a Test and its inputs";
      const { testId, inputs = {} } = value;
      if (typeof testId !== "string" || testId.length === 0 || testId.length > 64) return "expected a Test";
      if (!plain(inputs)) return "expected a Test's inputs";
      for (const [k, v] of Object.entries(inputs)) {
        const word = (x: unknown) => typeof x === "string" && x.length <= 100;
        // The column's `each` input may hold a list of words, one Test chip each (house decision #173).
        const words =
          k === col.each && Array.isArray(v) && v.length >= 1 && v.length <= MAX_EACH_WORDS && v.every(word);
        const fits = typeof v === "boolean" || typeof v === "number" || word(v) || words;
        if (k.length > 64 || !fits) return "an input is not a number, a word or a yes/no";
      }
      return null;
    }
  }
}

/** Why a `rows` value does not fit its declaration, or null; a problem names the row and the column (house decision #89). */
function checkRows({ def, value }: { def: RowsDef; value: unknown }): string | null {
  if (!Array.isArray(value)) return "expected a list of rows";
  const cap = Math.min(def.maxRows ?? MAX_ROWS, MAX_ROWS);
  if (value.length > cap) return `more than ${cap} rows`;
  const ids = new Set<string>();
  for (const [i, row] of value.entries()) {
    const at = `[${i}]`;
    if (!plain(row) || Object.keys(row).some((k) => !ROW_KEYS.has(k))) return `${at}: expected id, from and values`;
    if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 40) return `${at}.id: expected a row id`;
    if (ids.has(row.id)) return `${at}.id: "${row.id}" is there twice`;
    ids.add(row.id);
    const from = row.from;
    if (from !== undefined) {
      if (!plain(from) || Object.keys(from).some((k) => !FROM_KEYS.has(k)))
        return `${at}.from: expected entity, key and cite`;
      if (typeof from.entity !== "string" || !(def.from ?? []).some((f) => f.entity === from.entity))
        return `${at}.from.entity: not a type this field is filled from`;
      if (typeof from.key !== "string" || from.key.length === 0 || from.key.length > 120)
        return `${at}.from.key: expected an entry key`;
      if (from.cite !== undefined && (typeof from.cite !== "string" || from.cite.length === 0 || from.cite.length > 40))
        return `${at}.from.cite: expected a cite`;
    }
    if (!plain(row.values)) return `${at}.values: expected the row's values`;
    for (const [col, cell] of Object.entries(row.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const c = def.columns.find((x) => x.id === col);
      if (c === undefined) return `${at}.values.${col}: not a column`;
      const why = checkCell({ col: c, value: cell });
      if (why !== null) return `${at}.values.${col}: ${why}`;
    }
  }
  return null;
}

/**
 * A stored `rows` value as the ruleset now declares it (house decision #89, as #71 keeps a field the ruleset no longer
 * fits): rows past the cap, rows without a sound id and cells the declaration no longer has or that no longer fit are
 * left out of what a seat receives; the rest of each row stays. Null when nothing of it is a list of rows.
 */
export function fitRows({ def, value }: { def: RowsDef; value: unknown }): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  const out: unknown[] = [];
  for (const row of value) {
    if (out.length >= Math.min(def.maxRows ?? MAX_ROWS, MAX_ROWS)) break;
    if (!plain(row) || typeof row.id !== "string" || row.id.length === 0 || row.id.length > 40 || ids.has(row.id))
      continue;
    ids.add(row.id);
    const values: Record<string, unknown> = {};
    if (plain(row.values)) {
      for (const [col, cell] of Object.entries(row.values)) {
        const c = def.columns.find((x) => x.id === col);
        if (c !== undefined && checkCell({ col: c, value: cell }) === null) values[col] = cell;
      }
    }
    const kept: Record<string, unknown> = { id: row.id, values };
    if (row.from !== undefined && checkRows({ def, value: [{ id: row.id, from: row.from, values: {} }] }) === null)
      kept.from = row.from;
    out.push(kept);
  }
  return out;
}

/** A pack entry as a row reads it: what the seat-scoped rules read answers. */
export type RowSource = {
  type: string;
  key: string;
  name: string;
  cite?: string | null;
  body: Readonly<Record<string, unknown>>;
};
type FollowedRow = { from?: { entity: string; key: string; cite?: string }; values: Record<string, unknown> };

/**
 * The cells a pack entry gives a row of this field, by the field's `from` declaration for its type: the name and the
 * mapped values that fit their column (house decision #89).
 */
export function entryCells({ def, entry }: { def: RowsDef; entry: RowSource }): Record<string, unknown> {
  const from = def.from?.find((f) => f.entity === entry.type);
  const given: [string, unknown][] = [
    ...(from?.name === undefined ? [] : [[from.name, entry.name] as [string, unknown]]),
    ...Object.entries(from?.values ?? {}).map(([col, field]): [string, unknown] => [
      col,
      Object.hasOwn(entry.body, field) ? entry.body[field] : undefined,
    ]),
  ];
  return Object.fromEntries(
    given.filter(([col, v]) => {
      const c = def.columns.find((x) => x.id === col);
      return v !== undefined && c !== undefined && checkCell({ col: c, value: v }) === null;
    }),
  );
}

/**
 * A row as a seat reads it (house decision #89): a row filled from a pack entry follows that entry live, its cells the
 * entry's current ones with the GM's stored cells laid over them, its cite the entry's. Without the entry (gone, or not
 * served to this seat) the row is what is stored: the GM's cells, nothing of the entry.
 */
export function followRow<R extends FollowedRow>({
  def,
  row,
  entry,
}: {
  def: RowsDef;
  row: R;
  entry: RowSource | undefined;
}): R {
  if (row.from === undefined || entry === undefined || entry.type !== row.from.entity || entry.key !== row.from.key)
    return row;
  const cite = entry.cite ?? row.from.cite;
  return {
    ...row,
    from: { entity: row.from.entity, key: row.from.key, ...(cite ? { cite } : {}) },
    values: { ...entryCells({ def, entry }), ...row.values },
  };
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
