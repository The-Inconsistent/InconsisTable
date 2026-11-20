import type { CodexEntry, CodexKind, TestInputs } from "@inconsistable/core-schema";
import {
  checkFieldValue,
  codexReminders,
  type CodexField,
  type EnumTone,
  type Ruleset,
} from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";
import { testWords } from "@/lib/test-inputs/test-inputs";

// A codex entry's declared fields (house decision #71): what the ruleset the seat was served declares for a kind, read
// and drawn from that declaration. The server has already sent each seat only what it may see.

export type EntryFieldValue = CodexEntry["fields"][string];
export type DeclaredField = { id: string; def: CodexField };
export type ShownField = DeclaredField & { value: EntryFieldValue };

/**
 * The fields the ruleset declares for a kind, in the order the served manifest holds them; none without a ruleset or a
 * block.
 * ponytail: a stored manifest (jsonb) does not keep a record's key order, so fields come back sorted; an `order` list in
 * the block if a ruleset needs its own.
 */
export function declaredFields({ ruleset, kind }: { ruleset: Ruleset | null; kind: CodexKind }): DeclaredField[] {
  return Object.entries(ruleset?.codex?.kinds[kind]?.fields ?? {}).map(([id, def]) => ({ id, def }));
}

/** The declared fields of an entry that hold a value that still fits, in declaration order. */
export function shownFields({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }): ShownField[] {
  return declaredFields({ ruleset, kind: entry.kind }).flatMap(({ id, def }) => {
    const value = Object.hasOwn(entry.fields, id) ? entry.fields[id] : undefined;
    return value === undefined || checkFieldValue({ def, value }) !== null ? [] : [{ id, def, value }];
  });
}

export type EnumWords = { label: string; note: string | null; tone: EnumTone | null };

/**
 * What a screen shows for an enum value: its label (the id without one), its note and its tone (house decision #76),
 * when it has them.
 */
export function enumWords({ def, value }: { def: CodexField; value: string }): EnumWords {
  if (def.type !== "enum") return { label: value, note: null, tone: null };
  // A value id may be `constructor`: read only the record's own keys.
  const word = <T>(rec: Record<string, T> | undefined) => (rec && Object.hasOwn(rec, value) ? rec[value] : undefined);
  return { label: word(def.labels) ?? value, note: word(def.notes) ?? null, tone: word(def.tones) ?? null };
}

/**
 * What an `entry` field's picker offers (house decision #76): the room's entries of the field's kind whose title holds
 * the search (any case), by title, without the entry being edited.
 */
