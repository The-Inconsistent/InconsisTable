"use client";
import { useTranslations } from "next-intl";

import { EncounterReminder, type Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import type { Run } from "@/components/gm/track/constants";
import { endingThisTurn } from "@/lib/reminders/reminders";

type ReminderLinesProps = {
  encounter: Encounter;
  /** The pinned ruleset's sides order, when it has one: its setup note and whole-side bars. */
  sides?: SidesInitiative;
  run: Run;
};

// Under the turn bar, for the side running the fight (house decision #81): while a sides fight is set up, the ruleset's
// note and a way to bar or free a whole side at once; once it runs, the reminder lines due now, in the ruleset's own
// words, each with the combatants it holds for. Reminders only: nothing here changes a number.
export function ReminderLines({ encounter, sides, run }: ReminderLinesProps) {
  const t = useTranslations("reminders");
  const setup = encounter.begun === false && sides !== undefined;
  const lines = encounter.reminders ?? [];
  // A timed condition that ends with this turn needs no declaration: the count already says it (house decision #81).
  const ending = endingThisTurn(encounter);
  const acting = encounter.combatants.find((c) => c.id === encounter.currentId);
  const barring = setup && sides.barred !== undefined && encounter.round <= sides.barred.throughRound;
  if (!(setup && (sides.setup?.note !== undefined || barring)) && lines.length === 0 && ending.length === 0)
    return null;
  const nameOf = new Map(encounter.combatants.map((c) => [c.actorId, c.name]));
  const bar = (side: string, barred: boolean) => () =>
    run({ type: "rule.op", primitive: "initiative.sides", op: "bar", input: { side, barred } });
  return (
    <section className="reminders" aria-label={t("label")}>
      {setup && sides.setup?.note !== undefined && <p className="reminder-note">{sides.setup.note}</p>}
      {barring && (
        <div className="stack" role="group" aria-label={t("barSides")}>
          {sides.sides.map((s) => (
            <div key={s.id} className="row">
              <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
              <button className="btn sm" onClick={bar(s.id, true)}>
                {t("barSide", { side: s.label })}
              </button>
              <button className="btn sm" onClick={bar(s.id, false)}>
                {t("freeSide", { side: s.label })}
              </button>
            </div>
          ))}
        </div>
      )}
      {EncounterReminder.shape.at.options.map((at) => {
        const due = lines.filter((l) => l.at === at);
        const endingHere = at === "turnEnd" && ending.length > 0;
        if (due.length === 0 && !endingHere) return null;
        return (
          <div key={at} className="stack">
            <strong className="small">{t(at)}</strong>
            <ul className="list reminder-list">
              {due.map((l) => (
                <li key={`${l.source}:${l.id}`} data-reminder={l.source}>
                  <span>
                    {l.actorIds.length > 0 && (
                      <b>{t("names", { names: l.actorIds.map((id) => nameOf.get(id) ?? id).join(", ") })} </b>
                    )}
                    {l.text}
                  </span>
                  {l.cite !== null && <span className="dim small">{l.cite}</span>}
                </li>
              ))}
              {endingHere && (
                <li data-reminder="ending">
                  <span>
                    {acting !== undefined && <b>{t("names", { names: acting.name })} </b>}
                    {t("endsThisTurn", { conditions: ending.join(", ") })}
                  </span>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
