"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, ActionResult, Actor, BookSource } from "@inconsistable/core-schema";
import type { CompiledRuleset, LookupStep, RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { appliesTo, groupSteps, previewOf, typedOf } from "@/lib/lookup/lookup";

type TableLookupProps = {
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
  /** Opens the table a line names, for the same target. */
  onNext: (tableId: string) => void;
};

// A lookup on the GM's tables panel (house decision #87): the number the dice showed (ROLL fills it in when the
// table may be rolled, I ROLLED is typing it), the inputs as switches and steppers, the line it reads worked out with
// the engine for the picked target, and APPLY, which the server works out again before anything changes.
export function TableLookup(props: TableLookupProps) {
  const { tableId, table, compiled, ruleset, target, characters, campaign, books, requestPage, ask, onNext } = props;
  const t = useTranslations("tables");
  const te = useTranslations("errors");
  const [typed, setTyped] = useState("");
  const [inputs, setInputs] = useState<Record<string, number | boolean>>({});
  const result = typedOf(typed);
  const plan = previewOf({ compiled, tableId, result, inputs, target, characters, campaign });
  const entry = plan?.ok ? table.entries[plan.entry] : undefined;
  const label = (id: string) => ruleset.resources.find((r) => r.id === id)?.label ?? id;
  const harm = ruleset.health.harm;

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
    if (r.ok) setTyped("");
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
            onChange={(e) => setTyped(e.target.value)}
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
            <span>{x.label}</span>
            <span className="stepper" role="group" aria-label={x.label}>
              <button
                type="button"
                className="btn"
                aria-label={t("less", { label: x.label })}
                onClick={() => handleStep(x.id, -1, x.min ?? 0, x.max ?? 99)}
              >
                −
              </button>
              <output>{Number(inputs[x.id] ?? x.min ?? 0)}</output>
              <button
                type="button"
                className="btn"
                aria-label={t("more", { label: x.label })}
                onClick={() => handleStep(x.id, 1, x.min ?? 0, x.max ?? 99)}
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
      <div className="row">
        {appliesTo(table) && (
          <button className="btn primary" disabled={!target || !plan?.ok}>
            {target ? t("apply", { name: target.name }) : t("pickTarget")}
          </button>
        )}
        {entry?.next && ruleset.tables?.[entry.next] && (
          <button type="button" className="btn" onClick={() => onNext(entry.next ?? "")}>
            {t("next", { title: ruleset.tables[entry.next]?.title ?? entry.next })}
          </button>
        )}
      </div>
    </form>
  );
}
