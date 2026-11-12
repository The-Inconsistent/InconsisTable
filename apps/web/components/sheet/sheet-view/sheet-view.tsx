"use client";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";

import type { Actor, BookSource, SpendRequest } from "@inconsistable/core-schema";
import { breakdownOf, compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { Breakdown } from "@/components/sheet/components/breakdown/breakdown";
import { SpendAsk } from "@/components/sheet/components/spend-ask/spend-ask";
import { Cite } from "@/components/ui/cite/cite";
import { ResourceRow } from "@/components/ui/resource-row/resource-row";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { pendingFor } from "@/lib/spend-request/spend-request";
import {
  canAskToSpend,
  stepAction,
  printValue,
  rangeOf,
  resetsOn,
  restsOf,
  sectionsOf,
  stepsOf,
  timeLeft,
  type SheetRow,
} from "@/lib/sheet/sheet";

type SheetViewProps = {
  actor: Actor;
  ruleset: Ruleset;
  /** Player characters at the table: the `party.characters` the formulas read. */
  characters: number;
  /** The GM's seat steps every resource and calls rests; a player's by the resource's `editableBy`. */
  gm: boolean;
  /** This seat's pending spend requests (a player's phone); the GM's seat asks for nothing. */
  requests?: readonly SpendRequest[];
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// SHEET: one character as the ruleset's layout lays it out. Every value is the server's, already cut down to what this
// seat may see; the only thing worked out here is the Breakdown of a number, from the same manifest.
export function SheetView({ actor, ruleset, characters, gm, requests = [], send, books, requestPage }: SheetViewProps) {
  const t = useTranslations("sheet");
  const tDuration = useTranslations("duration");
  const tReset = useTranslations("resetEvent");
  const tRest = useTranslations("rest");
  const format = useFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compiled = useMemo(() => {
    const c = compileRuleset(ruleset);
    return c.ok ? c.compiled : null;
  }, [ruleset]);
  const sections = sectionsOf({ ruleset, actor });
  const conditions = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id) ?? []);
  const rests = restsOf(ruleset);

  // What is left of a condition's count ("2 rounds left"), or "" when it has none.
  const leftText = (id: string) => {
    const left = timeLeft({ timers: actor.conditionTimers, id });
    return left ? t(left.unit === "turn" ? "turnsLeft" : "roundsLeft", { count: left.count }) : "";
  };

  // ± on a resource: a delta the server clamps.
  const handleStep = async ({ resource, delta }: { resource: string; delta: number }) => {
    const r = await send(stepAction({ ruleset, actorId: actor.id, resource, delta }));
    setError(r.ok ? null : r.error);
  };
  // SHORT REST / LONG REST: the GM resets this character's resources the manifest says refill then.
  const handleRest = async (event: string) => {
    const r = await send({ type: "actor.rest", event, actorId: actor.id });
    setError(r.ok ? null : r.error);
  };

  const rowView = (row: SheetRow) => {
    const cite = row.cite && <Cite cite={row.cite} {...{ ruleset, books, requestPage }} />;
    if (row.kind === "resource") {
      const resets = resetsOn({ ruleset, resource: row.id });
      const ask = !gm && canAskToSpend({ ruleset, resource: row.id });
      return (
        <Fragment key={`r-${row.id}`}>
          <ResourceRow
            stat={row.id}
            label={row.label}
            value={actor.resources[row.id] ?? 0}
            range={compiled ? rangeOf({ compiled, resource: row.id, actor, characters }) : null}
            steps={stepsOf({ ruleset, resource: row.id, gm })}
            holder={actor.name}
            note={
              <span className="row small dim" style={{ gap: 6 }}>
                {resets.length > 0 && (
                  <span>{t("refills", { events: format.list(resets.map((e) => tReset(e))) })}</span>
                )}
                {cite}
              </span>
            }
            onStep={(delta) => handleStep({ resource: row.id, delta })}
          />
          {ask && (
            <SpendAsk
              actorId={actor.id}
              resourceId={row.id}
              label={row.label}
              pending={pendingFor({ requests, actorId: actor.id, resourceId: row.id })}
              send={send}
            />
          )}
        </Fragment>
      );
    }
    if (row.kind === "derived")
      return (
        <div key={`d-${row.id}`} className="sheet-row" data-stat={row.id} data-kind="derived">
          <button
            className="sheet-derived"
            aria-label={t("showWhere", { label: row.label, value: actor.derived[row.id] ?? 0 })}
            onClick={() => setOpen(row.id)}
          >
            <span className="stat-label">{row.label}</span>
            <strong className="sheet-num">{actor.derived[row.id]}</strong>
          </button>
        </div>
      );
    return (
      <div key={`f-${row.id}`} className="sheet-row" data-stat={row.id} data-kind="field">
        <span className="stack" style={{ gap: 2 }}>
          <span className="stat-label">{row.label}</span>
          {cite}
        </span>
        <strong className="sheet-num sheet-text">
          {printValue({ value: actor.fields[row.id], yes: t("yes"), no: t("no") })}
        </strong>
      </div>
    );
  };

  const opened = open ? sections.flatMap((s) => s.rows).find((r) => r.kind === "derived" && r.id === open) : undefined;
  const lines =
    opened && compiled
      ? breakdownOf({
          compiled,
          entity: actor.entity,
          derivedId: opened.id,
          values: {
            fields: actor.fields,
            resources: actor.resources,
            conditions: actor.conditions,
            party: { characters },
          },
          total: actor.derived[opened.id] ?? 0,
          viewer: { role: gm ? "gm" : "player", characterIds: [actor.id] },
          actorId: actor.id,
        })
      : null;

  return (
    <div className="stack sheet">
      {gm && rests.length > 0 && (
        <div className="row">
          {rests.map((b) => (
            <button
              key={b.event}
              className="btn"
              aria-label={t("restFor", { rest: tRest(b.event), name: actor.name })}
              onClick={() => handleRest(b.event)}
            >
              {tRest(b.event)}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sections.map((s) => (
        <section key={s.id} className="stack sheet-card">
          <h2 className="head">{s.label ?? t(`section.${s.id as "derived" | "resources" | "fields"}`)}</h2>
          <div className="sheet-rows">{s.rows.map(rowView)}</div>
        </section>
      ))}
      {sections.length === 0 && <p className="dim">{t("nothing")}</p>}
      <section className="stack sheet-card">
        <h2 className="head">{t("conditions")}</h2>
        {conditions.length === 0 ? (
          <p className="dim">{t("none")}</p>
        ) : (
          <ul className="list">
            {conditions.map((c) => (
              <li key={c.id}>
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{c.label}</strong>
                  <span className="small dim">
                    {tDuration(c.duration)}
                    {leftText(c.id) && `, ${leftText(c.id)}`}
                  </span>
                  {c.cite && <Cite cite={c.cite} {...{ ruleset, books, requestPage }} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {opened && (
        <Breakdown
          label={opened.label}
          total={actor.derived[opened.id] ?? 0}
          lines={lines}
          cite={opened.cite}
          {...{ ruleset, books, requestPage }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
