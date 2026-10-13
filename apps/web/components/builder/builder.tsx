"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { AssignStep } from "@/components/builder/components/assign-step/assign-step";
import { ChooseStep } from "@/components/builder/components/choose-step/choose-step";
import { FieldsStep } from "@/components/builder/components/fields-step/fields-step";
import { DRAFT_DELAY_MS } from "@/components/builder/constants";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { type Send, useTable } from "@/hooks/use-table/use-table";
import {
  type Answers,
  entityFor,
  needsBuild,
  parseProblems,
  previewBuild,
  problemsByStep,
  stepsFor,
} from "@/lib/builder/builder";
import type { RulesEntry } from "@/lib/library/library";

type BuilderProps = {
  campaignId: string;
  actorId: string;
  ruleset: Ruleset;
  /** The attached entries this seat may pick, by entity type (read on the server, seat-scoped). */
  entries: Readonly<Record<string, readonly RulesEntry[]>>;
};

// BUILD CHARACTER: waits for the table's first snapshot (it carries this user's draft), then walks the ruleset's creation.
export function Builder({ campaignId, actorId, ruleset, entries }: BuilderProps) {
  const { state, send } = useTable(campaignId);
  if (!state) return <StatusScreen text="Syncing…" />;
  const actor = state.actors.find((a) => a.id === actorId);
  if (!actor) return <StatusScreen text="That character isn't at this table." />;
  return (
    <BuilderGate
      {...{ campaignId, actorId, ruleset, entries, send, actor }}
      draft={state.myDraft?.actorId === actorId ? state.myDraft.answers : {}}
    />
  );
}

type GateProps = BuilderProps & { actor: Actor; draft: Answers; send: Send };

// Decides once, from the first snapshot, whether there is anything to build: a build that lands while the form is open
// must not swap the form away before it has taken the player back to the table.
function BuilderGate({ campaignId, actorId, ruleset, entries, send, actor, draft }: GateProps) {
  const [built] = useState(() => !needsBuild(actor)); // the server refuses a second build
  const entity = entityFor({ ruleset, entityType: actor.entity });
  const steps = entity ? stepsFor({ ruleset, entity }) : [];
  if (built)
    return (
      <main className="page build">
        <h1 className="title">{actor.name} is built</h1>
        <p className="dim">The GM can correct a value from the sheet.</p>
        <a className="btn" href={`/c/${campaignId}`}>
          Back to the table
        </a>
      </main>
    );
  if (!entity || steps.length === 0)
    return (
      <main className="page build">
        <h1 className="title">Nothing to build yet</h1>
        <p className="dim">This table has no ruleset with a character builder. Ask the GM.</p>
        <a className="btn" href={`/c/${campaignId}`}>
          Back to the table
        </a>
      </main>
    );
  return (
    <BuilderForm
      key={actorId}
      {...{ campaignId, actorId, ruleset, entries, entity, send }}
      name={actor.name}
      initial={draft}
    />
  );
}

type BuilderFormProps = BuilderProps & { entity: string; name: string; initial: Answers; send: Send };

