"use client";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";

import type { ActionInput, Actor, ActorItem, BookSource, LiveState, SpendRequest } from "@inconsistable/core-schema";
import { breakdownOf, campaignValues, compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { XpBox } from "@/components/builder/ledger/play/xp-box/xp-box";
import { Breakdown } from "@/components/sheet/components/breakdown/breakdown";
import { AcquireBox } from "@/components/sheet/components/acquire-box/acquire-box";
import { ItemsBox } from "@/components/sheet/components/items-box/items-box";
import { LedgerLines } from "@/components/sheet/components/ledger-lines/ledger-lines";
import { OverrideField } from "@/components/sheet/components/override-field/override-field";
import { SpendList } from "@/components/sheet/components/spend-ask/components/spend-list/spend-list";
import { SpendAsk } from "@/components/sheet/components/spend-ask/spend-ask";
import { SheetWidget } from "@/components/sheet/widgets/sheet-widget/sheet-widget";
import type { WidgetEnv } from "@/components/sheet/widgets/types";
import { Cite } from "@/components/ui/cite/cite";
import { HeldListEditor } from "@/components/ui/held-list/held-list";
import { ResourceRow } from "@/components/ui/resource-row/resource-row";
import { StrikeGuide } from "@/components/ui/strike-guide/strike-guide";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { heldLists } from "@/lib/held/held";
import { boxKinds, itemEntries } from "@/lib/items/items";
import { rankOf } from "@/lib/ledger/play";
import { xpEarnedOf } from "@/lib/ledger/table";
import { ledgerLaidOut } from "@/lib/sheet-widgets/sheet-widgets";
import { pendingFor, resourceLabels } from "@/lib/spend-request/spend-request";
import {
  canAskToSpend,
  stepAction,
  printValue,
  rangeOf,
  resetsOn,
  restsOf,
  sectionsOf,
  showJump,
  stepsOf,
  timeLeft,
  turnPartsOf,
  type SheetRow,
} from "@/lib/sheet/sheet";

type SheetViewProps = {
  actor: Actor;
  ruleset: Ruleset;
  /** Player characters at the table: the `party.characters` the formulas read. */
  characters: number;
  /** The campaign's values in play (`state.campaign.fields`); without it the manifest's defaults are read. */
  campaign?: Readonly<Record<string, number | string | boolean>>;
  /** The GM's seat steps every resource and calls rests; a player's by the resource's `editableBy`. */
  gm: boolean;
  /** This seat's pending spend requests (a player's phone); the GM's seat asks for nothing. */
  requests?: readonly SpendRequest[];
  /** The room's pools and fight, for the spends a player may ask for now (house decision #84); a player's phone only. */
  table?: Pick<LiveState, "pools" | "encounter" | "campaign" | "actors">;
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** This character's builder, for the seat that holds it or a GM-side seat; the XP box links there. */
  builderHref?: string | null;
  /** The room, for the GM's ADD BY HAND to search its packs (house decision #95). */
  campaignId?: string | null;
  /**
   * What it draws (house decision #114): `sheet`, the whole sheet; `turn`, only the layout's `phoneTurn` rows (the
   * phone's Fight tab on the seat's turn); `card`, the whole sheet read-only, with no step, ask or edit (a foe's card).
   */
  part?: "sheet" | "turn" | "card";
};

const NO_STEPS = { dec: false, inc: false };

// SHEET: one character as the ruleset's layout lays it out. Every value is the server's, already cut down to what this
// seat may see; the only thing worked out here is the Breakdown of a number, from the same manifest.
export function SheetView({
  actor,
  ruleset,
  characters,
  campaign,
  gm,
  requests = [],
  table,
  send,
  books,
  requestPage,
  builderHref = null,
  campaignId = null,
  part = "sheet",
}: SheetViewProps) {
  const readOnly = part === "card";
  const t = useTranslations("sheet");
  const tDuration = useTranslations("duration");
  const tReset = useTranslations("resetEvent");
  const tRest = useTranslations("rest");
  const tOptions = useTranslations("spawnOptions");
  const format = useFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compiled = useMemo(() => {
    const c = compileRuleset(ruleset);
    return c.ok ? c.compiled : null;
  }, [ruleset]);
  const inPlay = campaign ?? (compiled ? campaignValues({ compiled, stored: {} }) : undefined);
  const sections = sectionsOf({ ruleset, actor });
  // The spawn options it was spawned with, by their labels (house decision #92); the GM side is the one sent them.
  const spawnedWith = (actor.spawnOptions ?? []).map(
    (id) => ruleset.spawn?.options?.find((o) => o.id === id)?.label ?? id,
  );
  const conditions = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id) ?? []);
  const rests = restsOf(ruleset);
  // XP, for a seat that receives this character's ledger, when the ruleset keeps XP (house decision #64).
  const build = ruleset.build;
  const ledger = actor.ledger;
  const earned = xpEarnedOf({ ruleset, actor });

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
  // SEND on the strike guide (house decision #113): the strike for this character, refused or not by the server.
  const handleStrike = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r.ok;
  };
  // TAKE OFF: an item fitted to a line of the saved build comes loose (house decision #102).
  const handleTakeOff = async (x: ActorItem) => {
    const r = await send({ type: "item.fit", itemId: x.id, to: null });
    setError(r.ok ? null : r.error);
  };
  // SHORT REST / LONG REST: the GM resets this character's resources the manifest says refill then.
  const handleRest = async (event: string) => {
    const r = await send({ type: "actor.rest", event, actorId: actor.id });
    setError(r.ok ? null : r.error);
  };

  const range = (resource: string) =>
    compiled ? rangeOf({ compiled, resource, actor, characters, campaign: inPlay }) : null;

  const rowView = (row: SheetRow) => {
    const cite = row.cite && <Cite cite={row.cite} {...{ ruleset, books, requestPage }} />;
    if (row.kind === "resource") {
      const resets = resetsOn({ ruleset, resource: row.id });
      const ask = !gm && !readOnly && canAskToSpend({ ruleset, resource: row.id });
      return (
        <Fragment key={`r-${row.id}`}>
          <ResourceRow
            stat={row.id}
            label={row.label}
            value={actor.resources[row.id] ?? 0}
            range={range(row.id)}
            steps={readOnly ? NO_STEPS : stepsOf({ ruleset, resource: row.id, gm })}
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

  const env: WidgetEnv = {
    actor,
    ruleset,
    gm,
    readOnly,
    books,
    requestPage,
    send,
    rowView,
    range,
    onOpen: setOpen,
    onError: setError,
  };
  const models = sections.flatMap((s) => s.parts.flatMap((p) => (p.kind === "widget" ? [p.model] : [])));
  const anchor = (id: string) => `sheet-${actor.id}-${id}`;
  const jump = showJump(sections);
  const openedDef = open
    ? ruleset.entities.find((e) => e.id === actor.entity)?.derived.find((d) => d.id === open)
    : undefined;
  const opened = openedDef && { id: openedDef.id, label: openedDef.label, cite: openedDef.cite ?? null };
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
            // What the items it holds add, each named (house decision #95, #102).
            entries: itemEntries({ ruleset, items: actor.items ?? [] }),
            party: { characters },
            campaign: inPlay,
          },
          total: actor.derived[opened.id] ?? 0,
          // A foe's card is read as an actor the seat does not hold.
          viewer: { role: gm ? "gm" : "player", characterIds: readOnly ? [] : [actor.id] },
          actorId: actor.id,
        })
      : null;

  // The seat's turn on the Fight tab: the layout's `phoneTurn` rows, a strike as the guide and the spends as the list
  // the Sheet tab shows (house decision #114). A bar-only foe is offered as a target with the hint only (F63).
  if (part === "turn") {
    const encounter = table?.encounter ?? null;
    const unread = (encounter?.combatants ?? []).flatMap((c) =>
      table?.actors.some((a) => a.id === c.actorId) ? [] : [{ id: c.actorId, name: c.name }],
    );
    return (
      <div className="stack sheet">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {turnPartsOf({ ruleset, actor }).map((p, i) =>
          p.kind === "strike" ? (
            encounter &&
            table &&
            compiled && (
              <section key={i} className="stack sheet-card">
                <StrikeGuide
                  attacker={actor}
                  strikeId={p.strikeId}
                  fighting={encounter.combatants.flatMap((c) => table.actors.find((a) => a.id === c.actorId) ?? [])}
                  unread={unread}
                  campaignId={table.campaign.id}
                  campaign={table.campaign.fields}
                  phone={{ encounter, tableMode: table.campaign.tableMode }}
                  run={handleStrike}
                  {...{ ruleset, compiled, characters, books, requestPage }}
                />
              </section>
            )
          ) : p.kind === "spends" ? (
            table && (
              <SpendList
                key={i}
                labels={resourceLabels(ruleset)}
                {...{ ruleset, compiled, actor, table, characters, requests, send }}
              />
            )
          ) : p.kind === "rows" ? (
            <div key={i} className="sheet-rows">
              {p.rows.map(rowView)}
            </div>
          ) : (
            <SheetWidget key={i} model={p.model} env={env} />
          ),
        )}
      </div>
    );
  }

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
      {spawnedWith.length > 0 && (
        <p className="small" data-spawn-options="true">
          {tOptions("line", { list: format.list(spawnedWith) })}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {jump && (
        <nav className="sheet-jump" aria-label={t("jump")}>
          {sections.map((s) => (
            <a key={s.id} href={`#${anchor(s.id)}`}>
              {s.label ?? t(`section.${s.id as "derived" | "resources" | "fields"}`)}
            </a>
          ))}
        </nav>
      )}
      {sections.map((s) => (
        <section key={s.id} className="stack sheet-card" id={jump ? anchor(s.id) : undefined}>
          <h2 className="head">{s.label ?? t(`section.${s.id as "derived" | "resources" | "fields"}`)}</h2>
          {s.parts.map((p, i) =>
            p.kind === "rows" ? (
              <div key={i} className="sheet-rows">
                {p.rows.map(rowView)}
              </div>
            ) : (
              <SheetWidget key={i} model={p.model} env={env} />
            ),
          )}
        </section>
      ))}
      {sections.length === 0 && <p className="dim">{t("nothing")}</p>}
      {!gm && table && (
        <SpendList
          labels={resourceLabels(ruleset)}
          {...{ ruleset, compiled, actor, table, characters, requests, send }}
        />
      )}
      {!gm && table && <AcquireBox {...{ ruleset, compiled, actor, table, characters, requests, send }} />}
      {!gm && table && heldLists({ ruleset, actor }).some((l) => l.owner) && (
        <section className="stack sheet-card">
          <HeldListEditor ruleset={ruleset} actor={actor} campaignId={table.campaign.id} gm={false} send={send} />
        </section>
      )}
      <LedgerLines
        sheet={actor.ledger?.sheet}
        skip={ledgerLaidOut(models)}
        items={actor.items ?? []}
        onTakeOff={handleTakeOff}
        {...{ ruleset, books, requestPage }}
      />
      {actor.items !== undefined && (
        <ItemsBox env={env} kinds={boxKinds({ ruleset, drawn: ledgerLaidOut(models) })} campaignId={campaignId} />
      )}
      {build?.xp && ledger && (
        <XpBox
          earned={earned}
          spent={ledger.xpSpent}
          rank={rankOf({ earned, ...build.params.rank })}
          built={ledger.build !== null}
          href={builderHref}
        />
      )}

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
        >
          {gm && openedDef?.override && (
            <OverrideField
              key={openedDef.id}
              actor={actor}
              label={openedDef.label}
              field={openedDef.override}
              send={send}
              onError={setError}
            />
          )}
        </Breakdown>
      )}
    </div>
  );
}
