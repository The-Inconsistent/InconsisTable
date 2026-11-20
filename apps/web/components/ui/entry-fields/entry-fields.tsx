"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PackEntrySheet } from "@/components/ui/pack-entry-sheet/pack-entry-sheet";
import { RefName } from "@/components/ui/ref-name/ref-name";
import { usePackEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import {
  entryUrl,
  enumWords,
  linkedEntry,
  listChips,
  shownFields,
  type EnumWords,
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
}: EntryFieldsProps) {
  const t = useTranslations("entryFields");
  const { opened, openEntry, close } = usePackEntry();
  const shown = shownFields({ ruleset, entry });
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

  // A ref row: opens the pack entry it names, read for this seat (a gm one only where the seat reads gm entries).
  const handleOpen = (row: (typeof rows)[number], title: string) => async () => {
    if (campaignId === null || row.ref === null) return;
    const key = row.named?.key ?? row.text;
    await openEntry({ url: entryUrl({ campaignId, type: row.ref, key }), title, known: row.named });
  };

  if (chips.length === 0 && rows.length === 0 && links.length === 0) return null;
  return (
    <div className="stack entry-fields">
      {chips.length > 0 && (
        <div className="row" role="group" aria-label={t("chips")}>
          {chips}
        </div>
      )}
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
