import { useTranslations } from "next-intl";

import type { Combatant } from "@inconsistable/core-schema";

import { drawnOf } from "@/lib/harm/harm";

type HealthBarProps = {
  combatant: Pick<Combatant, "name" | "bar" | "hp" | "states" | "members" | "conditions">;
  /** The ruleset's conditions, for their labels. Given, the conditions the seat was sent are drawn too (#67). */
  conditions?: readonly { id: string; label: string }[];
  /** What the actor holds up (house decision #91), drawn beside its conditions. */
  held?: readonly { label: string; item: string }[];
};

// A combatant's health: a bar from its fraction, the numbers only where the seat was sent them, then a mob's count, the
// ruleset's states that hold and the conditions it carries as chips. Nothing when the seat was sent none of it.
export function HealthBar({ combatant: c, conditions: defs, held = [] }: HealthBarProps) {
  const t = useTranslations("healthBar");
  const { percent, numbers, states, count } = drawnOf(c);
  const conditions = defs
    ? c.conditions.map((k) => {
        const label = defs.find((d) => d.id === k.id)?.label ?? k.id;
        // A rated condition shows how many it holds on every seat that sees it (house decision #81).
        return { id: k.id, label: k.stacks === undefined ? label : t("stacked", { label, count: k.stacks }) };
      })
    : [];
  return (
    <>
      {percent !== null && (
        <span className="row" style={{ flexWrap: "nowrap" }}>
          <span
            className="bar"
            role="img"
            aria-label={t("label", { name: c.name, percent })}
            data-low={percent <= 25}
            style={{ flex: 1 }}
          >
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </span>
          {numbers && (
            <span className="small" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {numbers.value}
              {numbers.max !== null && ` / ${numbers.max}`}
            </span>
          )}
        </span>
      )}
      {(states.length > 0 || count !== null || conditions.length > 0 || held.length > 0) && (
        <span className="row small health-states">
          {count !== null && (
            <span className="chip" data-count="true" aria-label={t("count", { count })}>
              {t("times", { count })}
            </span>
          )}
          {states.map((s) => (
            <span key={s.id} className="chip" data-health-state={s.id}>
              {s.label}
            </span>
          ))}
          {conditions.map((k) => (
            <span key={k.id} className="chip" data-condition={k.id}>
              {k.label}
            </span>
          ))}
          {held.map((h) => (
            <span key={`${h.label}-${h.item}`} className="chip" data-held="true">
              {t("held", h)}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
