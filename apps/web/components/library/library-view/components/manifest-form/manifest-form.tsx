"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { Problem, Ruleset } from "@inconsistable/rules-engine";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { ImportRefusal, PackImported, RulesetImported, kindOf } from "@/lib/library/library";
import {
  PACK_SECTIONS,
  RULESET_SECTIONS,
  check,
  isHomebrew,
  isPrivate,
  packNeedsCite,
  removeAt,
  sectionOfPack,
  sectionOfRuleset,
  serialize,
  setAt,
  type Doc,
  type FormKind,
  type Path,
} from "@/lib/manifest-form/manifest-form";

import { MAX_UPLOAD_BYTES } from "../../constants";
import { ProblemList } from "../problem-list/problem-list";
import { PackBody } from "./components/pack-sections/pack-sections";
import { RulesetBody } from "./components/ruleset-sections/ruleset-sections";
import { MAX_PROBLEMS_SHOWN, VALIDATE_DEBOUNCE_MS } from "./constants";
import { FormProvider } from "./form-context";

type ManifestFormProps = {
  kind: FormKind;
  initial: Doc;
  /** Opened on something that is already saved: saving adds a version. */
  editing: boolean;
  /** The slugs of the rulesets this user has, offered as the target of a pack. */
  rulesetIds: readonly string[];
  onClose: () => void;
  onSaved: () => void;
};

