"use client";
import { useTranslations } from "next-intl";

import { Cite } from "@/components/ui/cite/cite";
import type { WidgetModel } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";

type CardsProps = { model: Extract<WidgetModel, { widget: "cards" }>; env: WidgetEnv };

// Datacards for what the saved build holds, read as the ledger lines are: a name, a short stat line, its tags and a
// cite; never the books' wording, which is not in the data. Weapons are a table (name and rules, damage, AP); armour
// and gear a line each; powers a card with their numbers and the importer's summary.
export function Cards({ model, env }: CardsProps) {
  const t = useTranslations("sheet.ledger");
  const tw = useTranslations("sheet.widget");
  const { lines, variant } = model;
  const cite = (c: string | undefined) =>
    c && <Cite cite={c} ruleset={env.ruleset} books={env.books} requestPage={env.requestPage} />;
  if (variant === "weapons")
    return (
      <div role="table" className="w-cards" aria-label={model.label ?? t("weapons")}>
        <div role="row" className="w-cards-row w-cards-head">
          <span role="columnheader">{tw("name")}</span>
          <span role="columnheader">{tw("damage")}</span>
          <span role="columnheader">{tw("ap")}</span>
        </div>
        {lines.weapons.map((w, i) => (
          <div key={i} role="row" className="w-cards-row">
            <span role="rowheader" className="w-cards-name">
              <b>{w.count && w.count > 1 ? t("count", { name: w.name, count: w.count }) : w.name}</b>
              <span className="w-cards-rules">
                {[
                  t("range", { range: w.range.join(" / ") }),
                  w.salvo !== undefined && w.salvo !== null ? t("salvo", { salvo: w.salvo }) : null,
                  ...w.traits,
                ]
                  .filter((x) => x !== null)
                  .join(" · ")}
              </span>
            </span>
            <span role="cell" className="w-cards-num">
              {w.damage}
              <small>{tw("ed", { ed: String(w.ed) })}</small>
            </span>
            <span role="cell" className="w-cards-num">
              {w.ap ? w.ap : "–"}
            </span>
          </div>
        ))}
      </div>
    );
  if (variant === "armour")
    return (
      lines.armour && (
        <p className="w-kit">
          <b>{lines.armour.name}</b>
          {[t("armour", { ar: lines.armour.ar }), ...lines.armour.traits].map((x) => ` · ${x}`).join("")}
        </p>
      )
    );
  if (variant === "gear")
    return (
      <ul className="w-kits">
        {lines.gear.map((g, i) => (
          <li key={i} className="w-kit">
            {g}
          </li>
        ))}
      </ul>
    );
  return (
    <ul className="w-kits">
      {lines.powers.map((p, i) => (
        <li key={i} className="w-kit w-kit-card">
          <span className="stack" style={{ gap: 2 }}>
            <b>{p.name}</b>
            <span className="small">
              {t("power", { dn: String(p.dn), activation: p.activation, duration: p.duration, range: p.range })}
            </span>
            {p.summary && <span className="small dim">{p.summary}</span>}
          </span>
          {cite(p.page)}
        </li>
      ))}
    </ul>
  );
}
