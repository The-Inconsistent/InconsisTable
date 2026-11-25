"use client";
import { useTranslations } from "next-intl";

import type { HeaderItem } from "@/lib/header/header";

// What the ruleset's `header` block asks for beside the room's name: `label value` per campaign field, `Round N`.
export function HeaderItems({ items }: { items: readonly HeaderItem[] }) {
  const t = useTranslations("gmApp.header");
  if (items.length === 0) return null;
  return (
    <ul className="header-items">
      {items.map((item) =>
        item.kind === "round" ? (
          <li key="round" className="chip">
            {t("round", { round: item.round })}
          </li>
        ) : (
          <li key={item.id} className="chip">
            <span className="dim">{item.label}</span>{" "}
            <span className="header-value">
              {typeof item.value === "boolean" ? t(item.value ? "yes" : "no") : item.value}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
