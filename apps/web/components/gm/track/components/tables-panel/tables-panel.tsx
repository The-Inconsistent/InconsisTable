"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type {
  ActionInput,
  ActionResult,
  Actor,
  BookSource,
  DealtRow,
  PoolState,
  RollRow,
} from "@inconsistable/core-schema";
import { isDeck, type CompiledRuleset, type RandomTable, type Ruleset } from "@inconsistable/rules-engine";

import { TableLookup } from "@/components/gm/track/components/table-lookup/table-lookup";
import type { OpenedTable } from "@/components/gm/track/constants";
import { Cite } from "@/components/ui/cite/cite";
import { ConfirmButton } from "@/components/ui/confirm-button/confirm-button";
import { SideDrawer } from "@/components/ui/side-drawer/side-drawer";
import { TableTrail, type TrailStep } from "@/components/ui/table-trail/table-trail";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { isLookupTable, targetsOf, typedOf } from "@/lib/lookup/lookup";

type TablesPanelProps = {
  campaignId: string;
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  /** The tables TRACK lists (house decision #225, `trackTables`); any table of the ruleset still opens in the drawer. */
  listed: readonly [string, RandomTable][];
  rolls: readonly RollRow[];
  dealt: readonly DealtRow[];
  actors: readonly Actor[];
  /** The fight's combatants' actors, in its order: a lookup's targets list them first. */
  fighting: readonly string[];
  /** Whether a GM runs the room: without one a `gm` table keeps nothing from anyone, so it is not used. */
  hasGm: boolean;
  campaign: Readonly<Record<string, unknown>>;
  /** The shared pools as this seat holds them, which a stepper's max may read (house decision #192). */
  pools: readonly Pick<PoolState, "id" | "value">[];
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** Sends one action and answers with the server's reply; the tracker shows a refusal itself. */
  ask: (a: ActionInput) => Promise<ActionResult>;
  /** The table a spend opened last (house decision #91): its drawer opens, its actor the target, its inputs the table's. */
  opened: OpenedTable | null;
};

