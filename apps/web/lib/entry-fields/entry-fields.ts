import type { CodexEntry, CodexKind } from "@inconsistable/core-schema";
import { checkFieldValue, type CodexField, type Ruleset } from "@inconsistable/rules-engine";

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

/** What a screen shows for an enum value: its label (the id without one) and its note, when it has one. */
export function enumWords({ def, value }: { def: CodexField; value: string }): { label: string; note: string | null } {
  if (def.type !== "enum") return { label: value, note: null };
  // A value id may be `constructor`: read only the record's own keys.
  const word = (rec: Record<string, string> | undefined) => (rec && Object.hasOwn(rec, value) ? rec[value] : undefined);
  return { label: word(def.labels) ?? value, note: word(def.notes) ?? null };
}

/** The enum fields of an entry with a value: the chips beside its title in a list. */
export const listChips = ({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }) =>
  shownFields({ ruleset, entry }).flatMap((f) =>
    f.def.type === "enum" && typeof f.value === "string"
      ? [{ id: f.id, ...enumWords({ def: f.def, value: f.value }) }]
      : [],
  );

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
    if (value !== stored) out[id] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The seat-scoped rules route narrowed to one entry, which a ref field names by its type and key. */
export const entryUrl = ({ campaignId, type, key }: { campaignId: string; type: string; key: string }) =>
  `/api/campaigns/${encodeURIComponent(campaignId)}/rules?${new URLSearchParams({ type, key, limit: "1" })}`;
