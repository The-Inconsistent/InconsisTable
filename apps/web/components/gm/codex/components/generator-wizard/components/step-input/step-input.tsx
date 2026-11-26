"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";
import { pickFits, type GeneratorStep, type Ruleset, type StepValue } from "@inconsistable/rules-engine";

import { IntInput } from "@/components/gm/codex/components/entry-fields-form/components/int-input/int-input";
import { Cite } from "@/components/ui/cite/cite";
import { TableTrail } from "@/components/ui/table-trail/table-trail";
import { readEntries } from "@/hooks/use-pack-entry/use-pack-entry";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import type { RulesEntry } from "@/lib/library/library";
import { rollChain } from "@/lib/generators/generators";
import { typedOf } from "@/lib/lookup/lookup";
import { rulesUrl } from "@/lib/rules-reader/rules-reader";

type StepInputProps = {
  step: GeneratorStep;
  /** The steps above this one, and their answers, which a pick's filter reads. */
  before: readonly GeneratorStep[];
  answers: Readonly<Record<string, StepValue>>;
  value: StepValue | undefined;
  onChange: (value: StepValue | undefined) => void;
  ruleset: Ruleset;
  campaignId: string;
  campaign: Readonly<Record<string, string | number | boolean>>;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** A picked entry's name, kept for the confirm's words. */
  onPicked: (entry: RulesEntry) => void;
  pickedName: string | null;
};

// One step of a generator's wizard (house decision #98): a roll through table.roll (ROLL or I ROLLED, going on through a
// line's `next` with the trail of tables), a pick from the served entries its filter lets through, or a value by hand.
export function StepInput(props: StepInputProps) {
  const { step, before, answers, value, onChange, ruleset, campaignId, campaign, act, onPicked, pickedName } = props;
  const t = useTranslations("generators");
  const tr = useRefusal();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<RulesEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entity = step.kind === "pick" ? step.entity : null;

  // A pick lists the served entries of its type that match what was typed.
  useEffect(() => {
    if (entity === null) return;
    let live = true;
    const read = async () => {
      try {
        const entries = await readEntries({
          url: rulesUrl({ campaignId, type: entity, q, offset: 0 }),
          fallback: t("readFailed"),
          tr,
        });
        if (live) setFound(entries.filter((e) => e.type === entity));
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : t("readFailed"));
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [campaignId, entity, q, t, tr]);

  const header = (
    <span className="small dim">
      {step.label}
      {step.kind === "roll" && ` · ${ruleset.tables?.[step.table]?.title ?? step.table}`}
    </span>
  );

  if (step.kind === "roll") {
    const rows = value?.rows ?? [];
    // The table rolled next: the step's own, then the one the last line sends on to; none once a line has no `next`.
    const { trail, next } = rollChain({ ruleset, table: step.table, rows });
    const nextTable = next === undefined ? undefined : ruleset.tables?.[next];
    // ROLL, or the number the GM's own dice showed: the line read joins the step's chain.
    const roll = async (result: number | null) => {
      if (next === undefined) return;
      const r = await act({ type: "table.roll", tableId: next, ...(result === null ? {} : { result }) });
      if (r.ok && r.roll) onChange({ rows: [...rows, r.roll.entryId] });
    };
    const handleTyped = async (e: FormEvent) => {
      e.preventDefault();
      const n = typedOf(typed);
      if (n === null) return;
      await roll(n);
      setTyped("");
    };
    return (
      <div className="stack">
        {header}
        <TableTrail steps={trail} onClear={rows.length > 0 ? () => onChange(undefined) : undefined} />
        {nextTable && (
          <div className="row">
            <button type="button" className="btn sm primary" onClick={() => roll(null)}>
              {rows.length === 0 ? t("roll") : t("rollOn", { title: nextTable.title })}
            </button>
            <form className="row" onSubmit={handleTyped}>
              <input
                className="input table-typed"
                inputMode="numeric"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label={t("typedOn", { title: nextTable.title })}
                placeholder={t("typed")}
              />
              <button className="btn sm" disabled={typedOf(typed) === null}>
                {t("useTyped")}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  if (step.kind === "pick") {
    const shown = (found ?? []).filter((e) => pickFits({ ruleset, step, before, answers, campaign, body: e.body }));
    return (
      <div className="stack">
        {header}
        {value?.key && (
          <div className="row">
            <strong>{pickedName ?? value.key}</strong>
            <button type="button" className="btn sm" onClick={() => onChange(undefined)}>
              {t("change")}
            </button>
          </div>
        )}
        {!value?.key && (
          <>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t("search", { label: step.label })}
              placeholder={t("search", { label: step.label })}
              maxLength={100}
            />
            {error && <p className="error">{error}</p>}
            <ul className="list" aria-label={t("results", { label: step.label })}>
              {found !== null && shown.length === 0 && <li className="dim">{t("noMatch")}</li>}
              {shown.slice(0, 12).map((e) => (
                <li key={`${e.pack}/${e.key}`}>
                  <button
                    type="button"
                    className="found"
                    onClick={() => {
                      onPicked(e);
                      onChange({ key: e.key });
                    }}
                  >
                    <strong>{e.name}</strong>
                    {e.cite && <Cite cite={e.cite} />}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (step.kind === "number")
    return (
      <IntInput
        id={`generator-${step.id}`}
        label={step.label}
        min={step.min}
        max={step.max}
        value={typeof value?.value === "number" ? value.value : null}
        disabled={false}
        onValue={(n) => onChange(n === null ? undefined : { value: n })}
      />
    );

  if (step.kind === "choice")
    return (
      <label className="stack">
        {step.label}
        <select
          value={typeof value?.value === "string" ? value.value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : { value: e.target.value })}
        >
          <option value="">{t("choose")}</option>
          {step.options.map((o) => (
            <option key={o} value={o}>
              {step.labels?.[o] ?? o}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <label className="stack">
      {step.label}
      <input
        value={typeof value?.value === "string" ? value.value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : { value: e.target.value })}
        maxLength={step.maxLength ?? 200}
      />
    </label>
  );
}
