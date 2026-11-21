"use client";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import { MAX_CELL_CHARS, MAX_ROWS, type CodexField, type Ruleset } from "@inconsistable/rules-engine";

import { RowChips } from "@/components/ui/entry-fields/entry-fields";
import {
  newRowId,
  prefillRow,
  testOf,
  type EntryRow,
  type RowColumn,
  type TestCell,
} from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";
import { testWords } from "@/lib/test-inputs/test-inputs";

import { IntInput } from "../int-input/int-input";
import { RefPicker } from "../ref-picker/ref-picker";

type RowsEditorProps = {
  id: string;
  def: Extract<CodexField, { type: "rows" }>;
  ruleset: Ruleset | null;
  campaignId: string;
  /** Pack entries this seat already read, to name a ref cell. */
  known: readonly RulesEntry[];
  value: readonly EntryRow[];
  disabled: boolean;
  onChange: (rows: EntryRow[]) => void;
  /** A pack entry read here, remembered by the form so a ref names it. */
  onPicked: (entry: RulesEntry) => void;
};

// A rows field in the GM's editor (house decision #89): each row as its chips and one input per column, from the
// declaration (text, a number, an enum's labels, a yes/no, a pack entry, a Test of the ruleset with its inputs); a row
// written by hand, or filled from a pack entry of a type the field declares, keeping that entry's key and cite.
export function RowsEditor(props: RowsEditorProps) {
  const { id, def, ruleset, campaignId, known, value, disabled, onChange, onPicked } = props;
  const t = useTranslations("entryFields");
  const max = Math.min(def.maxRows ?? MAX_ROWS, MAX_ROWS);
  const full = value.length >= max;

  // One cell of one row: a value sets it, null clears it.
  const setCell = (rowId: string, col: string, v: unknown) =>
    onChange(
      value.map((r) => {
        if (r.id !== rowId) return r;
        const { [col]: _old, ...rest } = r.values;
        return { ...r, values: v === null || v === undefined || v === "" ? rest : { ...rest, [col]: v } };
      }),
    );

  // A row filled from the picked pack entry.
  const handleFill = (entry: RulesEntry | null) => {
    if (!entry || full) return;
    onPicked(entry);
    onChange([...value, prefillRow({ def, entry, id: newRowId() })]);
  };

  return (
    <div className="stack" style={{ minWidth: 0 }} data-field="rows">
      <span>{def.label}</span>
      <ol className="list stack">
        {value.map((row, n) => (
          <li key={row.id} className="card stack" style={{ minWidth: 0 }} data-row={row.id}>
            <div className="row between" style={{ flexWrap: "wrap" }}>
              <strong>{t("row", { n: n + 1 })}</strong>
              {!disabled && (
                <button
                  type="button"
                  className="btn sm"
                  aria-label={t("removeRow", { n: n + 1 })}
                  onClick={() => onChange(value.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              )}
            </div>
            <RowChips ruleset={ruleset} def={def} row={row} known={known} />
            {!disabled &&
              def.columns.map((col) => (
                <Cell
                  key={col.id}
                  id={`${id}-${row.id}-${col.id}`}
                  col={col}
                  ruleset={ruleset}
                  campaignId={campaignId}
                  known={known}
                  value={Object.hasOwn(row.values, col.id) ? row.values[col.id] : undefined}
                  onValue={(v) => setCell(row.id, col.id, v)}
                  onPicked={onPicked}
                />
              ))}
          </li>
        ))}
      </ol>
      {!disabled &&
        (full ? (
          <span className="small dim">{t("rowsFull", { max })}</span>
        ) : (
          <>
            <button
              type="button"
              className="btn sm"
              style={{ justifySelf: "start" }}
              onClick={() => onChange([...value, { id: newRowId(), values: {} }])}
            >
              {t("addRow")}
            </button>
            {(def.from ?? []).map((f) => (
              <RefPicker
                key={f.entity}
                id={`${id}-fill-${f.entity}`}
                label={t("fillFrom", { type: ruleset?.entities.find((e) => e.id === f.entity)?.label ?? f.entity })}
                campaignId={campaignId}
                entity={f.entity}
                value={null}
                name={null}
                disabled={false}
                onPick={handleFill}
                onOpen={() => undefined}
              />
            ))}
          </>
        ))}
    </div>
  );
}

type CellProps = {
  id: string;
  col: RowColumn;
  ruleset: Ruleset | null;
  campaignId: string;
  known: readonly RulesEntry[];
  value: unknown;
  onValue: (v: unknown) => void;
  onPicked: (entry: RulesEntry) => void;
};

// One column's input for one row.
function Cell({ id, col, ruleset, campaignId, known, value, onValue, onPicked }: CellProps) {
  const t = useTranslations("entryFields");
  // A select or text box: empty clears the cell.
  const handleText = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onValue(e.target.value || null);
  switch (col.type) {
    case "text":
      return (
        <label className="stack">
          {col.label}
          <input
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={handleText}
            maxLength={Math.min(col.maxLength ?? MAX_CELL_CHARS, MAX_CELL_CHARS)}
          />
        </label>
      );
    case "int":
      return (
        <IntInput
          id={id}
          label={col.label}
          min={col.min}
          max={col.max}
          value={typeof value === "number" ? value : null}
          disabled={false}
          onValue={onValue}
        />
      );
    case "enum":
      return (
        <label className="stack">
          {col.label}
          <select id={id} value={typeof value === "string" ? value : ""} onChange={handleText}>
            <option value="">{t("none")}</option>
            {col.values.map((v) => (
              <option key={v} value={v}>
                {col.labels?.[v] ?? v}
              </option>
            ))}
          </select>
        </label>
      );
    case "bool":
      return (
        <label className="row">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={value === true}
            onChange={(e) => onValue(e.target.checked ? true : null)}
          />
          {col.label}
        </label>
      );
    case "ref": {
      const key = typeof value === "string" ? value : null;
      const named = key === null ? undefined : known.find((k) => k.type === col.entity && k.key === key);
      return (
        <RefPicker
          id={id}
          label={col.label}
          campaignId={campaignId}
          entity={col.entity}
          value={key}
          name={named?.name ?? null}
          disabled={false}
          onPick={(entry) => {
            if (entry) onPicked(entry);
            onValue(entry?.key ?? null);
          }}
          onOpen={() => undefined}
        />
      );
    }
    case "test":
      return (
        <TestCellInput
          id={id}
          label={col.label}
          ruleset={ruleset}
          value={value as TestCell | undefined}
          onValue={onValue}
        />
      );
  }
}

type TestCellInputProps = {
  id: string;
  label: string;
  ruleset: Ruleset | null;
  value: TestCell | undefined;
  onValue: (v: TestCell | null) => void;
};

// A Test cell: a Test of the ruleset in its words and the inputs it takes, as a prepared Test line holds them; an input
// left empty is left out, for the GM to fill in at the table.
function TestCellInput({ id, label, ruleset, value, onValue }: TestCellInputProps) {
  const t = useTranslations("entryFields");
  const test = value ? testOf({ ruleset, testId: value.testId }) : undefined;
  const words = testWords(test ?? { id: value?.testId ?? "" });
  const inputs = value?.inputs ?? {};

  // One input: a number as a whole number, a choice or text as written; empty leaves it out.
  const handleInput = (input: string, type: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!value) return;
    const { [input]: _old, ...rest } = inputs;
    const raw = e.target.value.trim();
    const v =
      type === "int" ? (raw === "" || !Number.isSafeInteger(Number(raw)) ? undefined : Number(raw)) : raw || undefined;
    onValue({ ...value, inputs: v === undefined ? rest : { ...rest, [input]: v } });
  };

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <label className="stack">
        {label}
        <select
          id={id}
          value={value?.testId ?? ""}
          onChange={(e) => onValue(e.target.value ? { testId: e.target.value, inputs: {} } : null)}
        >
          <option value="">{t("noTest")}</option>
          {value && !test && <option value={value.testId}>{value.testId}</option>}
          {Object.keys(ruleset?.tests ?? {}).map((testId) => (
            <option key={testId} value={testId}>
              {testWords(testOf({ ruleset, testId }) ?? { id: testId }).test}
            </option>
          ))}
        </select>
      </label>
      {test && Object.keys(test.inputs).length > 0 && (
        <div className="row" style={{ alignItems: "end" }}>
          {Object.entries(test.inputs)
            .filter(([, type]) => type !== "bool")
            .map(([input, type]) => {
              const options = test.inputOptions[input];
              return (
                <label key={input} className="stack">
                  {words.input(input)}
                  {options ? (
                    <select
                      id={`${id}-${input}`}
                      value={String(inputs[input] ?? "")}
                      onChange={handleInput(input, type)}
                    >
                      <option value="">{t("none")}</option>
                      {options.map((o) => (
                        <option key={o} value={o}>
                          {words.value(input, o)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`${id}-${input}`}
                      inputMode={type === "int" ? "numeric" : "text"}
                      defaultValue={String(inputs[input] ?? "")}
                      onChange={handleInput(input, type)}
                      style={{ width: type === "int" ? 96 : 160 }}
                    />
                  )}
                </label>
              );
            })}
        </div>
      )}
    </div>
  );
}
