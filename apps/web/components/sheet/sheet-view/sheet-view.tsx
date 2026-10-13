"use client";
import { useMemo, useState } from "react";

import type { Actor, BookSource } from "@inconsistable/core-schema";
import { breakdownOf, compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { Breakdown } from "@/components/sheet/components/breakdown/breakdown";
import { Cite } from "@/components/ui/cite/cite";
import { ResourceRow } from "@/components/ui/resource-row/resource-row";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import {
  adjustAction,
  DURATION_WORDS,
  printValue,
  rangeOf,
  RESET_WORDS,
  resetsOn,
  restsOf,
  sectionsOf,
  stepsOf,
  type SheetRow,
} from "@/lib/sheet/sheet";

type SheetViewProps = {
  actor: Actor;
  ruleset: Ruleset;
  /** Player characters at the table: the `party.characters` the formulas read. */
  characters: number;
  /** The GM's seat steps every resource and calls rests; a player's by the resource's `editableBy`. */
  gm: boolean;
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// SHEET: one character as the ruleset's layout lays it out. Every value is the server's, already cut down to what this
// seat may see; the only thing worked out here is the Breakdown of a number, from the same manifest.
export function SheetView({ actor, ruleset, characters, gm, send, books, requestPage }: SheetViewProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compiled = useMemo(() => {
    const c = compileRuleset(ruleset);
    return c.ok ? c.compiled : null;
  }, [ruleset]);
  const sections = sectionsOf({ ruleset, actor });
  const conditions = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id) ?? []);
  const rests = restsOf(ruleset);

  // ± on a resource: a delta the server clamps.
  const handleStep = async ({ resource, delta }: { resource: string; delta: number }) => {
    const r = await send(adjustAction({ actorId: actor.id, resource, delta }));
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
      return (
        <ResourceRow
          key={`r-${row.id}`}
          label={row.label}
          value={actor.resources[row.id] ?? 0}
          range={compiled ? rangeOf({ compiled, resource: row.id, actor, characters }) : null}
          steps={stepsOf({ ruleset, resource: row.id, gm })}
          holder={actor.name}
          note={
            <span className="row small dim" style={{ gap: 6 }}>
              {resets.length > 0 && <span>Refills: {resets.map((e) => RESET_WORDS[e]).join(", ")}</span>}
              {cite}
            </span>
          }
          onStep={(delta) => handleStep({ resource: row.id, delta })}
        />
      );
    }
    if (row.kind === "derived")
      return (
        <div key={`d-${row.id}`} className="sheet-row">
          <button
            className="sheet-derived"
            aria-label={`${row.label} ${actor.derived[row.id]}: show where it comes from`}
            onClick={() => setOpen(row.id)}
          >
            <span>{row.label}</span>
            <strong className="sheet-num">{actor.derived[row.id]}</strong>
          </button>
        </div>
      );
    return (
      <div key={`f-${row.id}`} className="sheet-row">
        <span className="stack" style={{ gap: 2 }}>
          <span>{row.label}</span>
          {cite}
        </span>
        <strong className="sheet-num sheet-text">{printValue(actor.fields[row.id])}</strong>
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
    <div className="stack" style={{ gap: 20 }}>
      {gm && rests.length > 0 && (
        <div className="row">
          {rests.map((b) => (
            <button
              key={b.event}
              className="btn"
              aria-label={`${b.label} for ${actor.name}`}
              onClick={() => handleRest(b.event)}
            >
              {b.label}
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
        <section key={s.id} className="stack">
          <h2 className="head">{s.label}</h2>
          <div className="sheet-rows">{s.rows.map(rowView)}</div>
        </section>
      ))}
      {sections.length === 0 && <p className="dim">The ruleset has nothing to show for this character yet.</p>}
      <section className="stack">
        <h2 className="head">Conditions</h2>
        {conditions.length === 0 ? (
          <p className="dim">None.</p>
        ) : (
          <ul className="list">
            {conditions.map((c) => (
              <li key={c.id}>
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{c.label}</strong>
                  <span className="small dim">{DURATION_WORDS[c.duration]}</span>
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