// The ruleset's random tables on TRACK (house decisions #49, #225): one row per listed table, and one drawer for the
// table tapped. Roll shows what came up, big; any table with a die also takes the number the GM rolled (I ROLLED). A deck
// (house decision #224) deals each ticked character one card, never the same card twice, and Reshuffle takes the cards
// back on a second tap, because nobody can undo a deal. The app rolls and deals only here (CLAUDE.md, principle 5). A
// lookup applies its line to the target picked in the drawer, which stays picked when a line sends the GM on to another
// table (house decision #87).
export function TablesPanel(props: TablesPanelProps) {
  const {
    campaignId,
    ruleset,
    compiled,
    listed,
    rolls,
    dealt,
    actors,
    fighting,
    hasGm,
    campaign,
    pools,
    books,
    requestPage,
    ask,
    opened,
  } = props;
  const t = useTranslations("tables");
  const tSheet = useTranslations("bottomSheet");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dealing, setDealing] = useState(false);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState("");
  const [targetId, setTargetId] = useState("");
  // The chain so far (house decision #88): each table the GM stepped through and the line that sent them on.
  const [trail, setTrail] = useState<readonly TrailStep[]>([]);
  // A spend's OPEN <table> opens its drawer, picks its actor as the target and starts a new chain, as PICK does.
  const [openedSeen, setOpenedSeen] = useState(opened);
  if (opened !== openedSeen) {
    setOpenedSeen(opened);
    if (opened !== null) {
      setOpenId(opened.tableId);
      setDealing(false);
      setTyped("");
      setTargetId(opened.actorId);
      setTrail([]);
    }
  }
  const characters = actors.filter((a) => a.kind === "pc" || a.kind === "companion");
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const run = async (a: ActionInput) => (await ask(a)).ok;
  const targets = targetsOf({ actors, fighting });
  const target = actors.find((a) => a.id === targetId);
  const table = openId === null ? undefined : ruleset.tables?.[openId];

  // OPEN: a row's tap opens its table in the drawer, with nothing typed or ticked yet and a new chain.
  const handleOpen = (id: string) => {
    setOpenId(id);
    setDealing(false);
    setTyped("");
    setTrail([]);
  };

  // DEAL: opens the picker with everyone who holds no card of the table ticked.
  const handleOpenDeal = (id: string) => {
    const holding = new Set(dealt.filter((d) => d.tableId === id).map((d) => d.actorId));
    setPicked(characters.filter((c) => !holding.has(c.id)).map((c) => c.id));
    setDealing(true);
  };
  const handleTick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const handleDeal = (id: string) => async (e: FormEvent) => {
    e.preventDefault();
    if (picked.length === 0) return;
    if (await run({ type: "table.deal", tableId: id, actorIds: [...picked] })) setDealing(false);
  };

  // I ROLLED: logs the number the GM's own dice showed on a plain table, and clears it once it lands.
  const handleTyped = (id: string) => async (e: FormEvent) => {
    e.preventDefault();
    const result = typedOf(typed);
    if (result === null) return;
    if (await run({ type: "table.roll", tableId: id, result })) setTyped("");
  };

  // NEXT: a line names another table; the drawer turns to it with the same target, the step joins the trail, and
  // nothing is rolled or granted.
  const handleNext = (id: string, from: { title: string; label: string }) => {
    setTrail((was) => [...was, from]);
    setOpenId(id);
    setDealing(false);
    setTyped("");
  };

  // PICK: another target starts a new chain.
  const handleTarget = (id: string) => {
    setTargetId(id);
    setTrail([]);
  };

  // The open table's drawer: what it is, then its use, top to bottom.
  const drawerOf = (id: string, x: RandomTable) => {
    const tableRolls = rolls.filter((r) => r.tableId === id);
    const [last, ...earlier] = tableRolls;
    const held = dealt.filter((d) => d.tableId === id);
    const usable = hasGm || x.visibility !== "gm";
    const lookup = compiled !== null && isLookupTable(x);
    const rolled = x.visibility !== "owner";
    return (
      <SideDrawer
        label={x.title}
        closeLabel={tSheet("closeLabel", { title: x.title })}
        onClose={() => setOpenId(null)}
        head={
          <>
            <h2 className="head">{x.title}</h2>
            <p className="small">
              {[x.die, t(x.visibility)].filter(Boolean).join(" · ")}
              {x.cite && (
                <>
                  {" · "}
                  <Cite cite={x.cite} ruleset={ruleset} books={books} requestPage={requestPage} />
                </>
              )}
            </p>
          </>
        }
      >
        <div className="side-drawer-body stack">
          {!usable ? (
            <p className="dim" role="status">
              {t("noGm")}
            </p>
          ) : lookup ? (
            <>
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
              <TableTrail steps={trail} onClear={() => setTrail([])} />
              <TableLookup
                // Opened by a spend, the lookup starts again from the spend's inputs.
                key={`${id}-${opened?.tableId === id ? opened.n : 0}`}
                start={opened?.tableId === id ? opened.inputs : undefined}
                {...{
                  campaignId,
                  tableId: id,
                  table: x,
                  compiled,
                  ruleset,
                  target,
                  campaign,
                  pools,
                  books,
                  requestPage,
                  ask,
                }}
                characters={characters.length}
                onNext={handleNext}
                onApplied={() => setTrail([])}
              />
            </>
          ) : (
            rolled && (
              <>
                <button className="btn primary table-roll" onClick={() => run({ type: "table.roll", tableId: id })}>
                  {t("roll")}
                </button>
                {x.die && (
                  <form className="row table-typed-line" onSubmit={handleTyped(id)}>
                    <span className="dim">{t("orTyped")}</span>
                    <input
                      className="input table-typed"
                      inputMode="numeric"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      aria-label={t("typedLabel", { title: x.title })}
                    />
                    <button className="btn" disabled={typedOf(typed) === null}>
                      {t("logTyped")}
                    </button>
                  </form>
                )}
              </>
            )
          )}
          {last && (
            <output className="table-result" key={last.id}>
              <span className="table-face">{last.label}</span>
              <span className="dim">{t("rolled", { value: last.value })}</span>
            </output>
          )}
          {earlier.length > 0 && (
            <ul className="list table-recent" aria-label={t("recentRolls")}>
              {earlier.map((r) => (
                <li key={r.id}>
                  <span>{r.label}</span>
                  <span className="dim">{t("rolled", { value: r.value })}</span>
                </li>
              ))}
            </ul>
          )}
          {usable && isDeck(x) && (
            <div className="row">
              <button
                className="btn"
                aria-expanded={dealing}
                disabled={characters.length === 0}
                onClick={() => (dealing ? setDealing(false) : handleOpenDeal(id))}
              >
                {t("deal")}
              </button>
              <ConfirmButton
                label={t("reshuffle")}
                ariaLabel={t("reshuffleLabel", { title: x.title })}
                onConfirm={() => void run({ type: "table.reshuffle", tableId: id })}
              />
            </div>
          )}
          {usable && isDeck(x) && dealing && (
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
                <button type="button" className="btn" onClick={() => setDealing(false)}>
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
        </div>
      </SideDrawer>
    );
  };

  return (
    <>
      {listed.length > 0 && (
        <section className="stack tables-panel" aria-label={t("title")}>
          <h2 className="head">{t("heading", { count: listed.length })}</h2>
          <ul className="list">
            {listed.map(([id, x]) => (
              <li key={id}>
                <button className="btn codex-row" aria-expanded={openId === id} onClick={() => handleOpen(id)}>
                  <span className="codex-row-text">
                    <span className="codex-row-title">{x.title}</span>
                    <span className="codex-row-meta">
                      {x.die && <span className="dim">{x.die}</span>}
                      <span className="chip">{t(x.visibility)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {openId !== null && table && drawerOf(openId, table)}
    </>
  );
}
