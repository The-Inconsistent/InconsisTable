import { useTranslations } from "next-intl";

import type { Combatant } from "@inconsistable/core-schema";

import { drawnOf } from "@/lib/harm/harm";

type HealthBarProps = { combatant: Pick<Combatant, "name" | "bar" | "hp" | "states" | "members"> };

// A combatant's health: a bar from its fraction, the numbers only where the seat was sent them, then the ruleset's
// states that hold and a mob's count as chips. Nothing when the seat was sent none of it.
export function HealthBar({ combatant: c }: HealthBarProps) {
  const t = useTranslations("healthBar");
  const { percent, numbers, states, count } = drawnOf(c);
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
      {(states.length > 0 || count !== null) && (
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
        </span>
      )}
    </>
  );
}
