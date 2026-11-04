import { useTranslations } from "next-intl";

import type { Combatant } from "@inconsistable/core-schema";

import { barPercent } from "@/lib/track/track";

type HealthBarProps = { combatant: Pick<Combatant, "name" | "bar" | "hp"> };

// A combatant's health: a bar from its fraction, and the numbers only where the seat was sent them. Nothing when the
// actor has no health to show.
export function HealthBar({ combatant: c }: HealthBarProps) {
  const t = useTranslations("healthBar");
  const percent = barPercent(c);
  if (percent === null) return null;
  return (
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
      {c.hp && (
        <span className="small" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {c.hp.value}
          {c.hp.max !== null && ` / ${c.hp.max}`}
        </span>
      )}
    </span>
  );
}
