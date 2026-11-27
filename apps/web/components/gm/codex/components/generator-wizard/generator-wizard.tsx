"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createPortal } from "react-dom";

import type { ActionInput, ActionResult } from "@inconsistable/core-schema";
import {
  askedSteps,
  roundsOf,
  type Generator,
  type GeneratorStep,
  type Ruleset,
  type StepValue,
} from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import { nextRoll } from "@/lib/generators/generators";
import type { RulesEntry } from "@/lib/library/library";

import { StepInput } from "./components/step-input/step-input";

type Answers = Readonly<Record<string, StepValue>>;

type GeneratorWizardProps = {
  generator: Generator;
  ruleset: Ruleset;
  campaignId: string;
  campaign: Readonly<Record<string, string | number | boolean>>;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The codex entries a run that makes no entry of its own may put its rounds under, and the one open (#202). */
  under?: { entries: readonly { id: string; title: string }[]; open: string | null };
  /** The entries the confirm made, root first. */
  onMade: (ids: readonly string[]) => void;
  onClose: () => void;
  /**
   * In CODEX's generator sheet (house decision #226): the sheet's foot, where ADD TO CODEX goes (null until it is drawn),
   * with ROLL ALL above the steps and AGAIN on each rolled step. Absent, the wizard is its own card (the first run's).
   */
  footer?: HTMLElement | null;
};

// A generator run in the GM's browser (house decision #98): its steps in order (each asked while its `when` holds), every
// roll through table.roll, then its rounds; nothing is written until CONFIRM, one action the server checks again.
export function GeneratorWizard({
  generator: g,
  ruleset,
  campaignId,
  campaign,
  act,
  under,
  onMade,
  onClose,
  footer,
}: GeneratorWizardProps) {
  const t = useTranslations("generators");
  // A run with no entry of its own puts its rounds under an entry the GM names, the open one to start with (#202).
  const rootless = g.make.root === false;
  const [parentId, setParentId] = useState(under?.open ?? "");
  const [answers, setAnswers] = useState<Answers>({});
  const [rounds, setRounds] = useState<readonly Answers[]>([]);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const asked = askedSteps({ ruleset, steps: g.steps, answers, campaign });
  const count = roundsOf({ ruleset, generator: g, answers, campaign });
  const eachSteps = g.each?.steps ?? [];

  const set = (over: Answers, id: string, v: StepValue | undefined): Answers => {
    const { [id]: _was, ...rest } = over;
    return v === undefined ? rest : { ...rest, [id]: v };
  };
  const answered = (steps: readonly GeneratorStep[], given: Answers, on: readonly boolean[]) =>
    steps.every((s, j) => !on[j] || Object.hasOwn(given, s.id));
  const roundAsked = (i: number) =>
    askedSteps({ ruleset, steps: eachSteps, above: g.steps, answers: { ...answers, ...(rounds[i] ?? {}) }, campaign });
  const ready =
    count !== null &&
    answered(g.steps, answers, asked) &&
    Array.from({ length: count }, (_, i) => answered(eachSteps, rounds[i] ?? {}, roundAsked(i))).every(Boolean);

  const inSheet = footer !== undefined;
  const leftToRoll = nextRoll({ ruleset, generator: g, answers, rounds, campaign }) !== null;

  // ROLL ALL: every asked roll step not yet done, in order and each to the end of its chain, one table.roll at a time;
  // a round's steps once the run's own say how many rounds there are. A refusal stops it where it is.
  const handleRollAll = async () => {
    setBusy(true);
    let own = answers;
    let each = rounds;
    let at = nextRoll({ ruleset, generator: g, answers: own, rounds: each, campaign });
    while (at !== null) {
      const r = await act({ type: "table.roll", tableId: at.table });
      if (!r.ok || !r.roll) break;
      const { round, step } = at;
      const given = round === null ? own : (each[round] ?? {});
      const rolled = set(given, step, { rows: [...(given[step]?.rows ?? []), r.roll.entryId] });
      if (round === null) own = rolled;
      else
        each = Array.from({ length: Math.max(each.length, round + 1) }, (_, k) =>
          k === round ? rolled : (each[k] ?? {}),
        );
      setAnswers(own);
      setRounds(each);
      at = nextRoll({ ruleset, generator: g, answers: own, rounds: each, campaign });
    }
    setBusy(false);
  };

  // CONFIRM: the asked answers and each round's, as one codex.generate.
  const handleConfirm = async () => {
    if (!ready || count === null) return;
    setBusy(true);
    const only = (steps: readonly GeneratorStep[], given: Answers, on: readonly boolean[]) =>
      Object.fromEntries(
        steps.flatMap((s, j) => {
          const v = given[s.id];
          return on[j] && v ? [[s.id, { ...v, rows: v.rows ? [...v.rows] : undefined }]] : [];
        }),
      );
    const r = await act({
      type: "codex.generate",
      generatorId: g.id,
      values: only(g.steps, answers, asked),
      each: Array.from({ length: count }, (_, i) => only(eachSteps, rounds[i] ?? {}, roundAsked(i))),
      ...(rootless && parentId !== "" ? { parentId } : {}),
    });
    setBusy(false);
    if (r.ok) onMade(r.ids ?? (r.id ? [r.id] : []));
  };

  const input = (
    s: GeneratorStep,
    before: readonly GeneratorStep[],
    given: Answers,
    onChange: (v?: StepValue) => void,
  ) => (
    <StepInput
      key={s.id}
      step={s}
      before={before}
      answers={given}
      value={given[s.id]}
      onChange={onChange}
      ruleset={ruleset}
      campaignId={campaignId}
      campaign={campaign}
      act={act}
      pickedName={given[s.id]?.key ? (names[`${s.id}/${given[s.id]?.key}`] ?? null) : null}
      onPicked={(e: RulesEntry) => setNames({ ...names, [`${s.id}/${e.key}`]: e.name })}
      again={inSheet}
    />
  );

  const confirm = (
    <button type="button" className="btn primary" disabled={!ready || busy} onClick={handleConfirm}>
      {t(inSheet ? "add" : "confirm")}
    </button>
  );

  return (
    <section className={inSheet ? "stack generator-wizard" : "card stack generator-wizard"} aria-label={g.label}>
      {inSheet ? (
        <button type="button" className="btn" disabled={!leftToRoll || busy} onClick={handleRollAll}>
          {t("rollAll")}
        </button>
      ) : (
        <div className="row between">
          <h3 className="head">{g.label}</h3>
          {g.cite && <Cite cite={g.cite} />}
        </div>
      )}
      <ol className="stack">
        {g.steps.map((s, j) =>
          asked[j] ? (
            <li key={s.id}>{input(s, g.steps.slice(0, j), answers, (v) => setAnswers(set(answers, s.id, v)))}</li>
          ) : null,
        )}
      </ol>
      {g.each && count === null && <p className="dim small">{t("roundsLater")}</p>}
      {count !== null &&
        Array.from({ length: count }, (_, i) => {
          const given = { ...answers, ...(rounds[i] ?? {}) };
          const on = roundAsked(i);
          const change = (id: string) => (v?: StepValue) =>
            setRounds(
              Array.from({ length: count }, (_, k) => (k === i ? set(rounds[k] ?? {}, id, v) : (rounds[k] ?? {}))),
            );
          return (
            <fieldset key={i} className="stack generator-round">
              <legend className="small">{t("round", { n: i + 1, count })}</legend>
              {eachSteps.map((s, j) =>
                on[j] ? input(s, [...g.steps, ...eachSteps.slice(0, j)], given, change(s.id)) : null,
              )}
            </fieldset>
          );
        })}
      {rootless && (
        <label className="stack">
          <span className="small">{t("under")}</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("loose")}</option>
            {under?.entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {inSheet ? (
        footer && createPortal(confirm, footer)
      ) : (
        <div className="row">
          {confirm}
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      )}
      <p className="small dim">{t("hint")}</p>
    </section>
  );
}
