"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";
import type { FieldRoll, Ruleset } from "@inconsistable/rules-engine";

import { rolledText } from "@/lib/entry-fields/entry-fields";
import { typedOf } from "@/lib/lookup/lookup";

type RollIntoProps = {
  roll: FieldRoll;
  ruleset: Ruleset | null;
  /** What the rolled words fill, for the buttons' names. */
  label: string;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The words the rolled lines make, for the GM to keep or change before SAVE. */
  onRolled: (text: string) => void;
  disabled: boolean;
};

// ROLL and I ROLLED beside a field a ruleset rolls on its tables (house decision #97): each table in order through
// table.roll, as the tables panel rolls it, and the lines' words put in the field. Nothing is saved here.
export function RollInto({ roll, ruleset, label, act, onRolled, disabled }: RollIntoProps) {
  const t = useTranslations("entryFields");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState<readonly string[]>(roll.tables.map(() => ""));
  const titles = roll.tables.map((id) => ruleset?.tables?.[id]?.title ?? id);

  // Rolls (or reads the typed numbers on) each table in order; stops at the first refusal, which the codex shows.
  const run = async (results: readonly (number | null)[]) => {
    const rolled: { tableId: string; entryId: string }[] = [];
    for (const [i, tableId] of roll.tables.entries()) {
      const result = results[i] ?? null;
      const r = await act({ type: "table.roll", tableId, ...(result === null ? {} : { result }) });
      if (!r.ok || !r.roll) return;
      rolled.push({ tableId, entryId: r.roll.entryId });
    }
    onRolled(rolledText({ ruleset, rolled, join: roll.join }));
  };

  // I ROLLED: the GM's own dice, one number per table.
  const handleTyped = async (e: FormEvent) => {
    e.preventDefault();
    const results = typed.map(typedOf);
    if (results.some((n) => n === null)) return;
    await run(results);
    setTyping(false);
    setTyped(roll.tables.map(() => ""));
  };

  return (
    <div className="stack roll-into">
      <div className="row">
        <button
          type="button"
          className="btn sm"
          disabled={disabled}
          onClick={() => run([])}
          aria-label={t("rollInto", { label })}
        >
          {t("roll")}
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={disabled}
          aria-expanded={typing}
          onClick={() => setTyping(!typing)}
          aria-label={t("typedInto", { label })}
        >
          {t("typed")}
        </button>
      </div>
      {typing && (
        <form className="row" onSubmit={handleTyped}>
          {titles.map((title, i) => (
            <input
              key={i}
              className="input table-typed"
              inputMode="numeric"
              value={typed[i] ?? ""}
              onChange={(e) => setTyped(typed.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={t("typedOn", { title })}
              placeholder={title}
            />
          ))}
          <button className="btn sm" disabled={typed.some((x) => typedOf(x) === null)}>
            {t("useTyped")}
          </button>
        </form>
      )}
    </div>
  );
}