// The steps of one entity as cards on one column, the draft saved a moment after each change, the server's refusal
// shown under the step it names.
function BuilderForm({ campaignId, actorId, ruleset, entries, entity, name, initial, send }: BuilderFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initial);
  const [serverProblems, setServerProblems] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState<"idle" | "saved" | "off">(
    Object.keys(initial).length ? "saved" : "idle",
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft timer: a save still pending when the builder unmounts would fire after the player left and recreate it.
  useEffect(() => () => clearTimeout(timer.current), []);
  const steps = stepsFor({ ruleset, entity });
  const defs = useMemo(() => new Map(ruleset.entities.map((e) => [e.id, e])), [ruleset.entities]);
  const allEntries = useMemo(() => Object.values(entries).flat(), [entries]);
  const preview = useMemo(
    () => previewBuild({ ruleset, entity, answers, entries: allEntries }),
    [ruleset, entity, answers, allEntries],
  );
  const clientProblems = problemsByStep(preview.problems);

  // Saves the answers as the draft, a moment after the last change. A guest has no account to keep one under.
  const scheduleSave = (next: Answers) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await send({ type: "draft.save", body: { actorId, answers: next } });
      setDraftSaved(r.ok ? "saved" : "off");
    }, DRAFT_DELAY_MS);
  };

  // One step's answer changed: keeps it, clears the server's old complaints about it, and schedules the draft.
  const handleAnswer = ({ stepId, value }: { stepId: string; value: unknown }) => {
    const next = { ...answers, [stepId]: value };
    setAnswers(next);
    setServerProblems(({ [stepId]: _old, ...rest }) => rest);
    scheduleSave(next);
  };

  // BUILD CHARACTER: the server runs the creation again; a refusal comes back by step, success goes to the table.
  const handleBuild = async () => {
    clearTimeout(timer.current);
    setBusy(true);
    const r = await send({ type: "actor.build", actorId, answers });
    setBusy(false);
    if (r.ok) return router.push(`/c/${campaignId}`);
    const problems = parseProblems(r.error);
    setServerProblems(problemsByStep(problems));
    setError(problems.length > 0 ? "Fix the steps marked below." : r.error);
  };

  // START OVER: forgets the answers and the saved draft.
  const handleDiscard = async () => {
    clearTimeout(timer.current);
    setAnswers({});
    setServerProblems({});
    setError(null);
    const r = await send({ type: "draft.discard" });
    setDraftSaved(r.ok ? "idle" : "off");
  };

  const complete = preview.fields !== null;
  // Every required step has an answer; whether the answers are right is the server's call.
  const answeredAll = steps.every((s) => s.optional || s.id in answers);
  return (
    <>
      <header className="band">
        <a href={`/c/${campaignId}`}>← Table</a>
        <strong>Build {name}</strong>
      </header>
      <main className="page build">
        {steps.map((step) => {
          const answered = step.id in answers;
          const lines = [...(serverProblems[step.id] ?? []), ...(answered ? (clientProblems[step.id] ?? []) : [])];
          const done = answered && !clientProblems[step.id];
          const def = defs.get(step.kind === "choose" ? step.pick : step.actor);
          const own = defs.get(step.actor);
          return (
            <section key={step.id} className="card" aria-labelledby={`step-${step.id}`}>
              <div className="step-head">
                <h2 className="step-title" id={`step-${step.id}`}>
                  {step.label}
                </h2>
                <span className="step-state" data-done={done}>
                  {done ? "Done" : step.optional ? "Optional" : "To do"}
                  {step.cite ? ` · ${step.cite}` : ""}
                </span>
              </div>
              {step.kind === "choose" && (
                <ChooseStep
                  step={step}
                  entries={entries[step.pick] ?? []}
                  def={def}
                  value={asKeys(answers[step.id])}
                  onChange={(keys) => handleAnswer({ stepId: step.id, value: keys })}
                />
              )}
              {step.kind === "assign" && (
                <AssignStep
                  step={step}
                  def={own}
                  value={asScores(answers[step.id])}
                  onChange={(scores) => handleAnswer({ stepId: step.id, value: scores })}
                />
              )}
              {step.kind === "fields" && (
                <FieldsStep
                  step={step}
                  def={own}
                  value={asRecord(answers[step.id])}
                  onChange={(values) => handleAnswer({ stepId: step.id, value: values })}
                />
              )}
              {lines.length > 0 && (
                <ul className="problem-lines error" role="alert">
                  {lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <section className="card" aria-label="What this makes">
          <h2 className="step-title">What this makes</h2>
          {preview.derived.length > 0 ? (
            <dl className="derived-list">
              {preview.derived.map((d) => (
                <div key={d.id}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="dim">
              {complete
                ? "The numbers show on the sheet once the GM sets what is left."
                : "Finish every step to see the numbers."}
            </p>
          )}
          <p className="small dim">The table checks these again when you build.</p>
        </section>
      </main>
      <div className="build-bar">
        <button className="btn primary" disabled={busy || !answeredAll} onClick={handleBuild}>
          Build character
        </button>
        <button className="btn" disabled={busy || Object.keys(answers).length === 0} onClick={handleDiscard}>
          Start over
        </button>
        <span className="small dim" role="status">
          {draftSaved === "saved" ? "Draft saved" : draftSaved === "off" ? "Draft not kept: sign in to keep one" : ""}
        </span>
        {error && (
          <p className="error" role="alert" style={{ flexBasis: "100%", margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}

// A draft is the user's own JSON: each step's answer is narrowed to the shape its step takes, or treated as unanswered.
const asKeys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
const asScores = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(asRecord(v)).filter((e): e is [string, number] => typeof e[1] === "number"));
