"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, ActionResult, Actor, BookSource } from "@inconsistable/core-schema";
import {
  inputBounds,
  type CompiledRuleset,
  type LookupStep,
  type RandomTable,
  type Ruleset,
} from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { RulesReply } from "@/lib/library/library";
import { appliesTo, grantTypesOf, groupSteps, previewOf, typedOf } from "@/lib/lookup/lookup";

type TableLookupProps = {
  campaignId: string;
  tableId: string;
  table: RandomTable;
  compiled: CompiledRuleset;
  ruleset: Ruleset;
  /** The panel's target, carried from one table to the next. */
  target: Actor | undefined;
  characters: number;
  campaign: Readonly<Record<string, unknown>>;
  books: readonly BookSource[];
  requestPage: RequestPage;
  ask: (a: ActionInput) => Promise<ActionResult>;
  /** Opens the table a line names, for the same target, with the line that sent the GM there. */
  onNext: (tableId: string, from: { title: string; label: string }) => void;
  /** A line applied: the chain that led to it is done. */
  onApplied: () => void;
  /** The inputs it starts with: a spend's, carried over when the spend opened this table (house decision #91). */
  start?: Readonly<Record<string, number | boolean>>;
};

const ENTRIES = 200;

// A lookup on the GM's tables panel (house decision #87): the number the dice showed (ROLL fills it in when the
// table may be rolled, I ROLLED is typing it), the inputs as switches and steppers, the line it reads worked out with
// the engine for the picked target, and APPLY, which the server works out again before anything changes.
export function TableLookup(props: TableLookupProps) {
  const {
    campaignId,
    tableId,
    table,
    compiled,
    ruleset,
    target,
    characters,
    campaign,
    books,
    requestPage,
    ask,
    onNext,
    onApplied,
    start,
  } = props;
  const t = useTranslations("tables");
  const te = useTranslations("errors");
  const [typed, setTyped] = useState("");
  const [inputs, setInputs] = useState<Record<string, number | boolean>>({ ...start });
  // The served names of the records the table grants, by key; null until the first result is typed.
  const [names, setNames] = useState<Record<string, string> | null>(null);
  const result = typedOf(typed);
  const plan = previewOf({ compiled, tableId, result, inputs, target, characters, campaign });
  const entry = plan?.ok ? table.entries[plan.entry] : undefined;
  const label = (id: string) => ruleset.resources.find((r) => r.id === id)?.label ?? id;
  const harm = ruleset.health.harm;
  // A line that grants a record ends a chain on ADD; one the target holds already is rolled again (house decision #88).
  const grants = plan?.ok === true && plan.steps.some((s) => s.kind === "grant");
  const held = plan?.ok === true && plan.steps.some((s) => s.kind === "grant" && s.has);

  // ROLL: the server rolls the table's die and the number lands in the entry, as if typed.
  const handleRoll = async () => {
    const inputsGiven = Object.keys(inputs).length > 0 ? { inputs } : {};
    const r = await ask({ type: "table.roll", tableId, ...(target ? { actorId: target.id } : {}), ...inputsGiven });
    if (r.ok && r.roll) setTyped(String(r.roll.value));
  };
  // APPLY: the typed result, the inputs and the target; the entry clears once it lands so it cannot be sent twice.
  const handleApply = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || result === null) return;
    const r = await ask({ type: "table.apply", tableId, result, actorId: target.id, inputs });
    if (!r.ok) return;
    setTyped("");
    onApplied();
  };
  // The typed result; the first one also loads the names of the records the table grants, for the preview.
  const handleTyped = async (text: string) => {
    setTyped(text);
    const types = grantTypesOf({ ruleset, table });
    if (names !== null || types.length === 0) return;
    setNames({});
    try {
      const read = await Promise.all(
        types.map(async (type) => {
          const path = `/api/campaigns/${encodeURIComponent(campaignId)}/rules?type=${encodeURIComponent(type)}&limit=${ENTRIES}`;
          const res = await fetch(path);
          const parsed = RulesReply.safeParse(await res.json());
          return res.ok && parsed.success ? parsed.data.entries : [];
        }),
      );
      setNames(Object.fromEntries(read.flat().map((e) => [e.key, e.name])));
    } catch {
      // A preview without names shows the keys, as before; the server names the record when it lands.
    }
  };
  // A stepper's − or +, held to its bounds.
  const handleStep = (id: string, by: number, min: number, max: number) =>
    setInputs((was) => ({ ...was, [id]: Math.max(min, Math.min(max, Number(was[id] ?? min) + by)) }));

  // One step in the platform's words: a change by its amount and label, a condition by its label.
  const words = (s: LookupStep): string[] => {
    switch (s.kind) {
      case "harm":
        return [
          ...(s.wounds !== 0 && harm ? [t("change", { by: s.wounds, label: label(harm.wounds) })] : []),
          ...(s.shock !== 0 && harm?.shock ? [t("change", { by: s.shock, label: label(harm.shock) })] : []),
        ];
      case "condition": {
        const name = ruleset.conditions.find((c) => c.id === s.condition)?.label ?? s.condition;
        return [s.immune ? t("immune", { label: name }) : name];
      }
      case "resource":
        return [t("change", { by: s.by, label: label(s.resource) })];
      case "pool":
        return [t("change", { by: s.by, label: label(s.pool) })];
      case "grant": {
        const kind = ruleset.held?.[s.held]?.label ?? s.held;
        const entry = names?.[s.entry] ?? s.entry;
        return [s.has ? t("grantHas", { kind, entry }) : t("grant", { kind, entry })];
      }
    }
  };
  const refusal = plan && !plan.ok ? refusalWords(plan) : null;
  function refusalWords(p: Extract<NonNullable<typeof plan>, { ok: false }>): string {
    switch (p.code) {
      case "tableResultOut":
        return te("tableResultOut", { min: p.min, max: p.max });
      case "tableInput":
        return te("tableInput", { input: p.input });
      case "unreadable":
        return te("incomplete", { name: target?.name ?? "", detail: p.detail });
      case "tableNotFound":
        return te("tableNotFound");
    }
  }

  return (
    <form className="stack table-lookup" onSubmit={handleApply}>
      <div className="row">
        <label className="stack table-typed">
          <span className="small">{table.typedOnly ? t("typedOnly") : t("typed")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={typed}
            onChange={(e) => void handleTyped(e.target.value)}
            aria-label={t("typedLabel", { title: table.title })}
          />
        </label>
        {!table.typedOnly && (
          <button type="button" className="btn" onClick={handleRoll}>
            {t("roll")}
          </button>
        )}
      </div>
      {(table.inputs ?? []).map((x) =>
        x.type === "bool" ? (
          <label key={x.id} className="row" style={{ minHeight: 44 }}>
            <input
              type="checkbox"
              role="switch"
              checked={inputs[x.id] === true}
              onChange={(e) => setInputs((was) => ({ ...was, [x.id]: e.target.checked }))}
            />
            {x.label}
          </label>
        ) : (
          <div key={x.id} className="row table-input">
            {/* A die the GM rolls and types (house decision #164) names its dice beside the label. */}
            <span>{x.dice ? t("diceInput", { label: x.label, dice: x.dice }) : x.label}</span>
            <span className="stepper" role="group" aria-label={x.label}>
              <button
                type="button"
                className="btn"
                aria-label={t("less", { label: x.label })}
                onClick={() => handleStep(x.id, -1, inputBounds(x).min ?? 0, inputBounds(x).max ?? 99)}
              >
                −
              </button>
              <output>{Number(inputs[x.id] ?? inputBounds(x).min ?? 0)}</output>
              <button
                type="button"
                className="btn"
                aria-label={t("more", { label: x.label })}
                onClick={() => handleStep(x.id, 1, inputBounds(x).min ?? 0, inputBounds(x).max ?? 99)}
              >
                +
              </button>
            </span>
          </div>
        ),
      )}
      {refusal && (
        <p className="dim" role="status">
          {refusal}
        </p>
      )}
      {plan?.ok && entry && (
        <output className="stack table-line">
          <span className="table-face">{entry.label}</span>
          <span className="dim">{t("reads", { total: plan.total })}</span>
          {appliesTo(table) &&
            (plan.steps.length === 0 ? (
              <span>{t("nothing")}</span>
            ) : (
              <ul className="table-steps" aria-label={t("effects")}>
                {groupSteps(plan.steps).flatMap(({ step, count }, i) =>
                  words(step).map((w, j) => (
                    <li key={`${i}-${j}`}>{count > 1 ? t("times", { step: w, count }) : w}</li>
                  )),
                )}
              </ul>
            ))}
          {entry.note && <span className="small">{entry.note}</span>}
          {(entry.cite ?? table.cite) && (
            <Cite cite={entry.cite ?? table.cite ?? ""} ruleset={ruleset} books={books} requestPage={requestPage} />
          )}
        </output>
      )}
      {held && (
        <p className="dim" role="status">
          {t("rollAgain")}
        </p>
      )}
      <div className="row">
        {appliesTo(table) && (
          <button className="btn primary" disabled={!target || !plan?.ok || held}>
            {!target ? t("pickTarget") : grants ? t("add", { name: target.name }) : t("apply", { name: target.name })}
          </button>
        )}
        {entry?.next && ruleset.tables?.[entry.next] && (
          <button
            type="button"
            className="btn"
            onClick={() => onNext(entry.next ?? "", { title: table.title, label: entry.label })}
          >
            {t("next", { title: ruleset.tables[entry.next]?.title ?? entry.next })}
          </button>
        )}
      </div>
    </form>
  );
}
