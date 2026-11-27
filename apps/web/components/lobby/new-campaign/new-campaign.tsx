"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { RoomImportRefusal, TableMode } from "@inconsistable/core-schema";

import {
  EntryFieldsForm,
  type FieldsDraft,
} from "@/components/gm/codex/components/entry-fields-form/entry-fields-form";
import { GamePicker } from "@/components/lobby/game-picker/game-picker";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { importFreeform } from "@/lib/freeform/import-freeform";
import { startMode, type GameOption } from "@/lib/games/games";
import {
  WIZARD_STEPS,
  documentProblem,
  roomDocument,
  stepOfPath,
  toLines,
  type CampaignValue,
  type WizardOptions,
  type WizardStep,
} from "@/lib/games/room-document";
import { importRoom } from "@/lib/room-import/room-import";

import { CampaignStep } from "./components/campaign-step/campaign-step";
import { TableStep, type SafetyDraft } from "./components/table-step/table-step";

type NewCampaignProps = { games: readonly GameOption[]; options: WizardOptions };
type Problem = { step: WizardStep | null; message: string; path?: string };

const NO_SAFETY: SafetyDraft = { lines: "", veils: "", xCard: false };
const NO_PREMISE = { title: "", fields: {} as FieldsDraft };

// NEW CAMPAIGN (house decisions #142 to #146): GAME, CAMPAIGN, PREMISE, TABLE and NAME, each shown only when the game
// asks it, the draft held in this page. CREATE checks the whole room with a dry run, then makes it in one request, so
// leaving at any step leaves nothing behind. QUICK GAME stays the short way in.
export function NewCampaign({ games, options }: NewCampaignProps) {
  const t = useTranslations("newCampaign");
  const tKind = useTranslations("codex.kind");
  const tr = useRefusal();
  const format = useFormatter();
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("game");
  const [picked, setPicked] = useState<TableMode>("gm");
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [values, setValues] = useState<Readonly<Record<string, CampaignValue>>>({});
  const [premise, setPremise] = useState(NO_PREMISE);
  const [safety, setSafety] = useState<SafetyDraft>(NO_SAFETY);
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const game = games.find((g) => g.key === key);
  const option = key ? options[key] : undefined;
  const mode = startMode(game, picked);
  const steps = WIZARD_STEPS.filter(
    (s) =>
      (s !== "campaign" || Object.keys(option?.campaignFields ?? {}).length > 0) &&
      (s !== "premise" || (option?.premise?.fields.length ?? 0) > 0),
  );
  const at = steps.indexOf(step);
  const name = typed ?? (game ? `${game.title} · ${format.dateTime(new Date(), { weekday: "long" })}` : "");
  const premiseTitle = premise.title || (option?.premise ? tKind(option.premise.kind) : "");

  // A card tapped: a new game, so what was asked of the last one goes; the same card again clears the choice.
  const handleSelect = (g: GameOption | null, wanted: "any" | TableMode) => {
    setKey(g?.key ?? null);
    setTicked([]);
    setValues({});
    setPremise(NO_PREMISE);
    setProblem(null);
    if (wanted !== "any") setPicked(wanted);
  };
  // A pack ticked or unticked; a refusal shown goes, since the draft changed.
  const handlePack = (slug: string) => {
    setProblem(null);
    setTicked((all) => (all.includes(slug) ? all.filter((s) => s !== slug) : [...all, slug]));
  };
  // A campaign value picked.
  const handleValue = ({ id, value }: { id: string; value: CampaignValue }) => {
    setProblem(null);
    setValues({ ...values, [id]: value });
  };
  // The premise's title, or one of its fields, written.
  const handlePremise = (patch: Partial<typeof premise>) => {
    setProblem(null);
    setPremise({ ...premise, ...patch });
  };
  // The way of sitting, or the lines and veils, changed.
  const handleMode = (m: TableMode) => {
    setProblem(null);
    setPicked(m);
  };
  const handleSafety = (next: SafetyDraft) => {
    setProblem(null);
    setSafety(next);
  };
  // The room's name typed.
  const handleName = (text: string) => {
    setProblem(null);
    setTyped(text);
  };
  // BACK and NEXT, and a step's own tab: moves to another step of this game, and brings its tab into view on a narrow
  // strip.
  const go = (to: WizardStep | undefined) => {
    if (!to) return;
    setStep(to);
    setProblem((p) => (p?.step === to ? p : null));
    document.getElementById(`wizard-tab-${to}`)?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  // A refusal, with its path, shown on the step it belongs to.
  const refused = (refusal: RoomImportRefusal | null): Problem =>
    refusal
      ? { step: stepOfPath(refusal.path), message: tr(refusal), path: refusal.path }
      : { step: null, message: t("failed") };
  const show = (p: Problem) => {
    setProblem(p);
    if (p.step && steps.includes(p.step)) setStep(p.step);
  };

  // CREATE: the room as one document, checked here, then a dry run, then the import that makes it; the room's first-run
  // walk opens after.
  const handleCreate = async () => {
    if (!game || !option) return show({ step: "game", message: t("pickGame") });
    setBusy(true);
    setProblem(null);
    try {
      if (!game.moduleVersionId && game.versionId === null && !(await importFreeform())) {
        show({ step: "game", message: t("freeformFailed") });
        return setBusy(false);
      }
      const doc = roomDocument({
        draft: {
          name,
          ruleset: game.moduleVersionId ? null : { slug: game.slug, version: game.version },
          packs: option.packs
            .filter((p) => !p.fromModule && ticked.includes(p.slug))
            .map(({ slug, version }) => ({ slug, version })),
          fields: Object.fromEntries(
            Object.entries(option.campaignFields).map(([id, f]) => [id, values[id] ?? f.default]),
          ),
          premise: option.premise ? { kind: option.premise.kind, title: premiseTitle, fields: premise.fields } : null,
          safety: { lines: toLines(safety.lines), veils: toLines(safety.veils), xCard: safety.xCard },
        },
      });
      const local = documentProblem(doc);
      if (local) {
        show({ step: local.step, message: t(`problems.${local.step ?? "other"}`), path: local.path });
        return setBusy(false);
      }
      const sent = { file: new Blob([JSON.stringify(doc)]), tableMode: mode, module: game.moduleVersionId };
      const dry = await importRoom({ ...sent, dryRun: true });
      if (!dry.ok) {
        show(refused(dry.refusal));
        return setBusy(false);
      }
      const made = await importRoom({ ...sent, dryRun: false });
      if (made.ok && made.reply.campaignId) return router.push(`/c/${made.reply.campaignId}/start`);
      show(made.ok ? { step: null, message: t("failed") } : refused(made.refusal));
    } catch {
      show({ step: null, message: t("failed") });
    }
    setBusy(false);
  };

  const shownProblem = problem && (problem.step === step || problem.step === null) && (
    <p className="error" role="alert">
      {problem.message}
      {problem.path && <span className="small dim"> · {problem.path}</span>}
    </p>
  );

  return (
    <main className="page stack">
      <header className="ws-head">
        <div>
          <h1 className="title">{t("title")}</h1>
          <p className="dim">{t("lede")}</p>
        </div>
        <Link className="btn" href="/">
          {t("cancel")}
        </Link>
      </header>
      <nav className="tabs wizard-tabs" role="tablist" aria-label={t("stepsLabel")}>
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`wizard-tab-${s}`}
            aria-controls="wizard-step"
            className="tab"
            aria-selected={step === s}
            disabled={!game && s !== "game"}
            onClick={() => go(s)}
          >
            {t("stepTab", { n: i + 1, step: t(`steps.${s}`) })}
          </button>
        ))}
      </nav>
      <section
        key={step}
        id="wizard-step"
        className="card stack wizard-step"
        role="tabpanel"
        aria-labelledby={`wizard-tab-${step}`}
      >
        <h2 className="head">{t(`steps.${step}`)}</h2>
        <p className="small dim">{t(`hints.${step}`)}</p>
        {step === "game" && (
          <>
            <GamePicker games={games} selected={key} onSelect={handleSelect} />
            {option && option.packs.length > 0 && (
              <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="head">{t("packs")}</legend>
                <p className="small dim">{t("packsHint")}</p>
                {option.packs.map((p) => (
                  <label key={p.slug} className="row">
                    <input
                      type="checkbox"
                      checked={p.fromModule || ticked.includes(p.slug)}
                      disabled={p.fromModule}
                      onChange={() => handlePack(p.slug)}
                    />
                    <span style={{ overflowWrap: "anywhere" }}>
                      {p.slug} <span className="small dim">{p.version}</span>
                      {p.fromModule && <span className="chip">{t("fromModule")}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {step === "campaign" && option && (
          <CampaignStep fields={option.campaignFields} values={values} onChange={handleValue} />
        )}
        {step === "premise" && option?.premise && (
          <>
            <p className="small">
              {option.premise.step.label}
              {option.premise.step.cite && <span className="dim"> · {option.premise.step.cite}</span>}
            </p>
            <label className="stack">
              {t("premiseTitle")}
              <input value={premiseTitle} maxLength={200} onChange={(e) => handlePremise({ title: e.target.value })} />
            </label>
            <EntryFieldsForm
              ruleset={null}
              fields={option.premise.fields}
              draft={premise.fields}
              onChange={({ id, value }) => handlePremise({ fields: { ...premise.fields, [id]: value } })}
              campaignId=""
              known={[]}
              disabled={busy}
              entryId=""
              entries={[]}
              onOpenEntry={() => undefined}
            />
            <p className="small dim">{t("premiseLater")}</p>
          </>
        )}
        {step === "table" && option && (
          <TableStep
            modes={game?.modes ?? ["gm"]}
            mode={mode}
            onMode={handleMode}
            safety={safety}
            onSafety={handleSafety}
            examples={option.examples}
          />
        )}
        {step === "name" && (
          <label className="stack">
            {t("name")}
            <input value={name} onChange={(e) => handleName(e.target.value)} maxLength={100} />
          </label>
        )}
        {shownProblem}
      </section>
      <div className="row between" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={at <= 0} onClick={() => go(steps[at - 1])}>
          {t("back")}
        </button>
        {at < steps.length - 1 ? (
          <button type="button" className="btn primary" disabled={!game} onClick={() => go(steps[at + 1])}>
            {t("next")}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !game}
            aria-busy={busy}
            onClick={handleCreate}
          >
            {busy ? t("creating") : t("create")}
          </button>
        )}
      </div>
    </main>
  );
}
