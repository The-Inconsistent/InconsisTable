"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";

import { validateWorld } from "@inconsistable/rules-engine";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { locate } from "@/lib/json-locate/json-locate";
import type { Doc } from "@/lib/manifest-form/manifest-form";
import { TEMPLATE_IDS, templateText, type TemplateId } from "@/lib/templates/templates";
import {
  ImportRefusal,
  ModuleImported,
  PackImported,
  RulesetImported,
  WorldImported,
  kindOf,
  parseErrorAt,
  type ImportKind,
  type Problem,
} from "@/lib/library/library";

import { DIFF_KEYS_SHOWN, MAX_UPLOAD_BYTES } from "../../constants";
import { ProblemList, type Located } from "../problem-list/problem-list";

type Outcome =
  | { kind: "problems"; problems: Located[]; warnings: Located[] }
  | { kind: "ruleset"; saved: RulesetImported }
  | { kind: "pack"; saved: PackImported }
  | { kind: "world"; saved: WorldImported }
  | { kind: "module"; saved: ModuleImported }
  | { kind: "error"; message: string };

// A 2xx reply as an outcome, or null when it isn't the shape the api promises.
function savedOutcome({ kind, body }: { kind: ImportKind; body: unknown }): Outcome | null {
  if (kind === "module") {
    const m = ModuleImported.safeParse(body);
    return m.success ? { kind, saved: m.data } : null;
  }
  if (kind === "world") {
    const w = WorldImported.safeParse(body);
    return w.success ? { kind, saved: w.data } : null;
  }
  if (kind === "pack") {
    const p = PackImported.safeParse(body);
    return p.success ? { kind, saved: p.data } : null;
  }
  const r = RulesetImported.safeParse(body);
  return r.success ? { kind, saved: r.data } : null;
}

type ImportPanelProps = {
  onSaved: () => void;
  autoFocus?: boolean;
  /** Opens the text in the guided form instead of importing it. */
  onOpenForm: (open: { kind: "ruleset" | "pack"; doc: Doc }) => void;
};

function KeyList({ kind, keys }: { kind: "added" | "changed" | "removed"; keys: string[] }) {
  const t = useTranslations("importPanel");
  if (keys.length === 0) return null;
  return (
    <details>
      <summary>{t(kind, { count: keys.length })}</summary>
      <p className="small dim keys">
        {keys.slice(0, DIFF_KEYS_SHOWN).join(", ")}
        {keys.length > DIFF_KEYS_SHOWN && ` ${t("moreKeys", { count: keys.length - DIFF_KEYS_SHOWN })}`}
      </p>
    </details>
  );
}

