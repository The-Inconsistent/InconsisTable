"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Actor, LiveState, Me } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { AssignStep } from "@/components/builder/components/assign-step/assign-step";
import { ChooseStep } from "@/components/builder/components/choose-step/choose-step";
import { CreationPathPicker } from "@/components/builder/components/creation-path/creation-path";
import { FieldsStep } from "@/components/builder/components/fields-step/fields-step";
import { DRAFT_DELAY_MS } from "@/components/builder/constants";
import { LedgerBuild } from "@/components/builder/ledger-build/ledger-build";
import { ActorPictureField } from "@/components/ui/actor-picture-field/actor-picture-field";
import { Cite, CiteProvider } from "@/components/ui/cite/cite";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { type Send, useTable } from "@/hooks/use-table/use-table";
import { useWorldRefresh } from "@/hooks/use-world-refresh/use-world-refresh";
import {
  type Answers,
  entityFor,
  needsBuild,
  parseProblems,
  previewBuild,
  problemsByStep,
  stepsFor,
} from "@/lib/builder/builder";
import { gmSideOf, madeBothWays, usesLedger } from "@/lib/ledger/table";
import type { RulesEntry } from "@/lib/library/library";

type BuilderProps = {
  campaignId: string;
  actorId: string;
  ruleset: Ruleset;
  /** The attached entries this seat may pick, by entity type (read on the server, seat-scoped). */
  entries: Readonly<Record<string, readonly RulesEntry[]>>;
  /** The seat, read when the ruleset has a ledger builder. */
  me?: Me | undefined;
  /** The ledger builder's step a link asked for, for a character in play. */
  step?: string | null | undefined;
  /** The room's World the page was rendered with, null without one. */
  worldVersionId?: string | null;
  /** The slugs of the packs the room is served (IMPORT FROM LIBRARY). */
  packs?: readonly string[];
};

// BUILD CHARACTER: waits for the table's first snapshot (it carries this user's draft), then walks the ruleset's creation,
// or opens the ledger builder for a character it builds.
export function Builder({ campaignId, actorId, ruleset, entries, me, step, worldVersionId, packs = [] }: BuilderProps) {
  const t = useTranslations("builder");
  const tStatus = useTranslations("status");
  // The same socket as the table's, so a cite opens its page while a device serves the book (#221).
  const { state, send, books, requestPage } = useTable(campaignId);
  useWorldRefresh({ rendered: worldVersionId ?? null, live: state?.campaign.worldVersionId });
  // BUILD or BY HAND for a type both make, until the first save (house decision #199); a player always builds.
  const [path, setPath] = useState(ruleset.build?.first ?? "build");
  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  const actor = state.actors.find((a) => a.id === actorId);
  if (!actor) return <StatusScreen text={t("notAtTable")} />;
  const picks =
    me !== undefined &&
    madeBothWays(ruleset) &&
    gmSideOf({ me, kind: actor.kind }) &&
    actor.ledger === null &&
    needsBuild(actor);
  return (
    <CiteProvider ruleset={ruleset} books={books} requestPage={requestPage}>
      {picks && <CreationPathPicker path={path} onPick={setPath} />}
      {me && usesLedger({ ruleset, actor, path: picks ? path : "build" }) ? (
        <LedgerBuild {...{ campaignId, ruleset, actor, send, step, packs }} me={me} campaign={state.campaign.fields} />
      ) : (
        <BuilderGate
          {...{ campaignId, actorId, ruleset, entries, send, actor }}
          campaign={state.campaign.fields}
          draft={state.myDraft?.actorId === actorId ? state.myDraft.answers : {}}
        />
      )}
    </CiteProvider>
  );
}

type CampaignValues = LiveState["campaign"]["fields"];
type GateProps = BuilderProps & { actor: Actor; draft: Answers; send: Send; campaign: CampaignValues };

// Decides once, from the first snapshot, whether there is anything to build: a build that lands while the form is open
// must not swap the form away before it has taken the player back to the table.
function BuilderGate({ campaignId, actorId, ruleset, entries, send, actor, draft, campaign }: GateProps) {
  const t = useTranslations("builder");
  const [built] = useState(() => !needsBuild(actor)); // the server refuses a second build
  const entity = entityFor({ ruleset, entityType: actor.entity });
  const steps = entity ? stepsFor({ ruleset, entity }) : [];
  if (built)
    return (
      <main className="page build">
        <h1 className="title">{t("isBuilt", { name: actor.name })}</h1>
        <p className="dim">{t("correctHint")}</p>
        <a className="btn" href={`/c/${campaignId}`}>
          {t("backToTable")}
        </a>
      </main>
    );
  if (!entity || steps.length === 0)
    return (
      <main className="page build">
        <h1 className="title">{t("nothingTitle")}</h1>
        <p className="dim">{t("nothingHint")}</p>
        <a className="btn" href={`/c/${campaignId}`}>
          {t("backToTable")}
        </a>
      </main>
    );
  return (
    <BuilderForm
      key={actorId}
      {...{ campaignId, actorId, ruleset, entries, entity, send, campaign, actor }}
      name={actor.name}
      initial={draft}
    />
  );
}

type BuilderFormProps = BuilderProps & {
  entity: string;
  name: string;
  initial: Answers;
  send: Send;
  campaign: CampaignValues;
  actor: Actor;
};

// The steps of one entity as cards on one column, the draft saved a moment after each change, the server's refusal
// shown under the step it names.
function BuilderForm({
  campaignId,
  actorId,
  ruleset,
  entries,
  entity,
  name,
  initial,
  send,
  campaign,
  actor,
}: BuilderFormProps) {
  const t = useTranslations("builder");
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
    () => previewBuild({ ruleset, entity, answers, entries: allEntries, campaign }),
    [ruleset, entity, answers, allEntries, campaign],
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
    setError(problems.length > 0 ? t("fixSteps") : r.error);
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
        <a href={`/c/${campaignId}`}>{t("backLink")}</a>
        <strong>{t("buildTitle", { name })}</strong>
        <LocaleSwitch />
        <ThemeSwitch />
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
                  {done ? t("stepDone") : step.optional ? t("stepOptional") : t("stepTodo")}
                  {step.cite && (
                    <>
                      {" · "}
                      <Cite cite={step.cite} />
                    </>
                  )}
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

        {/* The last step: its picture, the player's own (house decision #155). */}
        <ActorPictureField campaignId={campaignId} actor={actor} send={send} className="card stack" />

        <section className="card" aria-label={t("makesLabel")}>
          <h2 className="step-title">{t("makesLabel")}</h2>
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
            <p className="dim">{complete ? t("derivedLater") : t("derivedIncomplete")}</p>
          )}
          <p className="small dim">{t("recheck")}</p>
        </section>
      </main>
      <div className="build-bar">
        <button className="btn primary" disabled={busy || !answeredAll} onClick={handleBuild}>
          {t("buildButton")}
        </button>
        <button className="btn" disabled={busy || Object.keys(answers).length === 0} onClick={handleDiscard}>
          {t("startOver")}
        </button>
        <span className="small dim" role="status">
          {draftSaved === "saved" ? t("draftSaved") : draftSaved === "off" ? t("draftOff") : ""}
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
