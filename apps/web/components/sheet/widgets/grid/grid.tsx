"use client";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import { Term } from "@/components/ui/term-card/term-card";
import { type GridRow, numberOf, signed, termOf, type WidgetModel } from "@/lib/sheet-widgets/sheet-widgets";

import { Num } from "../num/num";
import type { WidgetEnv } from "../types";

type GridProps = { model: Extract<WidgetModel, { widget: "grid" }>; env: WidgetEnv };

// A grid of rated values. `columns`: one column per rating, a row each for the rating, its bonus and its total.
// `pairs`: two columns of rows, each its name, its linked value, its rating and its total in a badge, hollow when the
// rating is 0 (untrained).
export function Grid({ model, env }: GridProps) {
  const t = useTranslations("sheet.widget");
  const { rows, columns } = model;
  if (model.variant === "pairs") {
    const half = Math.ceil(rows.length / 2);
    const halves = [rows.slice(0, half), rows.slice(half)].filter((h) => h.length > 0);
    const pair = (r: GridRow) => {
      const rating = numberOf({ actor: env.actor, row: r.rating });
      const badge = columns.total && r.total ? r.total : r.rating;
      return (
        <div key={r.rating.id} role="row" className="w-pairs-row" data-stat={r.rating.id}>
          <span role="rowheader" className="w-pairs-name">
            <Term term={termOf(r.rating)} env={env} />
          </span>
          {columns.link && (
            <span role="cell" className="w-pairs-link">
              {r.link?.label}
            </span>
          )}
          <span role="cell" className="w-pairs-rating">
            {rating === 0 ? "–" : rating}
          </span>
          <span role="cell" className="w-pairs-total">
            <Num row={badge} env={env} className={rating === 0 ? "w-badge hollow" : "w-badge"} />
            {rating === 0 && <span className="sr-only">{t("untrained")}</span>}
          </span>
        </div>
      );
    };
    return (
      <div className="w-pairs">
        {halves.map((h, i) => (
          <div key={i} role="table" className="w-pairs-col" aria-label={model.label ?? undefined}>
            <div role="row" className="sr-only">
              <span role="columnheader">{t("name")}</span>
              {columns.link && <span role="columnheader">{t("link")}</span>}
              <span role="columnheader">{t("rating")}</span>
              <span role="columnheader">{t("total")}</span>
            </div>
            {h.map(pair)}
          </div>
        ))}
      </div>
    );
  }
  const line = (key: "rating" | "bonus" | "total") => (
    <div role="row" className="w-grid-row" data-row={key}>
      <b role="rowheader">{t(key)}</b>
      {rows.map((r) => {
        const row = key === "rating" ? r.rating : r[key];
        return (
          <span key={r.rating.id} role="cell">
            {row && <Num row={row} env={env} format={key === "bonus" ? signed : String} />}
          </span>
        );
      })}
    </div>
  );
  return (
    <div
      role="table"
      className="w-grid"
      aria-label={model.label ?? undefined}
      style={{ "--cols": rows.length } as CSSProperties}
    >
      <div role="row" className="w-grid-row w-grid-head">
        <span role="columnheader" />
        {rows.map((r) => (
          <span key={r.rating.id} role="columnheader">
            <Term term={termOf(r.rating)} env={env} />
          </span>
        ))}
      </div>
      {line("rating")}
      {columns.bonus && line("bonus")}
      {columns.total && line("total")}
    </div>
  );
}
