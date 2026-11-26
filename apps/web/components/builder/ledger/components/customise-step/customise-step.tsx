"use client";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import { outOfReach } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import {
  offered,
  purchasesOf,
  ratingRow,
  recordCite,
  removeTalentAt,
  setRating,
  setTalentChoice,
  tapTalent,
  toggleLearnedLanguage,
  togglePackage,
  togglePower,
  type Layer,
  type RatingKind,
} from "@/lib/ledger/ledger";

import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList } from "../record-list/record-list";
import { StepIssues } from "../step-issues/step-issues";
import { XpCost } from "../xp-cost/xp-cost";

type CustomiseStepProps = { layer: Layer };

// CUSTOMISE (and ADVANCE, the same screen on the XP earned in play): ratings point by point, Talents, powers whose
// Discipline is in reach, and Advancement Packages. In play it also learns languages.
export function CustomiseStep({ layer }: CustomiseStepProps) {
  const t = useTranslations("ledgerBuilder.customise");
  const { params, catalogue, lookups, build, resolved, edit } = useLedger();
  const rowOf = useRowOf();
  const mine = purchasesOf({ build, layer });
  const who = resolved?.who ?? null;
  const step = layer === "creation" ? "customise" : "advance";
  const inPlay = layer === "advancement";
  const firstCategory = params.vocabulary.talentCategories[0];

  if (!resolved) return <p className="dim">{t("archetypeFirst")}</p>;

  const talents = catalogue.creation.talents
    .filter((x) => offered({ params, catalogue, source: x.source, taken: mine.talents.some((m) => m.id === x.id) }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((x) =>
      rowOf({
        record: x,
        requires: x.requires,
        taken: mine.talents.some((m) => m.id === x.id),
        extra: [...(x.category !== firstCategory ? [x.category] : []), <XpCost key="xp" cost={x.xp} />],
      }),
    );
  const powers = catalogue.creation.powers
    .filter((p) => offered({ params, catalogue, source: p.source, taken: mine.powers.includes(p.id) }))
    .filter(
      (p) =>
        mine.powers.includes(p.id) ||
        !who ||
        [p.disciplineId, ...p.alsoIn].some(
          (d) => !outOfReach([...(lookups.disciplines.get(d)?.requires ?? []), ...p.requires], who),
        ),
    )
    .map((p) =>
      rowOf({
        record: p,
        requires: p.requires,
        taken: mine.powers.includes(p.id),
        extra: [lookups.disciplines.get(p.disciplineId)?.name ?? p.disciplineId, <XpCost key="xp" cost={p.xp} />],
      }),
    );
  const packages = catalogue.creation.packages
    .filter((p) => p.kind === "advancement")
    .filter((p) => offered({ params, catalogue, source: p.source, taken: mine.packages.includes(p.id) }))
    .map((p) =>
      rowOf({
        record: p,
        requires: p.requires,
        taken: mine.packages.includes(p.id),
        extra: [<XpCost key="xp" cost={p.xp} />],
        blocked: p.notAtCreation && !inPlay ? t("notAtCreation") : undefined,
      }),
    );
  const learned = build.advancement?.languages ?? [];
  const languages = catalogue.creation.languages
    .filter((l) => offered({ params, catalogue, source: l.source, taken: learned.includes(l.id) }))
    .map((l) => rowOf({ record: l, taken: learned.includes(l.id), extra: [t("xp", { xp: params.languages.xp })] }));

  // A Talent in the list: taken, or given back.
  const handleTalent = (id: string) =>
    edit(tapTalent({ build, layer, id, repeatable: lookups.talents.get(id)?.repeatable ?? false }));

  return (
    <div className="stack">
      {inPlay && resolved.advancement && (
        <p className="lb-banner" role="status">
          {t("inPlay", {
            earned: resolved.advancement.budget,
            spent: resolved.advancement.spent,
            left: resolved.advancement.budget - resolved.advancement.spent,
            rank: resolved.advancement.rank,
            tier: resolved.advancement.tier,
          })}
        </p>
      )}
      <StepIssues step={step} />
      <RatingRows layer={layer} kind="attributes" />
      <RatingRows layer={layer} kind="skills" />

      <section className="stack" aria-labelledby={`lb-talents-${layer}`}>
        <h3 id={`lb-talents-${layer}`} className="lb-sub">
          {t("talents")}
        </h3>
        {mine.talents.length > 0 && (
          <ul className="list lb-plain" aria-label={t("taken")}>
            {mine.talents.map((m, i) => {
              const rec = lookups.talents.get(m.id);
              return (
                <li key={`${m.id}-${i}`} className="lb-taken">
                  <span className="lb-row-text">
                    <span className="pick-name">{rec?.name ?? m.id}</span>
                    <span className="small dim">
                      {rec ? recordCite(params, rec) : ""}
                      {rec && (
                        <>
                          {" · "}
                          <XpCost cost={rec.xp} />
                        </>
                      )}
                    </span>
                  </span>
                  {rec?.options && <TalentChoice layer={layer} index={i} options={rec.options} value={m.choice} />}
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => edit(removeTalentAt({ build, layer, index: i }))}
                    aria-label={t("removeLabel", { name: rec?.name ?? m.id })}
                  >
                    {t("remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <RecordList label={t("talents")} rows={talents} onPick={handleTalent} />
      </section>

      {powers.length > 0 && (
        <section className="stack" aria-labelledby={`lb-powers-${layer}`}>
          <h3 id={`lb-powers-${layer}`} className="lb-sub">
            {t("powers")}
          </h3>
          <RecordList label={t("powers")} rows={powers} onPick={(id) => edit(togglePower({ build, layer, id }))} />
        </section>
      )}

      {packages.length > 0 && (
        <section className="stack" aria-labelledby={`lb-packages-${layer}`}>
          <h3 id={`lb-packages-${layer}`} className="lb-sub">
            {t("packages")}
          </h3>
          <RecordList
            label={t("packages")}
            rows={packages}
            onPick={(id) => edit(togglePackage({ build, layer, id }))}
          />
        </section>
      )}

      {inPlay && (
        <section className="stack" aria-labelledby="lb-learn">
          <h3 id="lb-learn" className="lb-sub">
            {t("languages")}
          </h3>
          <p className="small dim">
            <Cite cite={params.languages.cite} />
          </p>
          <RecordList
            label={t("languages")}
            rows={languages}
            onPick={(id) => edit(toggleLearnedLanguage({ build, name: id }))}
          />
        </section>
      )}
    </div>
  );
}

type RatingRowsProps = { layer: Layer; kind: RatingKind };

// The Attributes or the Skills, one row each: the rating on the sheet, a step down where this layer bought it, a step
// up to the cap, and what the next point costs from the params' price table.
function RatingRows({ layer, kind }: RatingRowsProps) {
  const t = useTranslations("ledgerBuilder.customise");
  const { params, lookups, build, resolved, edit } = useLedger();
  if (!resolved) return null;
  const species = lookups.species.get(resolved.who.species?.[0] ?? "");
  const attributeName = new Map(params.vocabulary.attributes.map((a) => [a.id, a.name]));
  const keys =
    kind === "attributes"
      ? params.vocabulary.attributes.map((a) => ({ key: a.id, name: a.name, linked: undefined }))
      : params.vocabulary.skills.map((s) => ({ key: s.name, name: s.name, linked: attributeName.get(s.attribute) }));
  const table = kind === "attributes" ? params.attributeXp : params.skillXp;
  return (
    <section className="stack" aria-labelledby={`lb-${kind}-${layer}`}>
      <h3 id={`lb-${kind}-${layer}`} className="lb-sub">
        {kind === "attributes" ? t("attributes") : t("skills")}
        <span className="small dim">
          {" "}
          · <Cite cite={table.cite} />
        </span>
      </h3>
      <ul className="list lb-ratings">
        {keys.map(({ key, name, linked }) => {
          const value =
            kind === "attributes" ? (resolved.sheet.attributes[key] ?? 1) : (resolved.sheet.skills[key] ?? 0);
          const row = ratingRow({
            params,
            build,
            layer,
            kind,
            key,
            value,
            speciesMax: kind === "attributes" ? species?.max?.[key] : undefined,
          });
          return (
            <li key={key} className="lb-rating">
              <span className="lb-row-text">
                <span className="pick-name">{name}</span>
                <span className="small dim">
                  {linked && `${linked} · `}
                  {row.next === null || !row.canRaise ? t("atCap", { cap: row.cap }) : t("next", { xp: row.next })}
                </span>
              </span>
              <span className="stepper">
                <button
                  type="button"
                  className="btn"
                  disabled={!row.canReturn}
                  onClick={() => edit(setRating({ build, layer, kind, key, to: value - 1 }))}
                  aria-label={t("lower", { name })}
                >
                  −
                </button>
                <output aria-live="polite" aria-label={t("rating", { name, value })}>
                  {value}
                </output>
                <button
                  type="button"
                  className="btn"
                  disabled={!row.canRaise}
                  onClick={() => edit(setRating({ build, layer, kind, key, to: value + 1 }))}
                  aria-label={t("raise", { name })}
                >
                  +
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type TalentChoiceProps = { layer: Layer; index: number; options: string[]; value: string | undefined };

// A bought Talent's bracket: which of its options this copy is for.
function TalentChoice({ layer, index, options, value }: TalentChoiceProps) {
  const t = useTranslations("ledgerBuilder.customise");
  const { build, edit } = useLedger();
  // The bracket pick: one of the Talent's options, or none yet.
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) =>
    edit(setTalentChoice({ build, layer, index, choice: e.target.value }));
  return (
    <select value={value ?? ""} onChange={handleChange} aria-label={t("choiceLabel")}>
      <option value="">{t("choose")}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
