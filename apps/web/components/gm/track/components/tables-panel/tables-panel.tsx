"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { Actor, DealtRow, RollRow } from "@inconsistable/core-schema";
import type { RandomTable } from "@inconsistable/rules-engine";

import type { Run } from "@/components/gm/track/constants";

type TablesPanelProps = {
  tables: Readonly<Record<string, RandomTable>>;
  rolls: readonly RollRow[];
  dealt: readonly DealtRow[];
  actors: readonly Actor[];
  /** Whether a GM runs the room: without one a `gm` table keeps nothing from anyone, so it is not used. */
  hasGm: boolean;
  run: Run;
};

// The ruleset's random tables, at hand on TRACK (house decision #49). Roll shows what came up, big; Deal gives each
// ticked character one card from the table's deck, never the same card twice; Reshuffle takes the cards back and asks
// first, because nobody can undo a deal. The app rolls and deals only here (CLAUDE.md, principle 5).
export function TablesPanel({ tables, rolls, dealt, actors, hasGm, run }: TablesPanelProps) {
  const t = useTranslations("tables");
  const [dealing, setDealing] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [reshuffling, setReshuffling] = useState<string | null>(null);
  const characters = actors.filter((a) => a.kind === "pc" || a.kind === "companion");
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const list = Object.entries(tables);
  if (list.length === 0) return null;

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

  return (
    <section className="stack tables-panel" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      <ul className="table-list rise-list">
        {list.map(([id, table], i) => {
          const last = rolls.find((r) => r.tableId === id);
          const held = dealt.filter((d) => d.tableId === id);
          const usable = hasGm || table.visibility !== "gm";
          return (
            <li key={id} className="card table-card" style={{ "--i": i } as React.CSSProperties}>
              <div className="row table-head">
                <h3 className="head">{table.title}</h3>
                <span className="chip">{t(table.visibility)}</span>
                {table.die && <span className="dim">{table.die}</span>}
              </div>
              {!usable ? (
                <p className="dim" role="status">
                  {t("noGm")}
                </p>
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
                  {last && (
                    <output className="table-result" key={last.id}>
                      <span className="table-face">{last.label}</span>
                      <span className="dim">{t("rolled", { value: last.value })}</span>
                    </output>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
