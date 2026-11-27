"use client";
import { useTranslations } from "next-intl";

import { wargearMatches, type BuildChoicePrompt } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import { answerChoice, declineChoice } from "@/lib/ledger/ledger";

import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList, type RecordRow } from "../record-list/record-list";

type ChoiceCardProps = { prompt: BuildChoicePrompt };

const open = { out: false, unmet: [], gm: [] };
const plain = (id: string, name: string, taken: boolean): RecordRow => ({ id, name, search: "", taken, reach: open });

// One choice a grant asks for: what to choose, how many, and the answers on offer, as the engine describes them. An
// option is answered by its index, everything else by its id or name.
export function ChoiceCard({ prompt }: ChoiceCardProps) {
  const t = useTranslations("ledgerBuilder.choice");
  const { params, catalogue, lookups, build, resolved, edit } = useLedger();
  const rowOf = useRowOf();
  const pick = prompt.pick;
  const has = (v: string | number) => prompt.answer.includes(v);
  const tier = resolved?.advancement?.tier ?? build.tier;
  const attributeName = new Map(params.vocabulary.attributes.map((a) => [a.id, a.name]));

  const rows: RecordRow[] =
    pick.kind === "option"
      ? prompt.options.map((label, i) => plain(String(i), label, has(i)))
      : pick.kind === "skill"
        ? pick.from.map((s) => plain(s, s, has(s)))
        : pick.kind === "attribute"
          ? pick.from.map((a) => plain(a, attributeName.get(a) ?? a, has(a)))
          : pick.kind === "keyword"
            ? (resolved?.sheet.keywords ?? []).map((k) => plain(k, k, has(k)))
            : pick.kind === "discipline"
              ? catalogue.creation.disciplines
                  .filter((d) => !pick.from || pick.from.includes(d.id))
                  .map((d) => rowOf({ record: d, requires: d.requires, taken: has(d.id) }))
              : pick.kind === "power"
                ? catalogue.creation.powers
                    .filter((p) => [p.disciplineId, ...p.alsoIn].some((d) => pick.disciplines.includes(d)))
                    .map((p) =>
                      rowOf({
                        record: p,
                        requires: p.requires,
                        taken: has(p.id),
                        extra: [lookups.disciplines.get(p.disciplineId)?.name ?? p.disciplineId],
                      }),
                    )
                : [...catalogue.wargear.values()]
                    .filter((w) => wargearMatches(w, pick.filter, { tier, newTier: tier }, params))
                    .toSorted((a, b) => a.name.localeCompare(b.name))
                    .map((w) =>
                      rowOf({
                        record: w,
                        requires: w.requires,
                        taken: has(w.id),
                        extra: [w.category, ...(w.rarity ? [w.rarity] : []), ...(w.value !== null ? [w.value] : [])],
                      }),
                    );

  // A tap answers with that row, or takes it back.
  const handlePick = (id: string) =>
    edit(answerChoice({ build, prompt, value: pick.kind === "option" ? Number(id) : id }));
  // ponytail: an optional choice is known only by the engine's wording ("Choose up to"), upgrade: an `optional` flag on
  // the engine's choice prompt
  const declinable = prompt.what.startsWith("Choose up to") && !(prompt.path in (build.choices ?? {}));
  const left = prompt.choose - prompt.answer.length;

  return (
    <fieldset className="lb-choice stack">
      <legend className="pick-name">{prompt.what}</legend>
      <p className="small row">
        {prompt.cite && <Cite cite={prompt.cite} />}
        <strong data-state={left > 0 ? "open" : "done"}>{left > 0 ? t("toPick", { count: left }) : t("chosen")}</strong>
        {prompt.of && pick.kind !== "option" && <span className="dim">{prompt.of}</span>}
      </p>
      <RecordList label={prompt.what} rows={rows} onPick={handlePick} />
      {declinable && (
        <button type="button" className="btn sm" onClick={() => edit(declineChoice({ build, path: prompt.path }))}>
          {t("takeNone")}
        </button>
      )}
    </fieldset>
  );
}
