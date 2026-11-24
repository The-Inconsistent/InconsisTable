"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { budgetOf, type BudgetPick, type Ruleset, type SpawnRoom } from "@inconsistable/rules-engine";

import { toggled } from "@/lib/spawn/spawn";

type BudgetLinesProps = {
  ruleset: Ruleset | null | undefined;
  picks: readonly BudgetPick[];
  room: SpawnRoom;
};

// The ruleset's encounter budget (house decision #92): each line's count so far against its budget for this table, and
// the switches the GM turns on here. A reading aid: it refuses nothing and stores nothing, so a switch lives on this
// screen only. A line over its budget says so in words.
export function BudgetLines({ ruleset, picks, room }: BudgetLinesProps) {
  const t = useTranslations("budget");
  const [switches, setSwitches] = useState<string[]>([]);
  const budget = ruleset?.spawn?.budget;
  if (!ruleset || budget === undefined) return null;
  const lines = budgetOf({ ruleset, picks, room, switches });
  return (
    <section className="stack budget-lines" aria-label={t("title")}>
      <strong>
        {t("title")} <span className="small dim">{t("seated", { count: room.seated })}</span>
      </strong>
      <ul className="list">
        {lines.map((l) => {
          const over = l.budget !== null && l.used > l.budget;
          return (
            <li key={l.id} data-over={over}>
              <span>
                {l.budget === null
                  ? t("unread", { label: l.label, used: l.used })
                  : t("line", { label: l.label, used: l.used, budget: l.budget })}
              </span>
              {over && <span className="chip">{t("over")}</span>}
            </li>
          );
        })}
      </ul>
      {(budget.switches ?? []).length > 0 && (
        <div className="row" role="group" aria-label={t("switches")}>
          {(budget.switches ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn sm"
              aria-pressed={switches.includes(s.id)}
              onClick={() => setSwitches((x) => toggled({ ids: x, id: s.id }))}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
