"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PackEntrySheet } from "@/components/ui/pack-entry-sheet/pack-entry-sheet";
import { usePackEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import { entryUrl, enumWords, listChips, shownFields } from "@/lib/entry-fields/entry-fields";
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
};

/** An enum value as a chip: its label, and its note after a dot. */
export function EnumChip({ label, note }: { label: string; note: string | null }) {
  return (
    <span className="chip" data-field="enum">
      {label}
      {note && <span className="chip-note"> · {note}</span>}
    </span>
  );
}

/** The enum fields of an entry the seat received, as chips beside its title in a list. */
export function EntryFieldChips({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }) {
  return listChips({ ruleset, entry }).map((c) => <EnumChip key={c.id} label={c.label} note={c.note} />);
}

// An entry's declared fields with a value, drawn from the ruleset's declaration (house decision #71): enums and true
// bools as chips, text and numbers as labelled rows, a ref as a row that opens its pack entry. Nothing for an empty one.
export function EntryFields({ ruleset, entry, campaignId, known, enumChips = true }: EntryFieldsProps) {
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
  const rows = shown.flatMap(({ id, def, value }) => {
    if (def.type !== "text" && def.type !== "int" && def.type !== "ref") return [];
    const text = String(value);
    const named = def.type === "ref" ? known.find((k) => k.type === def.entity && k.key === text) : undefined;
    return [{ id, label: def.label, text: named?.name ?? text, ref: def.type === "ref" ? def.entity : null, named }];
  });

  // A ref row: opens the pack entry it names, read for this seat (a gm one only where the seat reads gm entries).
  const handleOpen = (row: (typeof rows)[number]) => async () => {
    if (campaignId === null || row.ref === null) return;
    const key = row.named?.key ?? row.text;
    await openEntry({ url: entryUrl({ campaignId, type: row.ref, key }), title: row.text, known: row.named });
  };

  if (chips.length === 0 && rows.length === 0) return null;
  return (
    <div className="stack entry-fields">
      {chips.length > 0 && (
        <div className="row" role="group" aria-label={t("chips")}>
          {chips}
        </div>
      )}
      {rows.length > 0 && (
        <div className="sheet-rows">
          {rows.map((row) => (
            <div key={row.id} className="sheet-row" data-field={row.ref === null ? "value" : "ref"}>
              <span>{row.label}</span>
              {row.ref !== null && campaignId !== null ? (
                <button className="btn sm" onClick={handleOpen(row)} aria-label={t("open", { name: row.text })}>
                  {row.text}
                </button>
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
