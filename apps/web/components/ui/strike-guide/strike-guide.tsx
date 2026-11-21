"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput, Actor, BookSource } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset, StrikeFigureRead } from "@inconsistable/rules-engine";

import { BreakdownLines } from "@/components/ui/breakdown-lines/breakdown-lines";
import { Cite } from "@/components/ui/cite/cite";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { RulesReply, type RulesEntry } from "@/lib/library/library";
import { typedOf } from "@/lib/lookup/lookup";
import { nextTable } from "@/lib/spends/spends";
import { entryTypesOf, isPlan, meansOf, previewStrike, strikesFor, targetsOf } from "@/lib/strike/strike";

type StrikeGuideProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset;
  attacker: Actor;
  /** The fight's combatants' actors, in the fight's order: the targets offered. */
  fighting: readonly Actor[];
  campaignId: string;
  characters: number;
  campaign: Readonly<Record<string, unknown>>;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** Sends one action; true when it went through (its refusal is shown by whoever holds the guide). */
  run: (a: ActionInput) => Promise<boolean>;
  /** Opens the strike's next table for the target, with the strike's inputs carried (house decision #91's shape). */
  onTable?: (open: { tableId: string; actorId: string; inputs: Record<string, number | boolean> }) => void;
};

const ENTRIES = 200;

