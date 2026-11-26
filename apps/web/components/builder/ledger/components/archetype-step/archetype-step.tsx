"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Cite } from "@/components/ui/cite/cite";
import {
  offered,
  pickArchetype,
  pickSpecies,
  recordCite,
  startAdvanced,
  toggleAbilityOf,
  toggleAdvancedWargear,
} from "@/lib/ledger/ledger";

import { ARCHETYPE_FILTERS, type ArchetypeFilter } from "../../constants";
import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList } from "../record-list/record-list";
import { StepIssues } from "../step-issues/step-issues";

// ARCHETYPE: an Archetype (with its species), or Advanced Creation (a species, an optional Archetype Ability and a
// kit, bought piece by piece). Picking another starts the build again from the Tier, as in Auspex.
export function ArchetypeStep() {
  const t = useTranslations("ledgerBuilder.archetype");
  const { params, catalogue, lookups, build, edit } = useLedger();
  const rowOf = useRowOf();
  const [filter, setFilter] = useState<ArchetypeFilter>("upToTier");
  const arch = build.archetypeId ? lookups.archetypes.get(build.archetypeId) : undefined;
  const factionName = (id: string) => lookups.factions.get(id)?.name ?? id;

  const archetypes = catalogue.creation.archetypes
    .filter((a) => offered({ params, catalogue, source: a.source, taken: a.id === build.archetypeId }))
    .filter((a) => filter === "all" || a.tier <= build.tier || a.id === build.archetypeId)
    .toSorted((a, b) => a.factionId.localeCompare(b.factionId) || a.tier - b.tier || a.name.localeCompare(b.name))
    .map((a) =>
      rowOf({
        record: a,
        requires: a.requires,
        taken: a.id === build.archetypeId,
        extra: [factionName(a.factionId), t("tierN", { tier: a.tier }), t("xp", { xp: a.xp })],
        blocked: a.tier > build.tier ? t("aboveTier", { tier: build.tier }) : undefined,
      }),
    );

  return (
    <div className="stack">
      <div className="row">
        <button
          type="button"
          className="btn"
          aria-pressed={!!build.advanced}
          onClick={() => edit(startAdvanced({ build }))}
        >
          {t("advanced")}
        </button>
        <span className="small dim">{build.advanced ? t("advancedOn") : t("advancedOff")}</span>
      </div>
      {arch && <ArchetypeCard />}
      {build.advanced && <AdvancedPanel />}
      <StepIssues step="archetype" />
      <section className="stack" aria-labelledby="lb-archetypes">
        <h3 id="lb-archetypes" className="lb-sub">
          {t("list")}
        </h3>
        <RecordList
          label={t("list")}
          rows={archetypes}
          onPick={(id) => edit(pickArchetype({ build, id }))}
          tools={
            <span className="seg" role="group" aria-label={t("filter")}>
              {ARCHETYPE_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="btn sm"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "upToTier" ? t("upToTier", { tier: build.tier }) : t("all")}
                </button>
              ))}
            </span>
          }
        />
      </section>
    </div>
  );
}

