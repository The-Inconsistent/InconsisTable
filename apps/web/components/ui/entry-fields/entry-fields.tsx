"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { CodexField, Ruleset } from "@inconsistable/rules-engine";

import { PackEntrySheet } from "@/components/ui/pack-entry-sheet/pack-entry-sheet";
import { RefName } from "@/components/ui/ref-name/ref-name";
import { usePackEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import {
  entryReminders,
  entryUrl,
  enumWords,
  linkedEntry,
  listChips,
  rowChips,
  rowsOf,
  shownFields,
  tagsOf,
  tagWord,
  type EntryRow,
  type EnumWords,
  type ShownField,
} from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

type EntryFieldsProps = {
  ruleset: Ruleset | null;
  entry: CodexEntry;
  /** The room, for a ref to open its entry; null where nothing opens (the table screen). */
  campaignId: string | null;
  /** Pack entries this seat already read, to name a ref without asking the api. */
  known: readonly RulesEntry[];
  /** False where the enum chips already sit beside the title (the notebook's card): only the bools and rows here. */
  enumChips?: boolean;
  /** Every entry this seat received: a link field names one of them (house decision #76). */
  entries: readonly CodexEntry[];
  /** Opens a linked entry; absent where nothing opens (the table screen). */
  onOpenEntry?: (entryId: string) => void;
  /** False while the entry sits closed in a list: a ref the page doesn't hold shows its key, and nothing is read. */
  readNames?: boolean;
  /** Draw only these fields (the SCENE page splits open from closed); absent: every shown field. */
  fields?: readonly ShownField[];
  /** False where the entry's reminder lines are drawn elsewhere. */
  reminders?: boolean;
};

/**
 * An enum value as a chip: its label, and its note after a dot. A toned value (house decision #76) wears the Theme's
 * good or bad treatment and names it in `data-state`, as other chips name their state; the words stay.
 */
export function EnumChip({ label, note, tone }: EnumWords) {
  return (
    <span className="chip" data-field="enum" data-state={tone ?? undefined}>
      {label}
      {note && <span className="chip-note"> · {note}</span>}
    </span>
  );
}

/** The enum fields of an entry the seat received, as chips beside its title in a list. */
export function EntryFieldChips({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }) {
  return listChips({ ruleset, entry }).map(({ id, ...words }) => <EnumChip key={id} {...words} />);
}

type RowsDef = Extract<CodexField, { type: "rows" }>;

/** One row of a rows field as compact chips (house decision #89); a Test the ruleset no longer has is marked broken. */
export function RowChips({
  ruleset,
  def,
  row,
  known = [],
}: {
  ruleset: Ruleset | null;
  def: RowsDef;
  row: EntryRow;
  known?: readonly RulesEntry[];
}) {
  return (
    <span className="row" style={{ flex: "1 1 200px", minWidth: 0, gap: 4 }} data-field="row">
      {rowChips({ ruleset, def, row, known }).map((c) => (
        <span
          key={c.key}
          className="chip"
          data-field="cell"
          data-state={c.broken ? "broken" : (c.tone ?? undefined)}
          style={{ overflowWrap: "anywhere" }}
        >
          {c.text}
        </span>
      ))}
      {row.from?.cite && <span className="small dim">{row.from.cite}</span>}
    </span>
  );
}

/** The lines an entry's values raise (house decision #89), in the ruleset's words with its cite. */
export function EntryReminders({
  ruleset,
  entry,
  campaign,
}: {
  ruleset: Ruleset | null;
  entry: CodexEntry;
  /** The campaign fields in play, which a reminder may read (house decision #97). */
  campaign?: Readonly<Record<string, string | number | boolean>>;
}) {
  const t = useTranslations("entryFields");
  const lines = entryReminders({ ruleset, entry, campaign });
  if (lines.length === 0) return null;
  return (
    <ul className="list" aria-label={t("reminders")} data-field="reminders">
      {lines.map((r) => (
        <li key={r.id} className="small" role="note">
          <strong>{r.text}</strong>
          {r.cite && <span className="dim"> ({r.cite})</span>}
        </li>
      ))}
    </ul>
  );
}

// An entry's declared fields with a value, drawn from the ruleset's declaration (house decision #71): enums and true
// bools as chips, text and numbers as labelled rows, a ref as a row that opens its pack entry, a link as a row that opens
// the entry it names (house decision #76). Nothing for an empty one.
export function EntryFields({
  ruleset,
  entry,
  campaignId,
  known,
  enumChips = true,
  entries,
  onOpenEntry,
  readNames = true,
  fields,
  reminders: withReminders = true,
}: EntryFieldsProps) {
  const t = useTranslations("entryFields");
  const { opened, openEntry, close } = usePackEntry();
  const shown = fields ?? shownFields({ ruleset, entry });
  const chips = shown.flatMap((f) => {
    if (f.def.type === "enum" && typeof f.value === "string" && enumChips)
      return [<EnumChip key={f.id} {...enumWords({ def: f.def, value: f.value })} />];
    if (f.def.type === "bool" && f.value === true)
      return [
        <span key={f.id} className="chip" data-field="bool">
          {f.def.label}
        </span>,
      ];
    return [];
  });
  const links = shown.flatMap(({ id, def, value }) => {
    const target = def.type === "entry" ? linkedEntry({ entries, id: value }) : undefined;
    return target ? [{ id, label: def.label, target }] : [];
  });
  const rows = shown.flatMap(({ id, def, value }) => {
    if (def.type !== "text" && def.type !== "int" && def.type !== "ref") return [];
    const text = String(value);
    const named = def.type === "ref" ? known.find((k) => k.type === def.entity && k.key === text) : undefined;
    return [{ id, label: def.label, text: named?.name ?? text, ref: def.type === "ref" ? def.entity : null, named }];
  });

  // Tags as a labelled group of chips, rows as a list of chip lines (house decision #89).
  const tags = shown.flatMap(({ id, def, value }) =>
    def.type === "tags" && enumChips
      ? [{ id, label: def.label, words: tagsOf(value).map((tag) => tagWord({ def, tag })) }]
      : [],
  );
  const lists = shown.flatMap(({ id, def, value }) => (def.type === "rows" ? [{ id, def, rows: rowsOf(value) }] : []));
  const reminders = withReminders ? <EntryReminders ruleset={ruleset} entry={entry} /> : null;

  // A ref row: opens the pack entry it names, read for this seat (a gm one only where the seat reads gm entries).
  const handleOpen = (row: (typeof rows)[number], title: string) => async () => {
    if (campaignId === null || row.ref === null) return;
    const key = row.named?.key ?? row.text;
    await openEntry({ url: entryUrl({ campaignId, type: row.ref, key }), title, known: row.named });
  };

  const lineCount = withReminders ? entryReminders({ ruleset, entry }).length : 0;
  if (chips.length + rows.length + links.length + tags.length + lists.length + lineCount === 0) return null;
  return (
    <div className="stack entry-fields">
      {reminders}
      {chips.length > 0 && (
        <div className="row" role="group" aria-label={t("chips")}>
          {chips}
        </div>
      )}
      {tags.map(({ id, label, words }) => (
        <div key={id} className="row" role="group" aria-label={label} data-field="tags">
          <span className="small dim">{label}</span>
          {words.map((w) => (
            <span key={w} className="chip" data-field="tag">
              {w}
            </span>
          ))}
        </div>
      ))}
      {lists.map(({ id, def, rows: list }) => (
        <div key={id} className="stack" data-field="rows">
          <span className="small dim">{def.label}</span>
          <ul className="list" aria-label={def.label}>
            {list.map((row) => (
              <li key={row.id}>
                <RowChips ruleset={ruleset} def={def} row={row} known={known} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {rows.length + links.length > 0 && (
        <div className="sheet-rows">
          {links.map(({ id, label, target }) => (
            <div key={id} className="sheet-row" data-field="entry">
              <span>{label}</span>
              {onOpenEntry ? (
                <button
                  className="btn sm"
                  onClick={() => onOpenEntry(target.id)}
                  aria-label={t("open", { name: target.title })}
                >
                  {target.title}
                </button>
              ) : (
                <strong style={{ minWidth: 0, overflowWrap: "anywhere", textAlign: "end" }}>{target.title}</strong>
              )}
            </div>
          ))}
          {rows.map((row) => (
            <div key={row.id} className="sheet-row" data-field={row.ref === null ? "value" : "ref"}>
              <span>{row.label}</span>
              {row.ref !== null && campaignId !== null ? (
                <RefName
                  campaignId={campaignId}
                  type={row.ref}
                  entryKey={row.named?.key ?? row.text}
                  name={row.named?.name}
                  read={readNames}
                >
                  {(name) => (
                    <button className="btn sm" onClick={handleOpen(row, name)} aria-label={t("open", { name })}>
                      {name}
                    </button>
                  )}
                </RefName>
              ) : (
                <strong style={{ minWidth: 0, overflowWrap: "anywhere", textAlign: "end" }}>{row.text}</strong>
              )}
            </div>
          ))}
        </div>
      )}
      {opened && <PackEntrySheet opened={opened} ruleset={ruleset} onClose={close} />}
    </div>
  );
}
