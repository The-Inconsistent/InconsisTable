"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, ActionResult, Actor, BookSource, DealtRow, RollRow } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { TableLookup } from "@/components/gm/track/components/tables-panel/components/table-lookup/table-lookup";
import { tableCardId } from "@/components/gm/track/constants";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { isLookupTable, targetsOf, typedOf } from "@/lib/lookup/lookup";

type TablesPanelProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  rolls: readonly RollRow[];
  dealt: readonly DealtRow[];
  actors: readonly Actor[];
  /** The fight's combatants' actors, in its order: a lookup's targets list them first. */
  fighting: readonly string[];
  /** Whether a GM runs the room: without one a `gm` table keeps nothing from anyone, so it is not used. */
  hasGm: boolean;
  campaign: Readonly<Record<string, unknown>>;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** Sends one action and answers with the server's reply; the tracker shows a refusal itself. */
  ask: (a: ActionInput) => Promise<ActionResult>;
};

// The ruleset's random tables, at hand on TRACK (house decision #49). Roll shows what came up, big; Deal gives each
// ticked character one card from the table's deck, never the same card twice; Reshuffle takes the cards back and asks
// first, because nobody can undo a deal. The app rolls and deals only here (CLAUDE.md, principle 5). Any table with a
// die also takes the number the GM rolled (I ROLLED), and a lookup applies its line to the target picked at the top,
// which stays picked when a line sends the GM on to another table (house decision #87).
export function TablesPanel(props: TablesPanelProps) {
  const { ruleset, compiled, rolls, dealt, actors, fighting, hasGm, campaign, books, requestPage, ask } = props;
  const t = useTranslations("tables");
  const [dealing, setDealing] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [reshuffling, setReshuffling] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [targetId, setTargetId] = useState("");
  // The chain so far (house decision #88): each table the GM stepped through and the line that sent them on.
  const [trail, setTrail] = useState<readonly { title: string; label: string }[]>([]);
  const characters = actors.filter((a) => a.kind === "pc" || a.kind === "companion");
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const list = Object.entries(ruleset.tables ?? {});
  if (list.length === 0) return null;
  const run = async (a: ActionInput) => (await ask(a)).ok;
  const lookups = compiled !== null && list.some(([, x]) => isLookupTable(x));
  const targets = targetsOf({ actors, fighting });
  const target = actors.find((a) => a.id === targetId);

  // DEAL: opens the picker with everyone who holds no card of the table ticked.
  const handleOpenDeal = (id: string) => {
    const holding = new Set(dealt.filter((d) => d.tableId === id).map((d) => d.actorId));
    setPicked(characters.filter((c) => !holding.has(c.id)).map((c) => c.id));
    setDealing(id);
    setReshuffling(null);
  };
  const handleTick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const handleDeal = (id: string) => async (e: FormEvent) => {
    e.preventDefault();
    if (picked.length === 0) return;
    if (await run({ type: "table.deal", tableId: id, actorIds: [...picked] })) setDealing(null);
  };

  // RESHUFFLE: the first tap asks, the second takes every card of the table back.
  const handleReshuffle = async (id: string) => {
    if (reshuffling !== id) return setReshuffling(id);
    setReshuffling(null);
    await run({ type: "table.reshuffle", tableId: id });
  };

  // I ROLLED: logs the number the GM's own dice showed on a plain table, and clears it once it lands.
  const handleTyped = (id: string) => async (e: FormEvent) => {
    e.preventDefault();
    const result = typedOf(typed[id] ?? "");
    if (result === null) return;
    if (await run({ type: "table.roll", tableId: id, result })) setTyped((was) => ({ ...was, [id]: "" }));
  };

  // NEXT: a line names another table; its card comes into view with the same target, the step joins the trail, and
  // nothing is rolled or granted.
  const handleNext = (id: string, from: { title: string; label: string }) => {
    setTrail((was) => [...was, from]);
    const card = document.getElementById(tableCardId(id));
    card?.scrollIntoView({ behavior: "smooth", block: "start" });
    card?.querySelector("input")?.focus({ preventScroll: true });
  };

  // PICK: another target starts a new chain.
  const handleTarget = (id: string) => {
    setTargetId(id);
    setTrail([]);
  };

  return (
    <section className="stack tables-panel" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      {lookups && (
        <label className="row table-target">
          <span>{t("target")}</span>
          <select className="input" value={targetId} onChange={(e) => handleTarget(e.target.value)}>
            <option value="">{t("pickTarget")}</option>
            {targets.fighting.length > 0 && (
              <optgroup label={t("fighting")}>
                {targets.fighting.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t("others")}>
              {targets.others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      {trail.length > 0 && (
        <div className="row table-trail">
          <ol className="row" aria-label={t("trail")}>
            {trail.map((s, i) => (
              <li key={i}>{t("trailStep", s)}</li>
            ))}
          </ol>
          <button className="btn sm" onClick={() => setTrail([])}>
            {t("trailClear")}
          </button>
        </div>
      )}
      <ul className="table-list rise-list">
        {list.map(([id, table], i) => {
          const last = rolls.find((r) => r.tableId === id);
          const held = dealt.filter((d) => d.tableId === id);
          const usable = hasGm || table.visibility !== "gm";
          const lookup = compiled !== null && isLookupTable(table);
          return (
            <li
              key={id}
              id={tableCardId(id)}
              tabIndex={-1}
              className="card table-card"
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className="row table-head">
                <h3 className="head">{table.title}</h3>
                <span className="chip">{t(table.visibility)}</span>
                {table.die && <span className="dim">{table.die}</span>}
              </div>
              {!usable ? (
                <p className="dim" role="status">
                  {t("noGm")}
                </p>
              ) : lookup ? (
                <TableLookup
                  {...{ tableId: id, table, compiled, ruleset, target, campaign, books, requestPage, ask }}
                  characters={characters.length}
                  onNext={handleNext}
                  onApplied={() => setTrail([])}
                />
              ) : (
                <>
                  <div className="row">
                    {table.visibility !== "owner" && (
                      <button className="btn primary" onClick={() => run({ type: "table.roll", tableId: id })}>
                        {t("roll")}
                      </button>
                    )}
                    <button
                      className="btn"
                      aria-expanded={dealing === id}
                      disabled={characters.length === 0}
                      onClick={() => (dealing === id ? setDealing(null) : handleOpenDeal(id))}
                    >
                      {t("deal")}
                    </button>
                  </div>
                  {table.die && table.visibility !== "owner" && (
                    <form className="row" onSubmit={handleTyped(id)}>
                      <input
                        className="input table-typed"
                        inputMode="numeric"
                        value={typed[id] ?? ""}
                        onChange={(e) => setTyped((was) => ({ ...was, [id]: e.target.value }))}
                        aria-label={t("typedLabel", { title: table.title })}
                        placeholder={t("typed")}
                      />
                      <button className="btn" disabled={typedOf(typed[id] ?? "") === null}>
                        {t("logTyped")}
                      </button>
                    </form>
                  )}
                  {dealing === id && (
                    <form className="stack table-deal" onSubmit={handleDeal(id)}>
                      <fieldset className="stack table-pick">
                        <legend>{t("dealTo")}</legend>
                        {characters.map((c) => (
                          <label key={c.id} className="row">
                            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => handleTick(c.id)} />
                            <span>{c.name}</span>
                          </label>
                        ))}
                      </fieldset>
                      <div className="row">
                        <button className="btn primary" disabled={picked.length === 0}>
                          {t("dealCount", { count: picked.length })}
                        </button>
                        <button type="button" className="btn" onClick={() => setDealing(null)}>
                          {t("cancel")}
                        </button>
                      </div>
                    </form>
                  )}
                  {held.length > 0 && (
                    <ul className="table-held">
                      {held.map((d) => (
                        <li key={d.actorId} className="table-held-card">
                          <span>{names.get(d.actorId) ?? t("aCharacter")}</span>
                          <strong>{d.label}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  {reshuffling === id ? (
                    <div className="stack">
                      <span role="alert">{t("reshuffleConfirm", { title: table.title })}</span>
                      <div className="row">
                        <button className="btn sm" onClick={() => handleReshuffle(id)}>
                          {t("reshuffleYes")}
                        </button>
                        <button className="btn sm" onClick={() => setReshuffling(null)}>
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn sm" onClick={() => handleReshuffle(id)}>
                      {t("reshuffle")}
                    </button>
                  )}
                </>
              )}
              {last && (
                <output className="table-result" key={last.id}>
                  <span className="table-face">{last.label}</span>
                  <span className="dim">{t("rolled", { value: last.value })}</span>
                </output>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