// STRIKE (house decision #99): a guide for one of the ruleset's strike kinds, the attacker's. Pick the means and the
// target, set the inputs, read the pool, the number to beat and the soak line by line, type the total the dice made on
// the table, see what it does, APPLY (strike.apply, which the server works out again), then the notes and the table at
// hand. The app never rolls and never decides a hit. A widget of the closed list, so a layout target can place it.
export function StrikeGuide(props: StrikeGuideProps) {
  const { ruleset, compiled, attacker, fighting, campaignId, characters, campaign, books, requestPage, run, onTable } =
    props;
  const t = useTranslations("strike");
  const tr = useRefusal();
  const kinds = strikesFor({ ruleset, actor: attacker });
  const [open, setOpen] = useState(false);
  const [kindId, setKindId] = useState(kinds[0]?.id ?? "");
  const [entries, setEntries] = useState<RulesEntry[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [inputs, setInputs] = useState<Record<string, number | boolean>>({});
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const strike = kinds.find((k) => k.id === kindId) ?? kinds[0];
  if (strike === undefined) return null;

  const means = meansOf({ strike, actor: attacker, entries });
  const chosen = means.find((m) => `${m.source}:${m.ref}` === pick) ?? means[0];
  const targets = targetsOf({ ruleset, strike, attackerId: attacker.id, fighting });
  const target = targets.find((a) => a.id === targetId) ?? targets[0];
  const total = typedOf(typed);
  const plan = previewStrike({
    compiled,
    strike,
    attacker,
    target,
    means: chosen,
    inputs,
    total,
    characters,
    campaign,
  });
  const harm = ruleset.health.harm;
  const label = (id: string | undefined) => ruleset.resources.find((r) => r.id === id)?.label ?? id ?? "";
  const next = nextTable({ ruleset, spend: { then: strike.then }, inputs });

  // STRIKE: opens the guide, reading the attached packs' entries its means come from.
  const handleOpen = async () => {
    setOpen(true);
    try {
      const read = await Promise.all(
        entryTypesOf(strike).map(async (type) => {
          const path = `/api/campaigns/${encodeURIComponent(campaignId)}/rules?type=${encodeURIComponent(type)}&limit=${ENTRIES}`;
          const res = await fetch(path);
          const parsed = RulesReply.safeParse(await res.json());
          if (!res.ok || !parsed.success) throw new Error(t("readFailed"));
          return parsed.data.entries;
        }),
      );
      setEntries(read.flat());
      setError(null);
    } catch {
      setError(t("readFailed"));
    }
  };
  // KIND: another strike kind; what was picked for the last one goes.
  const handleKind = (id: string) => {
    setKindId(id);
    setPick(null);
    setInputs({});
    setTyped("");
  };
  // A stepper's − or +, held to its bounds.
  const handleStep = (id: string, by: number, min: number, max: number) =>
    setInputs((was) => ({ ...was, [id]: Math.max(min, Math.min(max, Number(was[id] ?? min) + by)) }));
  // APPLY: the strike with the typed total; the server works the outcome out again. The total clears once it lands.
  const handleApply = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || total === null || !isPlan(plan) || plan.harm === null) return;
    const ok = await run({
      type: "strike.apply",
      strikeId: strike.id,
      attackerId: attacker.id,
      ...(chosen ? { means: { source: chosen.source, ref: chosen.ref } } : {}),
      targetId: target.id,
      inputs,
      total,
    });
    if (ok) setTyped("");
  };

  if (!open)
    return (
      <button type="button" className="btn strike-open" onClick={handleOpen}>
        {t("open")}
      </button>
    );

  // One number the guide shows, with its lines.
  const figure = (f: StrikeFigureRead, name: string) => (
    <div className="stack strike-figure">
      <span className="row strike-figure-head">
        <span className="small">{name}</span>
        <strong className="strike-num">{f.total}</strong>
      </span>
      <BreakdownLines lines={f.lines} label={t("linesOf", { name })} {...{ ruleset, books, requestPage }} />
    </div>
  );
  const refusal =
    plan !== null && !isPlan(plan)
      ? tr({ code: plan.code, message: plan.message, params: { detail: plan.message, strike: strike.id } })
      : null;
  // A mob's wounds are members lost (house decision #66), said as its members going down.
  const members = harm?.mob?.members;
  const mob = members !== undefined && target?.resources[members] !== undefined;
  const harmWords = (h: { wounds: number; shock: number }) =>
    [
      ...(h.wounds !== 0
        ? [
            mob
              ? t("change", { by: -h.wounds, label: label(members) })
              : t("change", { by: h.wounds, label: label(harm?.wounds) }),
          ]
        : []),
      ...(h.shock !== 0 ? [t("change", { by: h.shock, label: label(harm?.shock) })] : []),
    ].join(", ");

  return (
    <section className="stack strike-guide" aria-label={t("guideFor", { name: attacker.name })}>
      <div className="row strike-head">
        <strong>{t("heading", { strike: strike.label, name: attacker.name })}</strong>
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>
          {t("close")}
        </button>
      </div>
      {strike.cite && <Cite cite={strike.cite} {...{ ruleset, books, requestPage }} />}
      {kinds.length > 1 && (
        <div className="seg" role="group" aria-label={t("kinds")}>
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              className="btn"
              aria-pressed={k.id === strike.id}
              onClick={() => handleKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {strike.means !== undefined &&
        (means.length === 0 ? (
          <p className="dim">{t("noMeans", { name: attacker.name })}</p>
        ) : (
          <div className="row strike-means" role="group" aria-label={t("means")}>
            {means.map((m) => (
              <button
                key={`${m.source}:${m.ref}`}
                type="button"
                className="btn sm"
                aria-pressed={m === chosen}
                onClick={() => setPick(`${m.source}:${m.ref}`)}
              >
                {m.name}
              </button>
            ))}
          </div>
        ))}
      {targets.length === 0 ? (
        <p className="dim">{t("noTarget")}</p>
      ) : (
        <label className="row table-target">
          <span>{t("target")}</span>
          <select value={target?.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(strike.inputs ?? []).map((x) =>
        x.type === "bool" ? (
          <label key={x.id} className="row" style={{ minHeight: 44 }}>
            <input
              type="checkbox"
              role="switch"
              checked={inputs[x.id] === true}
              onChange={(e) => setInputs((was) => ({ ...was, [x.id]: e.target.checked }))}
            />
            {x.label}
          </label>
        ) : (
          <div key={x.id} className="row table-input">
            <span>{x.label}</span>
            <span className="stepper" role="group" aria-label={x.label}>
              <button
                type="button"
                className="btn"
                aria-label={t("less", { label: x.label })}
                onClick={() => handleStep(x.id, -1, x.min ?? 0, x.max ?? 99)}
              >
                −
              </button>
              <output>{Number(inputs[x.id] ?? x.min ?? 0)}</output>
              <button
                type="button"
                className="btn"
                aria-label={t("more", { label: x.label })}
                onClick={() => handleStep(x.id, 1, x.min ?? 0, x.max ?? 99)}
              >
                +
              </button>
            </span>
          </div>
        ),
      )}
      {refusal && (
        <p className="dim" role="status">
          {refusal}
        </p>
      )}
      {isPlan(plan) && (
        <>
          <div className="strike-figures">
            {figure(plan.pool, strike.pool.label)}
            {figure(plan.beat, strike.beat.label)}
            {plan.soak && strike.soak && figure(plan.soak, strike.soak.label)}
          </div>
          <form className="stack strike-total" onSubmit={handleApply}>
            <label className="stack table-typed">
              <span className="small">{t("total")}</span>
              <input
                className="input"
                inputMode="numeric"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label={t("totalLabel", { strike: strike.label })}
              />
            </label>
            {total !== null && (
              <output className="strike-outcome" aria-live="polite">
                {plan.outcome === null
                  ? t("nothing")
                  : plan.harm === null
                    ? t("outcomeOnly", { outcome: plan.outcome.label })
                    : t("outcome", {
                        outcome: plan.outcome.label,
                        harm: harmWords(plan.harm),
                        name: target?.name ?? "",
                      })}
              </output>
            )}
            <button type="submit" className="btn primary" disabled={plan.harm === null || total === null}>
              {t("apply")}
            </button>
          </form>
          {plan.notes.length > 0 && (
            <ul className="stack strike-notes" aria-label={t("notes")}>
              {plan.notes.map((n, i) => (
                <li key={i}>
                  {n.text} {n.cite && <Cite cite={n.cite} {...{ ruleset, books, requestPage }} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {next && onTable && target && (
        <button
          type="button"
          className="btn sm"
          onClick={() => onTable({ tableId: next.tableId, actorId: target.id, inputs: next.inputs })}
        >
          {t("openTable", { title: next.title })}
        </button>
      )}
    </section>
  );
}
