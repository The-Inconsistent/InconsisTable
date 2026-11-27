"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { checklistTicks, type ChecklistRoom, type ChecklistStep } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import { TermMark, type TermEnv } from "@/components/ui/term-card/term-card";

type SetupChecklistProps = {
  steps: readonly ChecklistStep[];
  room: ChecklistRoom;
  /** GO TO: opens the place of the GM's app where the step is done. */
  onGo: (goto: NonNullable<ChecklistStep["goto"]>) => void;
  /** Given, a step's note sits behind its ⓘ with its page (house decision #126); else the note is printed under it. */
  terms?: TermEnv;
};

// The setup checklist the ruleset declares (house decision #90), on the GM's PARTY tab where a new room lands: each step
// in the book's order, ticked from what the room holds and never stored, the first step not done marked NEXT, its page,
// and a GO TO. Once every step that is not optional is done it folds to one line; the GM can open or fold it.
export function SetupChecklist({ steps, room, onGo, terms }: SetupChecklistProps) {
  const t = useTranslations("checklist");
  const tTabs = useTranslations("gmApp.tabs");
  const tKind = useTranslations("codex.kind");
  const tAnchor = useTranslations("checklist.anchors");
  const [open, setOpen] = useState<boolean | null>(null);
  const { ticks, next, doneCount } = checklistTicks({ steps, room });
  const shown = open ?? next !== null;
  const where = (goto: NonNullable<ChecklistStep["goto"]>) =>
    goto.kind
      ? `${tTabs(goto.tab)} › ${tKind(goto.kind)}`
      : goto.anchor
        ? `${tTabs(goto.tab)} › ${tAnchor(goto.anchor)}`
        : tTabs(goto.tab);

  return (
    <section className="card stack" aria-label={t("title")} data-panel="checklist" style={{ minWidth: 0 }}>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <h2 className="head">{t("title")}</h2>
        <button className="btn sm" aria-expanded={shown} onClick={() => setOpen(!shown)}>
          {shown ? t("fold") : t("show")}
        </button>
      </div>
      <p className="small">{t("progress", { done: doneCount, count: steps.length })}</p>
      {shown && (
        <ol className="list stack">
          {ticks.map(({ step, count, done, now }) => (
            <li
              key={step.id}
              className="row between"
              data-state={done ? "done" : step.id === next ? "next" : undefined}
              style={{ flexWrap: "wrap", alignItems: "start" }}
            >
              <span className="stack" style={{ flex: "1 1 240px", minWidth: 0, gap: 2 }}>
                <span className="row" style={{ gap: 6 }}>
                  <span className="chip" data-state={done ? "good" : undefined}>
                    {done ? t("done") : t("toDo")}
                  </span>
                  {step.id === next && <span className="chip">{t("next")}</span>}
                  {step.optional && !done && <span className="chip">{t("optional")}</span>}
                  <strong style={{ overflowWrap: "anywhere" }}>{step.label}</strong>
                  <TermMark term={{ label: step.label, summary: step.note, cite: step.cite }} env={terms} />
                </span>
                <span className="small dim">
                  {/* A step's room value in its place, when the ruleset gives one (house decision #173). */}
                  {t("now", {
                    count: now === null ? String(count) : typeof now === "boolean" ? (now ? "✓" : "–") : String(now),
                  })}
                  {step.cite && (
                    <>
                      {" · "}
                      <Cite cite={step.cite} />
                    </>
                  )}
                </span>
                {step.note && !terms && <span className="small">{step.note}</span>}
              </span>
              {step.goto && (
                <button
                  className={step.id === next ? "btn primary" : "btn"}
                  aria-label={t("goTo", { step: step.label, place: where(step.goto) })}
                  onClick={() => step.goto && onGo(step.goto)}
                >
                  {where(step.goto)}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