// Paste a ruleset, a pack or a World, or choose its file. The problems come back by path and each one selects its spot in the
// text; nothing is kept of the file but the rows the api writes.
export function ImportPanel({ onSaved, autoFocus, onOpenForm }: ImportPanelProps) {
  const t = useTranslations("importPanel");
  const tr = useRefusal();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // A problem row: select its spot in the text and scroll the box to it.
  const handlePick = (item: Located) => {
    const box = area.current;
    if (!box) return;
    const span = item.at === undefined ? locate(text, item.path) : { start: item.at, end: item.at + 1 };
    box.focus();
    box.setSelectionRange(span.start, span.end);
    const line = text.slice(0, span.start).split("\n").length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(box).lineHeight) || 20;
    box.scrollTop = Math.max(0, (line - 3) * lineHeight);
  };

  // START FROM A TEMPLATE: fills the box with the family's skeleton; the check on import lists what is still missing.
  const handleTemplate = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = TEMPLATE_IDS.find((x) => x === e.target.value);
    if (!id) return;
    setText(templateText(id));
    setTemplateId(id);
    setOutcome(null);
  };

  // FILE: reads the chosen file into the box, so it is checked and imported like pasted text.
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setOutcome({ kind: "error", message: t("tooBig") });
    try {
      setText(await file.text());
      setOutcome(null);
    } catch {
      setOutcome({ kind: "error", message: t("readFailed") });
    }
  };

  // OPEN IN FORM: the text, a template or a draft, is filled in with the guided form instead of imported as it is.
  const handleOpenForm = () => {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const at = parseErrorAt({ message, text }) ?? undefined;
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: `${t("notJson")} ${message}`.trim(), at }],
        warnings: [],
      });
    }
    const kind = kindOf(doc);
    // A World and a game module have no form: their JSON is imported and exported as it is.
    if (kind === "world" || kind === "module")
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: t(kind === "world" ? "worldNoForm" : "moduleNoForm") }],
        warnings: [],
      });
    if (!kind || typeof doc !== "object" || doc === null)
      return setOutcome({ kind: "problems", problems: [{ path: "(root)", message: t("unknownShape") }], warnings: [] });
    onOpenForm({ kind, doc: doc as Doc });
  };

  // IMPORT: the document goes to the api as it was typed; a refusal lists its problems, a save shows what changed.
  const handleImport = async () => {
    if (new Blob([text]).size > MAX_UPLOAD_BYTES) return setOutcome({ kind: "error", message: t("tooBig") });
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      // The parser's own message is the engine's English; the line before it is ours.
      const message = e instanceof Error ? e.message : "";
      const at = parseErrorAt({ message, text }) ?? undefined;
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: `${t("notJson")} ${message}`.trim(), at }],
        warnings: [],
      });
    }
    const kind = kindOf(doc);
    if (!kind)
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: t("unknownShape") }],
        warnings: [],
      });
    // A World is checked on the device first, so a pair under its floor shows by path before anything is sent.
    if (kind === "world") {
      const checked = validateWorld(doc);
      if (!checked.ok) return setOutcome({ kind: "problems", problems: checked.problems, warnings: [] });
    }

    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/${kind}s`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const body = await readJson(res);
      const saved = res.ok ? savedOutcome({ kind, body }) : null;
      if (saved) {
        setOutcome(saved);
        // Kept when there are warnings, so a tap on one can still find its spot.
        if ((saved.kind !== "pack" && saved.kind !== "module") || saved.saved.warnings.length === 0) setText("");
        onSaved();
      } else {
        const refusal = ImportRefusal.safeParse(body);
        const message = ApiMessage.safeParse(body);
        if (refusal.success)
          setOutcome({ kind: "problems", problems: refusal.data.problems, warnings: refusal.data.warnings });
        else if (res.status === 413) setOutcome({ kind: "error", message: t("tooBig") });
        else if (res.status === 401) setOutcome({ kind: "error", message: t("signedOut") });
        else setOutcome({ kind: "error", message: message.success ? tr(message.data) : t("failed") });
      }
    } catch {
      setOutcome({ kind: "error", message: t("failed") });
    }
    setBusy(false);
  };

  const warnings: Problem[] =
    outcome?.kind === "pack" || outcome?.kind === "module"
      ? outcome.saved.warnings
      : outcome?.kind === "problems"
        ? outcome.warnings
        : [];

  return (
    <section id="import-panel" className="card import">
      <h2 className="head">{t("title")}</h2>
      <p className="reminder" id="import-reminder">
        {t("reminder")}
      </p>
      <label>
        {t("template")}
        <select value="" onChange={handleTemplate} disabled={busy}>
          <option value="">{t("templateNone")}</option>
          {TEMPLATE_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`templates.${id}`)}
            </option>
          ))}
        </select>
      </label>
      {templateId && <p className="small dim">{t(`templateNotes.${templateId}`)}</p>}
      <label>
        {t("fieldLabel")}
        <textarea
          ref={area}
          className="json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          wrap="off"
          spellCheck={false}
          aria-describedby="import-reminder"
          placeholder={t("placeholder")}
          autoFocus={autoFocus}
        />
      </label>
      <div className="row">
        <button type="button" className="btn primary" onClick={handleImport} disabled={busy || text.trim() === ""}>
          {busy ? t("importing") : t("import")}
        </button>
        <button type="button" className="btn" onClick={handleOpenForm} disabled={busy || text.trim() === ""}>
          {t("openInForm")}
        </button>
        <button type="button" className="btn" onClick={() => picker.current?.click()} disabled={busy}>
          {t("chooseFile")}
        </button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={handleFile} />
        {text !== "" && (
          <button type="button" className="btn" onClick={() => setText("")} disabled={busy}>
            {t("clear")}
          </button>
        )}
      </div>

      {outcome?.kind === "error" && (
        <p className="error" role="alert">
          {outcome.message}
        </p>
      )}
      {outcome?.kind === "ruleset" && (
        <p className="saved" role="status">
          {outcome.saved.unchanged
            ? t("rulesetUnchanged", { slug: outcome.saved.slug, version: outcome.saved.version })
            : t("rulesetSaved", { slug: outcome.saved.slug, version: outcome.saved.version })}
        </p>
      )}
      {outcome?.kind === "world" && (
        <p className="saved" role="status">
          {outcome.saved.unchanged
            ? t("worldUnchanged", { slug: outcome.saved.slug, version: outcome.saved.version })
            : t("worldSaved", { slug: outcome.saved.slug, version: outcome.saved.version })}
        </p>
      )}
      {outcome?.kind === "module" && (
        <p className="saved" role="status">
          {outcome.saved.unchanged
            ? t("moduleUnchanged", { slug: outcome.saved.slug, version: outcome.saved.version })
            : t("moduleSaved", { slug: outcome.saved.slug, version: outcome.saved.version })}
        </p>
      )}
      {outcome?.kind === "pack" && (
        <div className="stack saved" role="status">
          <p>
            {outcome.saved.unchanged
              ? t("packUnchanged", { version: outcome.saved.version })
              : t("packSaved", { version: outcome.saved.version })}
          </p>
          {!outcome.saved.unchanged && (
            <>
              <p className="diff">
                <span>{t("added", { count: outcome.saved.diff.added.length })}</span>
                <span>{t("changed", { count: outcome.saved.diff.changed.length })}</span>
                <span>{t("removed", { count: outcome.saved.diff.removed.length })}</span>
              </p>
              <KeyList kind="added" keys={outcome.saved.diff.added} />
              <KeyList kind="changed" keys={outcome.saved.diff.changed} />
              <KeyList kind="removed" keys={outcome.saved.diff.removed} />
            </>
          )}
        </div>
      )}
      {outcome?.kind === "problems" && (
        <ProblemList title={t("fixThese")} items={outcome.problems} tone="error" onPick={handlePick} />
      )}
      <ProblemList
        title={outcome?.kind === "pack" || outcome?.kind === "module" ? t("warnSaved") : t("warnAlso")}
        items={warnings}
        tone="warn"
        onPick={handlePick}
      />
    </section>
  );
}
