"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import {
  gearName,
  setGmMod,
  setGmSpecies,
  toggleGmGearAdd,
  toggleGmGearRemove,
  toggleGmKeyword,
  writeInKeyword,
  type LedgerBuild,
} from "@/lib/ledger/ledger";

import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList } from "../record-list/record-list";

// The GM's part of the build: rulings no book makes on this character (a species, keywords, gear taken away or given,
// Trait bonuses) and the ticks already given, which can be taken back all at once. A GM-side seat only.
export function GmRulings() {
  const t = useTranslations("ledgerBuilder.gm");
  const { params, catalogue, build, resolved, edit } = useLedger();
  const rowOf = useRowOf();
  const [keyword, setKeyword] = useState("");
  const gm = build.gm ?? {};
  const approved = gm.approved ?? [];
  const removed = gm.gear?.remove ?? [];
  const added = gm.gear?.add ?? [];
  const sheet = resolved?.sheet;
  // what the character carries, by item name, and what the GM already took away
  const carried = [
    ...new Set([
      ...(sheet?.weapons.map((w) => w.name) ?? []),
      ...(sheet?.armour.name ? [sheet.armour.name] : []),
      ...(sheet?.gear.map(gearName) ?? []),
      ...removed,
    ]),
  ];
  const wargear = [...catalogue.wargear.values()]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((w) => rowOf({ record: w, taken: added.some((g) => g.wargearId === w.id), extra: [w.category] }));

  // The species by ruling, or none.
  const handleSpecies = (e: ChangeEvent<HTMLSelectElement>) =>
    edit(setGmSpecies({ build, id: e.target.value || undefined }));
  // A keyword by ruling, in the form keywords take.
  const handleKeyword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const k = writeInKeyword(keyword).trim();
    if (k && !(gm.keywords ?? []).includes(k)) edit(toggleGmKeyword({ build, keyword: k }));
    setKeyword("");
  };
  // A Trait bonus by ruling; an empty field removes it.
  const handleMod = (key: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const n = e.target.value === "" ? null : Math.trunc(Number(e.target.value));
    edit(setGmMod({ build, key, value: n === null || Number.isNaN(n) ? null : n }));
  };
  const clearTicks = (): LedgerBuild => ({ ...build, gm: { ...gm, approved: [] } });

  return (
    <section className="stack lb-gm" aria-labelledby="lb-gm">
      <h3 id="lb-gm" className="lb-sub">
        {t("title")}
        <span className="small dim"> · {params.cites.gm}</span>
      </h3>

      <div className="row">
        <span>{t("ticks", { count: approved.length })}</span>
        {approved.length > 0 && (
          <button type="button" className="btn sm" onClick={() => edit(clearTicks())}>
            {t("clearTicks")}
          </button>
        )}
      </div>

      <label className="stack lb-field">
        <span>{t("species")}</span>
        <select value={gm.species ?? ""} onChange={handleSpecies}>
          <option value="">{t("noRuling")}</option>
          {catalogue.creation.species.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="stack">
        <span>{t("keywords")}</span>
        {(gm.keywords ?? []).length > 0 && (
          <p className="row">
            {(gm.keywords ?? []).map((k) => (
              <button
                key={k}
                type="button"
                className="btn sm"
                aria-pressed
                onClick={() => edit(toggleGmKeyword({ build, keyword: k }))}
                aria-label={t("removeKeyword", { keyword: k })}
              >
                {k}
              </button>
            ))}
          </p>
        )}
        <form className="row" onSubmit={handleKeyword}>
          <label className="lb-field">
            <span className="sr-only">{t("addKeyword")}</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={60} autoComplete="off" />
          </label>
          <button type="submit" className="btn" disabled={!writeInKeyword(keyword).trim()}>
            {t("add")}
          </button>
        </form>
      </div>

      <fieldset className="stack">
        <legend>{t("mods")}</legend>
        <div className="lb-mods">
          {params.vocabulary.mods.map((m) => (
            <label key={m.key} className="stack lb-field">
              <span className="small">{m.label ?? m.key}</span>
              <input type="number" inputMode="numeric" value={gm.mods?.[m.key] ?? ""} onChange={handleMod(m.key)} />
            </label>
          ))}
        </div>
      </fieldset>

      {carried.length > 0 && (
        <div className="stack">
          <span>{t("takeAway")}</span>
          <p className="row">
            {carried.map((name) => (
              <button
                key={name}
                type="button"
                className="btn sm"
                aria-pressed={removed.includes(name)}
                onClick={() => edit(toggleGmGearRemove({ build, name }))}
              >
                {name}
              </button>
            ))}
          </p>
        </div>
      )}

      <div className="stack">
        <span>{t("give")}</span>
        <RecordList
          label={t("give")}
          rows={wargear}
          onPick={(id) =>
            edit(toggleGmGearAdd({ build, item: { name: catalogue.wargear.get(id)?.name ?? id, wargearId: id } }))
          }
        />
      </div>
    </section>
  );
}
