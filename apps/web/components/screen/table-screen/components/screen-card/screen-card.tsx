"use client";
import { useTranslations } from "next-intl";

import type { Actor } from "@inconsistable/core-schema";
import type { LayoutRow, Ruleset } from "@inconsistable/rules-engine";

import { SheetWidget } from "@/components/sheet/widgets/sheet-widget/sheet-widget";
import type { WidgetEnv } from "@/components/sheet/widgets/types";
import { ResourceRow } from "@/components/ui/resource-row/resource-row";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { partsOf, printValue, type SheetRow } from "@/lib/sheet/sheet";

type ScreenCardProps = {
  actor: Actor;
  ruleset: Ruleset;
  /** The rows the ruleset lays out for this actor's entity on the table screen (`layout[entity].screen`). */
  rows: readonly LayoutRow[];
  range: WidgetEnv["range"];
  send: Send;
  requestPage: RequestPage;
};

// One character on the table screen (house decision #127): its name, then the rows its ruleset lays out for the screen,
// drawn with the sheet's own widgets from what the screen's seat received. Nobody touches the TV: no stepper, no
// breakdown, no meaning, and a cite is text (it is served no book). Nothing to draw: no card.
export function ScreenCard({ actor, ruleset, rows, range, send, requestPage }: ScreenCardProps) {
  const t = useTranslations("sheet");
  const parts = partsOf({ ruleset, actor, show: rows });
  if (parts.length === 0) return null;

  const rowView = (row: SheetRow) =>
    row.kind === "resource" ? (
      <ResourceRow
        key={`r-${row.id}`}
        stat={row.id}
        label={row.label}
        value={actor.resources[row.id] ?? 0}
        range={range(row.id)}
        steps={{ dec: false, inc: false }}
        holder={actor.name}
        onStep={() => undefined}
      />
    ) : (
      <div key={`${row.kind}-${row.id}`} className="sheet-row" data-stat={row.id} data-kind={row.kind}>
        <span className="stat-label">{row.label}</span>
        <strong className="sheet-num sheet-text">
          {printValue({
            value: row.kind === "derived" ? actor.derived[row.id] : actor.fields[row.id],
            yes: t("yes"),
            no: t("no"),
          })}
        </strong>
      </div>
    );
  const env: WidgetEnv = {
    actor,
    ruleset,
    gm: false,
    books: [],
    requestPage,
    send,
    rowView,
    range,
    onOpen: () => undefined,
    onError: () => undefined,
    readOnly: true,
    still: true,
  };

  return (
    <section className="stack sheet-card screen-card" aria-label={actor.name} data-kind={actor.kind}>
      <h2 className="head">{actor.name}</h2>
      {parts.map((p, i) =>
        p.kind === "rows" ? (
          <div key={i} className="sheet-rows">
            {p.rows.map(rowView)}
          </div>
        ) : (
          <SheetWidget key={i} model={p.model} env={env} />
        ),
      )}
    </section>
  );
}
