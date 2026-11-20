"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PackEntrySheet } from "@/components/ui/pack-entry-sheet/pack-entry-sheet";
import { usePackEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import { entryUrl, enumWords, type DeclaredField, type EntryFieldValue } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

import { EntryPicker } from "./components/entry-picker/entry-picker";
import { RefPicker } from "./components/ref-picker/ref-picker";

export type FieldsDraft = Readonly<Record<string, EntryFieldValue | null>>;

type EntryFieldsFormProps = {
  ruleset: Ruleset | null;
  fields: readonly DeclaredField[];
  draft: FieldsDraft;
  onChange: (change: { id: string; value: EntryFieldValue | null }) => void;
  campaignId: string;
  /** Pack entries this seat already read, to name a picked ref. */
  known: readonly RulesEntry[];
  disabled: boolean;
  /** The entry being edited, which a link field may not name. */
  entryId: string;
  /** Every entry this seat reads: what a link field offers (house decision #76). */
  entries: readonly CodexEntry[];
  onOpenEntry: (entryId: string) => void;
};

type IntInputProps = { id: string; label: string; min?: number; max?: number; value: number | null } & Pick<
  EntryFieldsFormProps,
  "disabled"
> & { onValue: (value: number | null) => void };

// A whole number typed by hand: the text is kept as typed ("-" on the way to "-2"), a whole number is reported, and an
// empty box clears the field.
function IntInput({ id, label, min, max, value, disabled, onValue }: IntInputProps) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // Keeps the text; reports the number once it is a whole one, or null once the box is empty.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const n = Number(e.target.value);
    if (e.target.value.trim() === "") onValue(null);
    else if (Number.isInteger(n)) onValue(n);
  };
  return (
    <label className="stack">
      {label}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={text}
        onChange={handleChange}
        disabled={disabled}
      />
    </label>
  );
}

// The declared fields of an entry's kind in the GM's editor (house decision #71), each from its declaration: an enum as
// a select of its labels and notes, text and a number as inputs, a yes/no as a switch, a ref as a search that opens.
export function EntryFieldsForm({
  ruleset,
  fields,
  draft,
  onChange,
  campaignId,
  known,
  disabled,
  entryId,
  entries,
  onOpenEntry,
}: EntryFieldsFormProps) {
  const t = useTranslations("entryFields");
  const [picked, setPicked] = useState<readonly RulesEntry[]>([]);
  const { opened, openEntry, close } = usePackEntry();
  const named = (type: string, key: string) => [...picked, ...known].find((k) => k.type === type && k.key === key);

  // A select or text box: empty clears the field.
  const handleText = (id: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ id, value: e.target.value === "" ? null : e.target.value });

  // The switch: on is true, off clears the field.
  const handleBool = (id: string) => (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ id, value: e.target.checked ? true : null });

  // A ref picked (remembered, to name it) or cleared.
  const handlePick = (id: string) => (entry: RulesEntry | null) => {
    if (entry) setPicked([entry, ...picked]);
    onChange({ id, value: entry?.key ?? null });
  };

  // Opens the picked entry in the sheet.
  const handleOpen = (type: string, key: string) => async () => {
    const entry = named(type, key);
    await openEntry({ url: entryUrl({ campaignId, type, key }), title: entry?.name ?? key, known: entry });
  };

  if (fields.length === 0) return null;
  return (
    <fieldset className="stack entry-fields-form" style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
      <legend className="small dim">{t("legend")}</legend>
      {fields.map(({ id, def }) => {
        const value = Object.hasOwn(draft, id) ? (draft[id] ?? null) : null;
        const inputId = `codex-field-${id}`;
        switch (def.type) {
          case "enum":
            return (
              <label key={id} className="stack">
                {def.label}
                <select
                  id={inputId}
                  value={typeof value === "string" ? value : ""}
                  onChange={handleText(id)}
                  disabled={disabled}
                >
                  <option value="">{t("none")}</option>
                  {def.values.map((v) => {
                    const w = enumWords({ def, value: v });
                    return (
                      <option key={v} value={v}>
                        {w.note ? `${w.label} · ${w.note}` : w.label}
                      </option>
                    );
                  })}
                </select>
              </label>
            );
          case "text":
            return (
              <label key={id} className="stack">
                {def.label}
                <input
                  id={inputId}
                  value={typeof value === "string" ? value : ""}
                  onChange={handleText(id)}
                  maxLength={def.maxLength ?? 10_000}
                  disabled={disabled}
                />
              </label>
            );
          case "int":
            return (
              <IntInput
                key={id}
                id={inputId}
                label={def.label}
                min={def.min}
                max={def.max}
                value={typeof value === "number" ? value : null}
                disabled={disabled}
                onValue={(n) => onChange({ id, value: n })}
              />
            );
          case "bool":
            return (
              <label key={id} className="row">
                <input
                  id={inputId}
                  type="checkbox"
                  role="switch"
                  checked={value === true}
                  onChange={handleBool(id)}
                  disabled={disabled}
                />
                {def.label}
              </label>
            );
          case "ref": {
            const key = typeof value === "string" ? value : null;
            return (
              <RefPicker
                key={id}
                id={inputId}
                label={def.label}
                campaignId={campaignId}
                entity={def.entity}
                value={key}
                name={key === null ? null : (named(def.entity, key)?.name ?? null)}
                disabled={disabled}
                onPick={handlePick(id)}
                onOpen={handleOpen(def.entity, key ?? "")}
              />
            );
          }
          case "entry":
            return (
              <EntryPicker
                key={id}
                id={inputId}
                label={def.label}
                kind={def.kind}
                entries={entries}
                self={entryId}
                value={typeof value === "string" ? value : null}
                disabled={disabled}
                onPick={(picked) => onChange({ id, value: picked })}
                onOpen={onOpenEntry}
              />
            );
        }
      })}
      {opened && <PackEntrySheet opened={opened} ruleset={ruleset} onClose={close} />}
    </fieldset>
  );
}