export function linkOptions({
  entries,
  kind,
  self,
  q = "",
}: {
  entries: readonly CodexEntry[];
  kind: CodexKind;
  self: string;
  q?: string;
}): CodexEntry[] {
  const needle = q.trim().toLowerCase();
  return entries
    .filter((e) => e.kind === kind && e.id !== self && e.title.toLowerCase().includes(needle))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The entry a link names, among the entries this seat received; undefined when it has none (the server sends none). */
export const linkedEntry = ({ entries, id }: { entries: readonly CodexEntry[]; id: EntryFieldValue }) =>
  entries.find((e) => e.id === id);

/**
 * The chips beside an entry's title in a list: each enum field with a value, a tags field's words, and how many rows a
 * rows field holds (house decision #89).
 */
export const listChips = ({
  ruleset,
  entry,
}: {
  ruleset: Ruleset | null;
  entry: CodexEntry;
}): ({ id: string } & EnumWords)[] =>
  shownFields({ ruleset, entry }).flatMap((f) => {
    if (f.def.type === "enum" && typeof f.value === "string")
      return [{ id: f.id, ...enumWords({ def: f.def, value: f.value }) }];
    const def = f.def;
    if (def.type === "tags" && tagsOf(f.value).length > 0) {
      const label = tagsOf(f.value)
        .map((tag) => tagWord({ def, tag }))
        .join(" · ");
      return [{ id: f.id, label, note: null, tone: null }];
    }
    if (def.type === "rows" && rowsOf(f.value).length > 0)
      return [{ id: f.id, label: `${def.label} ${rowsOf(f.value).length}`, note: null, tone: null }];
    return [];
  });

/** The `fields` a save sends: each field whose draft differs from the entry, `null` to clear one. Null when none did. */
export function fieldsPatch({
  entry,
  draft,
}: {
  entry: CodexEntry;
  draft: Readonly<Record<string, EntryFieldValue | null>>;
}): Record<string, EntryFieldValue | null> | null {
  const out: Record<string, EntryFieldValue | null> = {};
  for (const [id, value] of Object.entries(draft)) {
    const stored = Object.hasOwn(entry.fields, id) ? entry.fields[id] : null;
    // A list (tags, rows) is a new array on every edit: compared by what it holds.
    if (JSON.stringify(value) !== JSON.stringify(stored ?? null)) out[id] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---- Tags and rows (house decision #89) ----

type RowsDef = Extract<CodexField, { type: "rows" }>;
type TagsDef = Extract<CodexField, { type: "tags" }>;
export type RowColumn = RowsDef["columns"][number];
/** A Test cell: the two things a prepared Test line holds. */
export type TestCell = { testId: string; inputs: TestInputs };
/** One row of a rows field as a screen reads it. */
export type EntryRow = {
  id: string;
  from?: { entity: string; key: string; cite?: string };
  values: Record<string, unknown>;
};

// A row's id inside its field. Not crypto.randomUUID: a LAN table is served over plain HTTP, where it is missing;
// uniqueness only matters within one field.
export const newRowId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A rows value as rows; anything else (not sent, not a list) as none. */
export const rowsOf = (value: unknown): EntryRow[] =>
  Array.isArray(value)
    ? value.filter((r): r is EntryRow => typeof r === "object" && r !== null && typeof r.id === "string")
    : [];

/** A tags value as words. */
export const tagsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A tag as a screen shows it: a fixed option by its label, any other word as written. */
export const tagWord = ({ def, tag }: { def: TagsDef; tag: string }) =>
  (def.options?.includes(tag) && def.labels && Object.hasOwn(def.labels, tag) ? def.labels[tag] : undefined) ?? tag;

/**
 * What a tags field's picker offers for what was typed (house decision #89): the fixed options and the pack names read
 * so far that hold it (any case), exact first, then those that start with it, then the rest; none already picked.
 */
export function tagSuggestions({
  def,
  names,
  picked,
  q,
}: {
  def: TagsDef;
  names: readonly string[];
  picked: readonly string[];
  q: string;
}): { tag: string; word: string }[] {
  const needle = q.trim().toLowerCase();
  const taken = new Set(picked.map((p) => p.toLowerCase()));
  const all = [
    ...(def.options ?? []).map((tag) => ({ tag, word: tagWord({ def, tag }) })),
    ...names.map((n) => ({ tag: n, word: n })),
  ];
  const rank = (w: string) => (w === needle ? 0 : w.startsWith(needle) ? 1 : 2);
  return all
    .filter((s, i) => all.findIndex((x) => x.tag === s.tag) === i)
    .filter((s) => !taken.has(s.tag.toLowerCase()) && s.word.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.word.toLowerCase()) - rank(b.word.toLowerCase()) || a.word.localeCompare(b.word));
}

/** What Enter adds from what was typed: a suggestion spelled exactly so, else the words themselves when write-ins are allowed. */
export function tagToAdd({
  def,
  suggestions,
  q,
}: {
  def: TagsDef;
  suggestions: readonly { tag: string; word: string }[];
  q: string;
}): string | null {
  const text = q.trim();
  if (text === "") return null;
  const exact = suggestions.find((s) => s.word.toLowerCase() === text.toLowerCase());
  return exact?.tag ?? (def.writeIn ? text : null);
}

/** A Test as the ruleset names it (house decision #77), from the manifest the seat was served. */
export const testOf = ({ ruleset, testId }: { ruleset: Ruleset | null; testId: string }) => {
  const def = ruleset?.tests && Object.hasOwn(ruleset.tests, testId) ? ruleset.tests[testId] : undefined;
  return def ? { ...def, id: testId } : undefined;
};

export type RowChip = { key: string; text: string; tone: EnumTone | null; broken?: boolean };

/**
 * One row as compact chips (house decision #89), in its columns' order: text as written, a number after its column's
 * label, an enum by its label and tone, a true yes/no by its column's label, a ref by the entry's name where this seat
 * read it, a Test by its label and its inputs in the Test's words. A Test the ruleset no longer has is marked broken.
 */
export function rowChips({
  ruleset,
  def,
  row,
  known = [],
}: {
  ruleset: Ruleset | null;
  def: RowsDef;
  row: EntryRow;
  known?: readonly RulesEntry[];
}): RowChip[] {
  return def.columns.flatMap((col): RowChip[] => {
    const v = Object.hasOwn(row.values, col.id) ? row.values[col.id] : undefined;
    const key = col.id;
    if (v === undefined || v === null || v === "" || v === false) return [];
    switch (col.type) {
      case "text":
        return [{ key, text: String(v), tone: null }];
      case "int":
        return [{ key, text: `${col.label} ${String(v)}`, tone: null }];
      case "bool":
        return [{ key, text: col.label, tone: null }];
      case "enum": {
        const w = enumWords({ def: { ...col, visibility: "gm" }, value: String(v) });
        return [{ key, text: w.label, tone: w.tone }];
      }
      case "ref": {
        const named = known.find((k) => k.type === col.entity && k.key === v);
        return [{ key, text: named?.name ?? String(v), tone: null }];
      }
      case "test": {
        const cell = v as TestCell;
        const test = testOf({ ruleset, testId: cell.testId });
        const words = testWords(test ?? { id: cell.testId });
        const inputs = Object.entries(cell.inputs ?? {})
          .map(([k, x]) => `${words.input(k)} ${words.value(k, x)}`)
          .join(", ");
        return [{ key, text: inputs === "" ? words.test : `${words.test} · ${inputs}`, tone: null, broken: !test }];
      }
    }
  });
}

/** What names a row in a picker: its first text cell, else its id. */
export const rowName = ({ def, row }: { def: RowsDef; row: EntryRow }) => {
  const col = def.columns.find((c) => c.type === "text" && typeof row.values[c.id] === "string" && row.values[c.id]);
  return col ? String(row.values[col.id]) : row.id;
};

/** A row filled from a pack entry by the field's declaration for its type: its name and mapped values, its key and cite. */
export function prefillRow({ def, entry, id }: { def: RowsDef; entry: RulesEntry; id: string }): EntryRow {
  const from = def.from?.find((f) => f.entity === entry.type);
  const values: Record<string, unknown> = {};
  if (from?.name !== undefined) values[from.name] = entry.name;
  for (const [col, field] of Object.entries(from?.values ?? {})) {
    if (Object.hasOwn(entry.body, field)) values[col] = entry.body[field];
  }
  return {
    id,
    from: { entity: entry.type, key: entry.key, ...(entry.cite ? { cite: entry.cite } : {}) },
    values,
  };
}

/** The rows fields of a kind a scene may pick from (house decision #89). */
export const pickableFields = ({ ruleset, kind }: { ruleset: Ruleset | null; kind: CodexKind }) =>
  declaredFields({ ruleset, kind }).flatMap(({ id, def }) => (def.type === "rows" && def.pick ? [{ id, def }] : []));

/** The reminders an entry's values raise (house decision #89), as the ruleset words them. */
export const entryReminders = ({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }) =>
  codexReminders({ kind: ruleset?.codex?.kinds[entry.kind], fields: entry.fields });

/** The seat-scoped rules route narrowed to one entry, which a ref field names by its type and key. */
export const entryUrl = ({ campaignId, type, key }: { campaignId: string; type: string; key: string }) =>
  `/api/campaigns/${encodeURIComponent(campaignId)}/rules?${new URLSearchParams({ type, key, limit: "1" })}`;
