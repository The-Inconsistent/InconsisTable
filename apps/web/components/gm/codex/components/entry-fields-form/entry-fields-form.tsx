"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { ActionInput, ActionResult, CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { RollInto } from "@/components/gm/codex/components/roll-into/roll-into";
import { PackEntrySheet } from "@/components/ui/pack-entry-sheet/pack-entry-sheet";
import { TermMark, type TermEnv } from "@/components/ui/term-card/term-card";
import { usePackEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import {
  entryUrl,
  enumWords,
  rollFor,
  rowsOf,
  tagsOf,
  type DeclaredField,
  type EntryFieldValue,
} from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

import { EntryPicker } from "./components/entry-picker/entry-picker";
import { IntInput } from "./components/int-input/int-input";
import { RefPicker } from "./components/ref-picker/ref-picker";
import { RowsEditor } from "./components/rows-editor/rows-editor";
import { TagsPicker } from "./components/tags-picker/tags-picker";

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
  /** Sends an action: a text field the ruleset rolls on its tables offers ROLL and I ROLLED (house decision #97). */
  act?: (a: ActionInput) => Promise<ActionResult>;
  /** The ruleset with the page relay: a field that says what it means gets its ⓘ (house decision #126). */
  terms?: TermEnv;
  /** The campaign fields in play, which a rows field's roll and Test inputs read (house decision #173). */
  campaign?: Readonly<Record<string, string | number | boolean>>;
};

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
  act,
  terms,
  campaign,
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

  // One declared field's control, from its declaration.
  const control = ({ id, def }: DeclaredField) => {
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
          <div key={id} className="stack">
            <label className="stack">
              {def.label}
              <input
                id={inputId}
                value={typeof value === "string" ? value : ""}
                onChange={handleText(id)}
                maxLength={def.maxLength ?? 10_000}
                disabled={disabled}
              />
            </label>
            {def.roll && act && (
              <RollInto
                key={rollFor({ roll: def.roll, fields: draft }).tables.join()}
                roll={rollFor({ roll: def.roll, fields: draft })}
                ruleset={ruleset}
                label={def.label}
                act={act}
                disabled={disabled}
                onRolled={(text) => onChange({ id, value: text.slice(0, def.maxLength ?? 10_000) || null })}
              />
            )}
          </div>
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
      case "tags":
        return (
          <TagsPicker
            key={id}
            id={inputId}
            def={def}
            campaignId={campaignId}
            value={tagsOf(value)}
            disabled={disabled}
            onChange={(words) => onChange({ id, value: words.length > 0 ? words : null })}
          />
        );
      case "rows":
        return (
          <RowsEditor
            key={id}
            id={inputId}
            def={def}
            ruleset={ruleset}
            campaignId={campaignId}
            known={[...picked, ...known]}
            value={rowsOf(value)}
            disabled={disabled}
            onChange={(rows) => onChange({ id, value: rows.length > 0 ? rows : null })}
            onPicked={(entry) => setPicked([entry, ...picked])}
            act={act}
            campaign={campaign}
          />
        );
    }
  };

  if (fields.length === 0) return null;
  return (
    <fieldset className="stack entry-fields-form" style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
      <legend className="small dim">{t("legend")}</legend>
      {fields.map(({ id, def }) =>
        // A field the ruleset explains gets its ⓘ beside it (house decision #126); any other draws as it did.
        def.summary && terms ? (
          <div key={id} className="row" style={{ flexWrap: "nowrap", alignItems: "end" }}>
            <div className="stack" style={{ flex: 1, minWidth: 0 }}>
              {control({ id, def })}
            </div>
            <TermMark term={def} env={terms} />
          </div>
        ) : (
          control({ id, def })
        ),
      )}
      {opened && <PackEntrySheet opened={opened} ruleset={ruleset} onClose={close} />}
    </fieldset>
  );
}
