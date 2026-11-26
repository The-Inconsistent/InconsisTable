"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";
import { MAX_CELL_CHARS, MAX_ROWS, offeredValues, type CodexField, type Ruleset } from "@inconsistable/rules-engine";

import { RowChips } from "@/components/ui/entry-fields/entry-fields";
import {
  newRowId,
  prefillRow,
  rolledRows,
  rollTimes,
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
  /** Sends an action: a field the ruleset rolls rows into offers ROLL (house decision #173). */
  act?: (a: ActionInput) => Promise<ActionResult>;
  /** The campaign fields in play: how many times a roll goes, and what a Test column's inputs read. */
  campaign?: Readonly<Record<string, string | number | boolean>>;
};

// A rows field in the GM's editor (house decision #89): each row as its chips and one input per column, from the
// declaration (text, a number, an enum's labels, a yes/no, a pack entry, a Test of the ruleset with its inputs); a row
// written by hand, or filled from a pack entry of a type the field declares, keeping that entry's key and cite.
export function RowsEditor(props: RowsEditorProps) {
  const { id, def, ruleset, campaignId, known, value, disabled, onChange, onPicked, act, campaign } = props;
  const t = useTranslations("entryFields");
  const [rolling, setRolling] = useState(false);
  const max = Math.min(def.maxRows ?? MAX_ROWS, MAX_ROWS);
  const full = value.length >= max;
  const rolls = def.rolls;
  const times = rollTimes({ def, campaign });
  const table = rolls ? (ruleset?.tables?.[rolls.table]?.title ?? rolls.table) : "";

  // ROLL: the field's table through table.roll, once per the campaign value, each line a new row (house decision
  // #173); a refusal stops the rolls and the codex shows it.
  // ponytail: no I ROLLED here, the tables panel takes typed results; a typed list per roll when a table asks for it.
  const handleRoll = async () => {
    if (!rolls || !act) return;
    setRolling(true);
    const labels: string[] = [];
    try {
      for (let n = 0; n < Math.min(times, max - value.length); n++) {
        const r = await act({ type: "table.roll", tableId: rolls.table });
        if (!r.ok || !r.roll) break;
        const entryId = r.roll.entryId;
        labels.push(ruleset?.tables?.[rolls.table]?.entries.find((e) => e.id === entryId)?.label ?? entryId);
      }
    } finally {
      setRolling(false);
    }
    if (labels.length > 0) onChange(rolledRows({ def, rows: value, labels }));
  };

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
            <RowChips ruleset={ruleset} def={def} row={row} known={known} campaign={campaign} />
            {!disabled &&
              def.columns.map((col) => (
                <Cell
                  key={col.id}
                  id={`${id}-${row.id}-${col.id}`}
                  col={col}
                  body={known.find((k) => k.type === row.from?.entity && k.key === row.from.key)?.body}
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
            {rolls && act && (
              <button
                type="button"
                className="btn sm"
                style={{ justifySelf: "start" }}
                disabled={rolling}
                onClick={handleRoll}
              >
                {t("rollRows", { table, count: times })}
              </button>
            )}
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
  /** The body of the pack entry the row was filled from, where this seat read it: an enum's offered words. */
  body: Readonly<Record<string, unknown>> | undefined;
  ruleset: Ruleset | null;
  campaignId: string;
  known: readonly RulesEntry[];
  value: unknown;
  onValue: (v: unknown) => void;
  onPicked: (entry: RulesEntry) => void;
};

// One column's input for one row.
function Cell({ id, col, body, ruleset, campaignId, known, value, onValue, onPicked }: CellProps) {
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
            {offeredValues({ col, body }).map((v) => (
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
          each={col.each ?? null}
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
  /** The input that may list words, one Test chip each (house decision #173); null without one. */
  each: string | null;
  ruleset: Ruleset | null;
  value: TestCell | undefined;
  onValue: (v: TestCell | null) => void;
};

// A Test cell: a Test of the ruleset in its words and the inputs it takes, as a prepared Test line holds them; an input
// left empty is left out, for the GM to fill in at the table.
function TestCellInput({ id, label, each, ruleset, value, onValue }: TestCellInputProps) {
  const t = useTranslations("entryFields");
  const test = value ? testOf({ ruleset, testId: value.testId }) : undefined;
  const words = testWords(test ?? { id: value?.testId ?? "" });
  const inputs = value?.inputs ?? {};

  // One input: a number as a whole number, a choice or text as written; empty leaves it out.
  const handleInput = (input: string, type: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!value) return;
    const { [input]: _old, ...rest } = inputs;
    const raw = e.target.value.trim();
    // The each input takes words split by commas, one chip each (house decision #173).
    const words = raw.split(",").flatMap((w) => (w.trim() === "" ? [] : [w.trim()]));
    const v =
      input === each && words.length > 1
        ? words
        : type === "int"
          ? raw === "" || !Number.isSafeInteger(Number(raw))
            ? undefined
            : Number(raw)
          : raw || undefined;
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
                  {input === each && <span className="small dim">{t("eachHint")}</span>}
                  {options && input !== each ? (
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