// The chosen Archetype as its record prints it: Tier, price, species, keywords, ratings and abilities.
function ArchetypeCard() {
  const t = useTranslations("ledgerBuilder.archetype");
  const { params, lookups, build, resolved, edit } = useLedger();
  const arch = lookups.archetypes.get(build.archetypeId ?? "");
  if (!arch) return null;
  const attributeName = new Map(params.vocabulary.attributes.map((a) => [a.id, a.name]));
  const speciesNow = resolved?.who.species?.[0];
  const ratings = [
    ...Object.entries(arch.attributes).map(([k, v]) => `${attributeName.get(k) ?? k} ${v}`),
    ...Object.entries(arch.skills).map(([k, v]) => `${k} ${v}`),
  ];
  return (
    <article className="stack lb-card" aria-labelledby="lb-arch-name">
      <h3 id="lb-arch-name" className="lb-card-name">
        {arch.name}
      </h3>
      <p className="small dim">
        {[recordCite(params, arch), t("tierN", { tier: arch.tier }), t("xp", { xp: arch.xp })].join(" · ")}
      </p>
      {arch.summary && <p>{arch.summary}</p>}
      {arch.keywords.length > 0 && (
        <p className="row" aria-label={t("keywords")}>
          {arch.keywords.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </p>
      )}
      {ratings.length > 0 && <p className="small">{ratings.join(" · ")}</p>}
      <ul className="lb-plain-list">
        {arch.abilities.map((a) => (
          <li key={a.name}>
            <strong>{a.name}</strong>
            {a.summary && <span className="small"> {a.summary}</span>}
          </li>
        ))}
      </ul>
      {arch.speciesIds.length > 1 && (
        <div className="stack">
          <h4 className="lb-sub">{t("species")}</h4>
          <div className="row" role="group" aria-label={t("species")}>
            {arch.speciesIds.map((id) => (
              <button
                key={id}
                type="button"
                className="btn"
                aria-pressed={speciesNow === id}
                onClick={() => edit(pickSpecies({ build, id }))}
              >
                {lookups.species.get(id)?.name ?? id}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

// Advanced Creation: a species, an Archetype's Ability the GM agrees to, and a kit by Value and rarity.
function AdvancedPanel() {
  const t = useTranslations("ledgerBuilder.archetype");
  const { params, catalogue, build, edit } = useLedger();
  const rowOf = useRowOf();
  const adv = build.advanced;
  if (!adv) return null;
  const species = catalogue.creation.species
    .filter((s) => offered({ params, catalogue, source: s.source, taken: s.id === build.speciesId }))
    .map((s) => rowOf({ record: s, taken: s.id === build.speciesId, extra: [t("xp", { xp: s.xp })] }));
  const abilities = catalogue.creation.archetypes
    .filter((a) => offered({ params, catalogue, source: a.source, taken: a.id === adv.abilityOf }))
    .map((a) =>
      rowOf({
        record: a,
        taken: a.id === adv.abilityOf,
        extra: [t("tierN", { tier: a.tier }), t("xp", { xp: a.tier * params.advanced.abilityXpPerTier })],
      }),
    );
  const kit = [...catalogue.wargear.values()]
    .filter((w) => w.value !== null && w.rarity !== null && w.kind !== "upgrade")
    .filter((w) => offered({ params, catalogue, source: w.source, taken: (adv.wargear ?? []).includes(w.id) }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((w) =>
      rowOf({
        record: w,
        requires: w.requires,
        taken: (adv.wargear ?? []).includes(w.id),
        extra: [t("value", { value: w.value ?? 0 }), w.rarity ?? ""],
      }),
    );
  return (
    <div className="stack lb-advanced">
      <section className="stack" aria-labelledby="lb-adv-species">
        <h3 id="lb-adv-species" className="lb-sub">
          {t("species")}
        </h3>
        <RecordList label={t("species")} rows={species} onPick={(id) => edit(pickSpecies({ build, id }))} />
      </section>
      <section className="stack" aria-labelledby="lb-adv-ability">
        <h3 id="lb-adv-ability" className="lb-sub">
          {t("ability")}
        </h3>
        <p className="small dim">{t("abilityNote")}</p>
        <RecordList label={t("ability")} rows={abilities} onPick={(id) => edit(toggleAbilityOf({ build, id }))} />
      </section>
      <section className="stack" aria-labelledby="lb-adv-kit">
        <h3 id="lb-adv-kit" className="lb-sub">
          {t("kit")}
        </h3>
        <p className="small dim">
          <Cite cite={params.advanced.wargear.cite} />
        </p>
        <RecordList label={t("kit")} rows={kit} onPick={(id) => edit(toggleAdvancedWargear({ build, id }))} />
      </section>
    </div>
  );
}