// The problems under a row of a section are shown by the row; what is left (the section's own keys) is shown here.
const ROW_PATHS: Record<string, RegExp> = {
  about: /^sources\[/,
  fields: /^entities\[/,
  resources: /^resources\[/,
  conditions: /^conditions\[/,
  tests: /^tests\./,
  creation: /^creation\[/,
  board: /^(phases\[|scoring\.endWhen\[)/,
  more: /^(options|decisions)\[/,
  entries: /^entries\[/,
};

type Outcome = { kind: "saved"; text: string } | { kind: "error"; message: string };
const NONE = { problems: [] as Problem[], warnings: [] as Problem[] };

// The whole document as text, for what the form does not model and for a file that is opened as it is.
function JsonTab({
  doc,
  kind,
  onChange,
  onBad,
}: {
  doc: unknown;
  kind: FormKind;
  onChange: (d: unknown) => void;
  onBad: (bad: boolean) => void;
}) {
  const t = useTranslations("manifestForm");
  const picker = useRef<HTMLInputElement>(null);
  const serial = serialize(doc);
  const [draft, setDraft] = useState({ text: serial, applied: serial, error: false });
  // The document changed from a section: show it.
  if (draft.applied !== serial) setDraft({ text: serial, applied: serial, error: false });

  const apply = (text: string) => {
    try {
      const parsed: unknown = JSON.parse(text);
      const shape = kindOf(parsed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      if (shape !== null && shape !== kind) throw new Error("the other kind of document");
      setDraft({ text, applied: serialize(parsed), error: false });
      onBad(false);
      onChange(parsed);
    } catch {
      setDraft((d) => ({ ...d, text, error: true }));
      onBad(true);
    }
  };
  // FILE: opens an existing document in the form.
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || file.size > MAX_UPLOAD_BYTES) return;
    try {
      apply(await file.text());
    } catch {
      onBad(true);
    }
  };
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn sm" onClick={() => picker.current?.click()}>
          {t("openFile")}
        </button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={handleFile} />
      </div>
      <label className="mf-field">
        <span>{t("jsonLabel")}</span>
        <textarea
          className="json mf-json"
          value={draft.text}
          onChange={(e) => apply(e.target.value)}
          wrap="off"
          spellCheck={false}
          aria-invalid={draft.error || undefined}
        />
      </label>
      {draft.error && (
        <p className="mf-warn" role="alert">
          {t("jsonBad")}
        </p>
      )}
    </div>
  );
}

// NEW / EDIT a ruleset or a pack: a view over its JSON. The document is the state; the validator the api shares runs
// on it after each pause, and Save sends the document to the same endpoint the paste box uses.
export function ManifestForm({ kind, initial, editing, rulesetIds, onClose, onSaved }: ManifestFormProps) {
  const t = useTranslations("manifestForm");
  const tImport = useTranslations("importPanel");
  const tr = useRefusal();
  const sections = kind === "pack" ? PACK_SECTIONS : RULESET_SECTIONS;
  const [doc, setDoc] = useState<unknown>(initial);
  const [target, setTarget] = useState<Ruleset | null>(null);
  const [section, setSection] = useState<string>("about");
  const [checked, setChecked] = useState(() => ({
    doc: initial as unknown,
    target: null as Ruleset | null,
    ...check({ kind, doc: initial }),
  }));
  const [server, setServer] = useState(NONE);
  const [jsonBad, setJsonBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    // Syncs with a timer: the validator runs once typing pauses, not on every key.
    const id = setTimeout(() => setChecked({ doc, target, ...check({ kind, doc, target }) }), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [doc, target, kind]);

  const sectionLabel = (s: string) =>
    kind === "pack"
      ? t(`sections.pack.${s as (typeof PACK_SECTIONS)[number]}`)
      : t(`sections.ruleset.${s as (typeof RULESET_SECTIONS)[number]}`);
  const settled = checked.doc === doc && checked.target === target;
  const problems = checked.problems.length > 0 ? checked.problems : server.problems;
  const warnings = checked.warnings.length > 0 ? checked.warnings : server.warnings;
  const sectionOf = kind === "pack" ? sectionOfPack : sectionOfRuleset;

  const changed = () => {
    setServer(NONE);
    setOutcome(null);
  };
  const edit = (fn: (d: unknown) => unknown) => {
    setDoc(fn);
    changed();
  };
  const state = {
    kind,
    doc,
    problems,
    warnings,
    citeOptional: kind === "pack" ? !packNeedsCite({ doc, target }) : isHomebrew(doc),
    priv: isPrivate({ kind, doc }),
    target,
    rulesetIds,
    set: (path: Path, value: unknown) => edit((d) => setAt({ doc: d, path, value })),
    remove: (path: Path) => edit((d) => removeAt({ doc: d, path })),
    edit,
  };

  const handleTab = (s: string) => {
    setSection(s);
    setJsonBad(false);
  };

  // SAVE: the document goes to the api as it stands; a refusal lists its problems here, in the same places.
  const handleSave = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(kind === "pack" ? "/api/packs" : "/api/rulesets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc),
      });
      const body = await readJson(res);
      const ruleset = res.ok && kind === "ruleset" ? RulesetImported.safeParse(body) : null;
      const pack = res.ok && kind === "pack" ? PackImported.safeParse(body) : null;
      if (ruleset?.success) {
        const { slug, version, unchanged } = ruleset.data;
        setOutcome({
          kind: "saved",
          text: tImport(unchanged ? "rulesetUnchanged" : "rulesetSaved", { slug, version }),
        });
        onSaved();
      } else if (pack?.success) {
        const { version, unchanged, warnings: kept } = pack.data;
        setOutcome({ kind: "saved", text: tImport(unchanged ? "packUnchanged" : "packSaved", { version }) });
        setServer({ problems: [], warnings: kept });
        onSaved();
      } else {
        const refusal = ImportRefusal.safeParse(body);
        const message = ApiMessage.safeParse(body);
        if (refusal.success) setServer({ problems: refusal.data.problems, warnings: refusal.data.warnings });
        else if (res.status === 413) setOutcome({ kind: "error", message: tImport("tooBig") });
        else if (res.status === 401) setOutcome({ kind: "error", message: tImport("signedOut") });
        else setOutcome({ kind: "error", message: message.success ? tr(message.data) : tImport("failed") });
      }
    } catch {
      setOutcome({ kind: "error", message: tImport("failed") });
    }
    setBusy(false);
  };

  const canSave = settled && problems.length === 0 && !jsonBad && !busy;
  const countIn = (s: string) => problems.filter((p) => sectionOf(p.path) === s).length;
  const rowPath = ROW_PATHS[section];
  const leftover = problems.filter((p) => sectionOf(p.path) === section && !rowPath?.test(p.path));
  const rawId = typeof (doc as Doc | null)?.id === "string" ? ((doc as Doc).id as string) : "";
  const titleKey = editing
    ? kind === "pack"
      ? "editPack"
      : "editRuleset"
    : kind === "pack"
      ? "newPack"
      : "newRuleset";

  return (
    <section id="manifest-form" className="card mf" aria-label={t(titleKey, { id: rawId })}>
      <header className="mf-head">
        <h2 className="head">{t(titleKey, { id: rawId })}</h2>
        <div className="row">
          <span className="mf-status" role="status" data-state={problems.length > 0 ? "bad" : "ok"}>
            {!settled
              ? t("checking")
              : problems.length > 0
                ? t("problemCount", { count: problems.length })
                : t("noProblems")}
          </span>
          <button type="button" className="btn primary" onClick={handleSave} disabled={!canSave}>
            {busy ? tImport("importing") : t("save")}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </header>

      {outcome?.kind === "saved" && (
        <p className="saved" role="status">
          {outcome.text}
        </p>
      )}
      {outcome?.kind === "error" && (
        <p className="error" role="alert">
          {outcome.message}
        </p>
      )}
      <ProblemList
        title={t("fixThese")}
        items={problems.slice(0, MAX_PROBLEMS_SHOWN)}
        tone="error"
        onPick={(item) => handleTab(sectionOf(item.path))}
      />
      <ProblemList
        title={t("checkThese")}
        items={warnings.slice(0, MAX_PROBLEMS_SHOWN)}
        tone="warn"
        onPick={(item) => handleTab(sectionOf(item.path))}
      />

      <div className="mf-body">
        <nav className="mf-tabs" role="tablist" aria-label={t("sectionsLabel")}>
          {sections.map((s) => {
            const n = countIn(s);
            return (
              <button
                key={s}
                type="button"
                role="tab"
                id={`mf-tab-${s}`}
                aria-selected={section === s}
                aria-controls="mf-panel"
                className="mf-tab"
                onClick={() => handleTab(s)}
              >
                {sectionLabel(s)}
                {n > 0 && (
                  <span className="mf-count" aria-label={t("problemCount", { count: n })}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mf-panel stack" role="tabpanel" id="mf-panel" aria-labelledby={`mf-tab-${section}`}>
          <FormProvider value={state}>
            {leftover.length > 0 && (
              <ul className="mf-problems">
                {leftover.map((p, i) => (
                  <li key={`${p.path}-${i}`} data-tone="error">
                    <code>{p.path}</code> {p.message}
                  </li>
                ))}
              </ul>
            )}
            {section === "json" ? (
              <JsonTab doc={doc} kind={kind} onChange={(d) => edit(() => d)} onBad={setJsonBad} />
            ) : kind === "pack" ? (
              <PackBody section={section as (typeof PACK_SECTIONS)[number]} target={target} onTarget={setTarget} />
            ) : (
              <RulesetBody section={section as (typeof RULESET_SECTIONS)[number]} />
            )}
          </FormProvider>
        </div>
      </div>
    </section>
  );
}
