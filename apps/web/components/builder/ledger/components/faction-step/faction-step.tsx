"use client";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import { Cite } from "@/components/ui/cite/cite";
import {
  backgroundRows,
  factionOffers,
  offered,
  pickBackgroundBonus,
  pickBackgroundRow,
  pickBackgroundTable,
  reachOf,
  recordCite,
  setAdvancedFaction,
  setFill,
  toggleOption,
  writeInKeyword,
} from "@/lib/ledger/ledger";

import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList } from "../record-list/record-list";
import { StepIssues } from "../step-issues/step-issues";

// FACTION: what fills each [PLACEHOLDER] keyword, the Background (one row per column and which bonus applies) and the
// option groups this character's faction, species or sub-factions own. Advanced Creation picks its optional faction
// here first.
export function FactionStep() {
  const t = useTranslations("ledgerBuilder.faction");
  const state = useLedger();
  const { params, catalogue, lookups, build, resolved, edit } = state;
  const rowOf = useRowOf();
  if (!resolved) return <p className="dim">{t("archetypeFirst")}</p>;
  const { placeholders, tables, groups } = factionOffers({ params, catalogue, lookups, build, resolved });
  const factionId = build.advanced?.factionId;
  const factions = catalogue.creation.factions
    .filter((f) => offered({ params, catalogue, source: f.source, taken: f.id === factionId }))
    .map((f) => rowOf({ record: f, taken: f.id === factionId, extra: f.keywords }));

  // Advanced Creation: a faction, or none (a second tap on the one taken).
  const handleFaction = (id: string) =>
    edit(setAdvancedFaction({ build, params, lookups, factionId: id === factionId ? undefined : id }));

  return (
    <div className="stack">
      <StepIssues step="faction" />
      {build.advanced && (
        <section className="stack" aria-labelledby="lb-adv-faction">
          <h3 id="lb-adv-faction" className="lb-sub">
            {t("faction")}
          </h3>
          <p className="small dim">{t("factionNote")}</p>
          <RecordList label={t("faction")} rows={factions} onPick={handleFaction} />
        </section>
      )}

      {placeholders.map((p) => (
        <Placeholder key={p.keyword} {...p} />
      ))}

      <section className="stack" aria-labelledby="lb-background">
        <h3 id="lb-background" className="lb-sub">
          {t("background")}
          <span className="small dim">
            {" "}
            · <Cite cite={params.cites.background} />
          </span>
        </h3>
        {tables.length === 0 ? (
          <p className="dim">{t("noTables")}</p>
        ) : (
          <div className="row" role="group" aria-label={t("tables")}>
            {tables.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className="btn"
                aria-pressed={build.background?.tableId === tb.id}
                onClick={() => edit(pickBackgroundTable({ build, tableId: tb.id }))}
              >
                {tb.name}
              </button>
            ))}
          </div>
        )}
        <BackgroundRows />
      </section>

      {groups.map((g) => {
        const taken = (build.options ?? []).filter((o) => o.groupId === g.id);
        return (
          <fieldset key={g.id} className="stack lb-group">
            <legend className="lb-sub">{g.name}</legend>
            <p className="small dim">
              {[
                recordCite(params, g),
                g.pick === "tier" ? t("pickTier") : g.pick === "any" ? t("pickAny") : t("pickN", { count: g.pick }),
                t("prices", { list: g.xp.join(" / ") }),
              ].join(" · ")}
            </p>
            {g.summary && <p className="small">{g.summary}</p>}
            <ul className="list lb-rows">
              {g.options.map((o) => {
                const on = taken.some((x) => x.name === o.name);
                const reach = reachOf({ requires: o.requires, who: resolved.who, ctx: state.ctx });
                const why = [...(o.notAtCreation ? [t("notAtCreation")] : []), ...reach.unmet, ...reach.gm];
                return (
                  <li key={o.name}>
                    <button
                      type="button"
                      className="found lb-row"
                      aria-pressed={on}
                      onClick={() => edit(toggleOption({ build, groupId: g.id, name: o.name }))}
                    >
                      <span className="lb-row-text">
                        <span className="pick-name">{o.name}</span>
                        {o.summary && <span className="small">{o.summary}</span>}
                        {why.length > 0 && <span className="small lb-why">{why.join("; ")}</span>}
                      </span>
                      <span className="small lb-row-state">{on ? t("taken") : t("take")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

type PlaceholderProps = ReturnType<typeof factionOffers>["placeholders"][number];

// One [PLACEHOLDER] keyword: a sub-faction of its type, or a name written in where the keyword allows one.
function Placeholder({ keyword, record, subFactions, writeIn, fill }: PlaceholderProps) {
  const t = useTranslations("ledgerBuilder.faction");
  const { params, build, edit } = useLedger();
  const filledId = fill && "id" in fill ? fill.id : undefined;
  const written = fill && "writeIn" in fill ? fill.writeIn : "";
  const inputId = `lb-fill-${keyword.replace(/[^A-Za-z0-9]/g, "")}`;

  // A sub-faction fills the keyword; a second tap on it empties it again.
  const handlePick = (id: string) => edit(setFill({ build, keyword, fill: id === filledId ? null : { id } }));
  // A written-in name fills it; an empty field empties it.
  const handleWrite = (e: ChangeEvent<HTMLInputElement>) => {
    const name = writeInKeyword(e.target.value);
    edit(setFill({ build, keyword, fill: name ? { writeIn: name } : null }));
  };

  return (
    <fieldset className="stack lb-group">
      <legend className="lb-sub">{keyword}</legend>
      <p className="small dim">{record ? recordCite(params, record) : params.keywords.placeholderCite}</p>
      {subFactions.length > 0 && (
        <ul className="list lb-rows">
          {subFactions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="found lb-row"
                aria-pressed={s.id === filledId}
                onClick={() => handlePick(s.id)}
              >
                <span className="lb-row-text">
                  <span className="pick-name">{s.name}</span>
                  <span className="small dim">{[recordCite(params, s), s.keyword].join(" · ")}</span>
                  {s.summary && <span className="small">{s.summary}</span>}
                </span>
                <span className="small lb-row-state">{s.id === filledId ? t("taken") : t("take")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {writeIn && (
        <label htmlFor={inputId} className="stack lb-field">
          <span>{t("writeIn")}</span>
          <input id={inputId} type="text" value={written} onChange={handleWrite} maxLength={60} autoComplete="off" />
        </label>
      )}
    </fieldset>
  );
}

// The chosen Background table: one row per column, then which column's bonus applies.
function BackgroundRows() {
  const t = useTranslations("ledgerBuilder.faction");
  const { params, lookups, build, edit } = useLedger();
  const bg = build.background;
  const table = bg ? lookups.backgrounds.get(bg.tableId) : undefined;
  if (!bg || !table) return null;
  const columns = params.vocabulary.backgroundRows.filter((row) => backgroundRows(table, row).length > 0);
  const bonusName = (key: string | undefined) =>
    key ? (params.vocabulary.mods.find((m) => m.key === key)?.label ?? key) : undefined;
  return (
    <div className="stack">
      <p className="small dim">{recordCite(params, table)}</p>
      {columns.map((row) => (
        <fieldset key={row} className="stack lb-group">
          <legend className="pick-name">{row}</legend>
          {backgroundRows(table, row).map((r) => (
            <label key={r.name} className="pick">
              <input
                type="radio"
                name={`lb-bg-${row}`}
                checked={bg[row] === r.name}
                onChange={() => edit(pickBackgroundRow({ build, row, name: r.name }))}
              />
              <span className="lb-row-text">
                <span className="pick-name">{r.name}</span>
                {r.bonus && (
                  <span className="small dim">
                    {t("bonus", { amount: params.background.bonusAmount, what: bonusName(r.bonus) ?? "" })}
                  </span>
                )}
                {r.summary && <span className="small">{r.summary}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      <fieldset className="stack lb-group">
        <legend className="pick-name">{t("whichBonus")}</legend>
        <p className="small dim">
          <Cite cite={params.cites.backgroundBonus} />
        </p>
        {columns.map((row) => (
          <label key={row} className="pick">
            <input
              type="radio"
              name="lb-bg-bonus"
              checked={bg.bonus === row}
              onChange={() => edit(pickBackgroundBonus({ build, row }))}
            />
            <span className="pick-name">{row}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
