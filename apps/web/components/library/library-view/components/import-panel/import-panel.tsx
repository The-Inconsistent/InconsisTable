"use client";
import { useRef, useState, type ChangeEvent } from "react";

import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { locate } from "@/lib/json-locate/json-locate";
import {
  ImportRefusal,
  PackImported,
  RulesetImported,
  kindOf,
  parseErrorAt,
  type Problem,
} from "@/lib/library/library";

import { DIFF_KEYS_SHOWN, IMPORT_ERRORS, MAX_UPLOAD_BYTES, SUMMARY_REMINDER } from "../../constants";
import { ProblemList, type Located } from "../problem-list/problem-list";

type Outcome =
  | { kind: "problems"; problems: Located[]; warnings: Located[] }
  | { kind: "ruleset"; saved: RulesetImported }
  | { kind: "pack"; saved: PackImported }
  | { kind: "error"; message: string };

// A 2xx reply as an outcome, or null when it isn't the shape the api promises.
function savedOutcome({ kind, body }: { kind: "pack" | "ruleset"; body: unknown }): Outcome | null {
  if (kind === "pack") {
    const p = PackImported.safeParse(body);
    return p.success ? { kind, saved: p.data } : null;
  }
  const r = RulesetImported.safeParse(body);
  return r.success ? { kind, saved: r.data } : null;
}

type ImportPanelProps = { onSaved: () => void };

function KeyList({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <details>
      <summary>
        {keys.length} {label}
      </summary>
      <p className="small dim keys">
        {keys.slice(0, DIFF_KEYS_SHOWN).join(", ")}
        {keys.length > DIFF_KEYS_SHOWN && ` and ${keys.length - DIFF_KEYS_SHOWN} more`}
      </p>
    </details>
  );
}

// Paste a ruleset or a pack, or choose its file. The problems come back by path and each one selects its spot in the
// text; nothing is kept of the file but the rows the api writes.
export function ImportPanel({ onSaved }: ImportPanelProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
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

  // FILE: reads the chosen file into the box, so it is checked and imported like pasted text.
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setOutcome({ kind: "error", message: IMPORT_ERRORS.tooBig });
    try {
      setText(await file.text());
      setOutcome(null);
    } catch {
      setOutcome({ kind: "error", message: IMPORT_ERRORS.readFailed });
    }
  };

  // IMPORT: the document goes to the api as it was typed; a refusal lists its problems, a save shows what changed.
  const handleImport = async () => {
    if (new Blob([text]).size > MAX_UPLOAD_BYTES) return setOutcome({ kind: "error", message: IMPORT_ERRORS.tooBig });
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : IMPORT_ERRORS.notJson;
      const at = parseErrorAt({ message, text }) ?? undefined;
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: `${IMPORT_ERRORS.notJson} ${message}`, at }],
        warnings: [],
      });
    }
    const kind = kindOf(doc);
    if (!kind)
      return setOutcome({
        kind: "problems",
        problems: [{ path: "(root)", message: IMPORT_ERRORS.unknownShape }],
        warnings: [],
      });

    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(kind === "pack" ? "/api/packs" : "/api/rulesets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      const body = await readJson(res);
      const saved = res.ok ? savedOutcome({ kind, body }) : null;
      if (saved) {
        setOutcome(saved);
        // Kept when there are warnings, so a tap on one can still find its spot.
        if (saved.kind !== "pack" || saved.saved.warnings.length === 0) setText("");
        onSaved();
      } else {
        const refusal = ImportRefusal.safeParse(body);
        const message = ApiMessage.safeParse(body);
        if (refusal.success)
          setOutcome({ kind: "problems", problems: refusal.data.problems, warnings: refusal.data.warnings });
        else if (res.status === 413) setOutcome({ kind: "error", message: IMPORT_ERRORS.tooBig });
        else if (res.status === 401) setOutcome({ kind: "error", message: IMPORT_ERRORS.signedOut });
        else setOutcome({ kind: "error", message: message.success ? message.data.message : IMPORT_ERRORS.failed });
      }
    } catch {
      setOutcome({ kind: "error", message: IMPORT_ERRORS.failed });
    }
    setBusy(false);
  };

  const warnings: Problem[] =
    outcome?.kind === "pack" ? outcome.saved.warnings : outcome?.kind === "problems" ? outcome.warnings : [];

  return (
    <section className="card import">
      <h2 className="head">Import</h2>
      <p className="reminder" id="import-reminder">
        {SUMMARY_REMINDER}
      </p>
      <label>
        Ruleset or pack (JSON)
        <textarea
          ref={area}
          className="json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          wrap="off"
          spellCheck={false}
          aria-describedby="import-reminder"
          placeholder="Paste JSON here, or choose a file."
        />
      </label>
      <div className="row">
        <button type="button" className="btn primary" onClick={handleImport} disabled={busy || text.trim() === ""}>
          {busy ? "Importing…" : "Import"}
        </button>
        <button type="button" className="btn" onClick={() => picker.current?.click()} disabled={busy}>
          Choose file
        </button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={handleFile} />
        {text !== "" && (
          <button type="button" className="btn" onClick={() => setText("")} disabled={busy}>
            Clear
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
            ? `${outcome.saved.slug} ${outcome.saved.version} was already imported. Nothing changed.`
            : `Saved ${outcome.saved.slug} ${outcome.saved.version}. Pick it when you create a room.`}
        </p>
      )}
      {outcome?.kind === "pack" && (
        <div className="stack saved" role="status">
          <p>
            {outcome.saved.unchanged
              ? `Version ${outcome.saved.version} was already imported. Nothing changed.`
              : `Saved version ${outcome.saved.version}.`}
          </p>
          {!outcome.saved.unchanged && (
            <>
              <p className="diff">
                <span>{outcome.saved.diff.added.length} added</span>
                <span>{outcome.saved.diff.changed.length} changed</span>
                <span>{outcome.saved.diff.removed.length} removed</span>
              </p>
              <KeyList label="added" keys={outcome.saved.diff.added} />
              <KeyList label="changed" keys={outcome.saved.diff.changed} />
              <KeyList label="removed" keys={outcome.saved.diff.removed} />
            </>
          )}
        </div>
      )}
      {outcome?.kind === "problems" && (
        <ProblemList title="Fix these, then import again" items={outcome.problems} tone="error" onPick={handlePick} />
      )}
      <ProblemList
        title={outcome?.kind === "pack" ? "Saved, but check these descriptions" : "Also check these descriptions"}
        items={warnings}
        tone="warn"
        onPick={handlePick}
      />
    </section>
  );
}
