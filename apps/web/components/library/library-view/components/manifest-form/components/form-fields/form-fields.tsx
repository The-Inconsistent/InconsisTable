"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import { formatPath } from "@inconsistable/rules-engine";

import { getAt, longTextWarning, problemsUnder, renameKey, setAt, type Path } from "@/lib/manifest-form/manifest-form";

import type { LabelKey } from "../../constants";
import { useForm } from "../../form-context";

export type Spec = {
  key: string;
  kind: "text" | "expr" | "int" | "bool" | "select" | "csv" | "cite" | "summary";
  options?: readonly string[];
  /** Cleared means the key is left out of the document. */
  optional?: boolean;
  /** A cite the validator asks for (a rule entry), as against one that is only welcome. */
  required?: boolean;
  /** A bool the schema defaults to true: shown checked until the document says otherwise. */
  defaultOn?: boolean;
  /** A csv field of numbers rather than words. */
  numbers?: boolean;
  /** A label that is the user's own content (a field of their ruleset), shown as it is. */
  text?: string;
};

const asText = (v: unknown) => (typeof v === "string" ? v : "");

// A comma-separated field keeps what is being typed until it loses focus: parsing on every key would eat the comma.
function CsvInput({ id, spec, path }: { id: string; spec: Spec; path: Path }) {
  const form = useForm();
  const value = getAt(form.doc, path);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = Array.isArray(value) ? value.join(", ") : "";
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    const parts = e.target.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const items = spec.numbers ? parts.map(Number).filter((n) => Number.isFinite(n)) : parts;
    form.set(path, items.length === 0 && spec.optional ? undefined : items);
  };
  return (
    <input id={id} value={draft ?? shown} onChange={handleChange} onBlur={() => setDraft(null)} spellCheck={false} />
  );
}

/** One control for one key of the object at `path`, by the kind of its value. Writes the document on every change. */
export function Field({ path, spec }: { path: Path; spec: Spec }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const id = useId();
  const full = [...path, spec.key];
  const value = getAt(form.doc, full);
  const invalid = problemsUnder({ problems: form.problems, prefix: formatPath(full) }).length > 0;
  const label = spec.text ?? t(`f.${spec.key as LabelKey}`);
  const hintId = `${id}-hint`;
  const kind = spec.kind;

  // A text-like control: an empty box on an optional key leaves the key out.
  const handleText = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    form.set(full, v === "" && spec.optional ? undefined : v);
  };
  const handleInt = (e: ChangeEvent<HTMLInputElement>) =>
    form.set(full, e.target.value === "" ? undefined : Number(e.target.value));

  if (kind === "bool") {
    return (
      <div className="mf-field" data-kind="bool">
        <label className="mf-check">
          <input
            type="checkbox"
            checked={value === undefined ? spec.defaultOn === true : value === true}
            onChange={(e) => form.set(full, e.target.checked)}
          />
          {label}
        </label>
      </div>
    );
  }

  let control: ReactNode;
  if (kind === "select") {
    const current = asText(value);
    control = (
      <select id={id} value={current} onChange={handleText} aria-invalid={invalid || undefined}>
        {(spec.optional || current === "") && <option value="">{t("choose")}</option>}
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (kind === "csv") {
    control = <CsvInput id={id} spec={spec} path={full} />;
  } else if (kind === "int") {
    control = (
      <input
        id={id}
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={handleInt}
        aria-invalid={invalid || undefined}
      />
    );
  } else if (kind === "summary") {
    const text = asText(value);
    control = (
      <textarea
        id={id}
        rows={2}
        value={text}
        onChange={handleText}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
      />
    );
  } else {
    control = (
      <input
        id={id}
        className={kind === "expr" ? "mf-expr" : undefined}
        value={asText(value)}
        onChange={handleText}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={kind === "cite" ? hintId : undefined}
        placeholder={kind === "cite" ? t("citePlaceholder") : undefined}
      />
    );
  }

  return (
    <div className="mf-field" data-kind={kind}>
      <label htmlFor={id}>{label}</label>
      {control}
      {kind === "cite" && (
        <p className="mf-hint" id={hintId}>
          {t(form.citeOptional ? "citeHintOptional" : "citeHint")}
        </p>
      )}
      {kind === "summary" && (
        <p className="mf-hint" id={hintId}>
          {t("summaryHint")}
        </p>
      )}
      {kind === "summary" && longTextWarning({ text: asText(value), priv: form.priv }) && (
        <p className="mf-warn" role="status">
          {t("longText")}
        </p>
      )}
    </div>
  );
}

/** Several fields of one object in a wrapping grid. */
export function Fields({ path, specs, lead }: { path: Path; specs: readonly Spec[]; lead?: ReactNode }) {
  return (
    <div className="mf-grid">
      {lead}
      {specs.map((s) => (
        <Field key={s.key} path={path} spec={s} />
      ))}
    </div>
  );
}

const pretty = (v: unknown) => (v === undefined ? "" : JSON.stringify(v, null, 2));

/** The escape hatch: a slice of the document as JSON, for what the form does not model. Never a dead end. */
export function RawField({ path, field }: { path: Path; field: string }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const id = useId();
  const full = [...path, field];
  const value = getAt(form.doc, full);
  const serial = JSON.stringify(value) ?? "";
  const [draft, setDraft] = useState({ text: pretty(value), applied: serial, bad: false });
  // The document changed from somewhere else (the JSON tab, a removed row): show it.
  if (draft.applied !== serial) setDraft({ text: pretty(value), applied: serial, bad: false });

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (text.trim() === "") {
      setDraft({ text, applied: "", bad: false });
      form.set(full, undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      setDraft({ text, applied: JSON.stringify(parsed), bad: false });
      form.set(full, parsed);
    } catch {
      setDraft({ ...draft, text, bad: true });
    }
  };
  return (
    <div className="mf-field mf-raw" data-kind="raw">
      <label htmlFor={id}>
        {t(`f.${field as LabelKey}`)} <span className="dim">{t("rawTag")}</span>
      </label>
      <textarea
        id={id}
        className="json"
        rows={Math.min(10, Math.max(3, draft.text.split("\n").length))}
        value={draft.text}
        onChange={handleChange}
        wrap="off"
        spellCheck={false}
        aria-invalid={draft.bad || undefined}
      />
      {draft.bad && (
        <p className="mf-warn" role="status">
          {t("rawBad")}
        </p>
      )}
    </div>
  );
}

/** A checkbox that adds or removes a whole optional block (`game`, `scoring`, a Test's degrees). */
export function Toggle({ path, make, label }: { path: Path; make: () => unknown; label: string }) {
  const form = useForm();
  const on = getAt(form.doc, path) !== undefined;
  const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
    e.target.checked ? form.set(path, make()) : form.remove(path);
  return (
    <label className="mf-check">
      <input type="checkbox" checked={on} onChange={handleChange} />
      {label}
    </label>
  );
}

/** What the validator said about the row at `prefix`, minus the parts a nested list shows for itself. */
function RowProblems({ prefix, hide = [] }: { prefix: string; hide?: readonly string[] }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const shown = [
    ...problemsUnder({ problems: form.problems, prefix }).map((p) => ({ p, tone: "error" as const })),
    ...problemsUnder({ problems: form.warnings, prefix }).map((p) => ({ p, tone: "warn" as const })),
  ].filter(({ p }) => !hide.some((h) => p.path.startsWith(`${prefix}${h}`)));
  if (shown.length === 0) return null;
  return (
    <ul className="mf-problems">
      {shown.map(({ p, tone }, i) => (
        <li key={`${p.path}-${i}`} data-tone={tone}>
          <code>{p.path.slice(prefix.length).replace(/^\./, "") || t("thisRow")}</code> {p.message}
        </li>
      ))}
    </ul>
  );
}

function RowShell({
  prefix,
  name,
  head,
  hide,
  onRemove,
  children,
}: {
  prefix: string;
  name: string;
  head?: ReactNode;
  hide?: readonly string[];
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const bad = problemsUnder({ problems: form.problems, prefix }).length > 0;
  return (
    <li className="mf-row" data-invalid={bad || undefined}>
      <div className="mf-row-head">
        {head ?? <strong className="mf-row-name">{name}</strong>}
        <button type="button" className="btn sm" aria-label={t("removeRow", { name })} onClick={onRemove}>
          {t("remove")}
        </button>
      </div>
      {children}
      <RowProblems prefix={prefix} hide={hide} />
    </li>
  );
}

const nameOf = (item: unknown, i: number) => {
  const raw = getAt(item, ["id"]) ?? getAt(item, ["key"]) ?? getAt(item, ["label"]);
  return typeof raw === "string" && raw !== "" ? raw : `#${i + 1}`;
};

// Enter in a text box of the last row adds the next one, so a list is typed without leaving the keyboard.
function useEnterAdds({ add }: { add: () => void }) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target;
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !(el instanceof HTMLInputElement)) return;
    if (el.type === "checkbox") return;
    const row = el.closest("li.mf-row");
    if (!row || row !== row.parentElement?.lastElementChild) return;
    e.preventDefault();
    e.stopPropagation();
    add();
  };
}

// After a row is added by the button or Enter, the cursor goes into its first box.
function useFocusNew({ length, list }: { length: number; list: React.RefObject<HTMLOListElement | null> }) {
  const pending = useRef(false);
  useEffect(() => {
    // Syncs with the DOM: focus is not React state.
    if (!pending.current) return;
    pending.current = false;
    list.current?.querySelector<HTMLElement>(":scope > li:last-child input, :scope > li:last-child select")?.focus();
  }, [length, list]);
  return () => {
    pending.current = true;
  };
}

type RowsProps = {
  /** The array in the document. */
  path: Path;
  make: () => unknown;
  hide?: readonly string[];
  children: (path: Path, i: number) => ReactNode;
};

/** The rows of an array: a row each, Remove on every one, Add below. */
export function Rows({ path, make, hide, children }: RowsProps) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const value = getAt(form.doc, path);
  const list = Array.isArray(value) ? (value as unknown[]) : [];
  const ref = useRef<HTMLOListElement>(null);
  const markNew = useFocusNew({ length: list.length, list: ref });
  const add = () => {
    markNew();
    form.set([...path, list.length], make());
  };
  const handleKey = useEnterAdds({ add });
  return (
    <div className="mf-list">
      {list.length > 0 && (
        <ol className="mf-rows" ref={ref} onKeyDown={handleKey}>
          {list.map((item, i) => (
            <RowShell
              // ponytail: rows are keyed by position, so removing one in the middle re-uses the boxes below it; fine
              // for a form that is rewritten from the document on every change, upgrade to a stable row id if needed.
              key={i}
              prefix={formatPath([...path, i])}
              name={nameOf(item, i)}
              hide={hide}
              onRemove={() => form.remove([...path, i])}
            >
              {children([...path, i], i)}
            </RowShell>
          ))}
        </ol>
      )}
      <button type="button" className="btn sm" onClick={add}>
        {t("add")}
      </button>
    </div>
  );
}

type KeyedRowsProps = {
  /** The object in the document whose keys are the rows' ids (fields of an entity, a ruleset's Tests). */
  path: Path;
  make: () => unknown;
  /** The start of a name for a new row: `field` gives field1, field2... */
  newKey: string;
  hide?: readonly string[];
  children: (path: Path, key: string) => ReactNode;
};

/** The rows of an object keyed by id: the key is a box in the row's head, and renaming keeps the row in place. */
export function KeyedRows({ path, make, newKey, hide, children }: KeyedRowsProps) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const value = getAt(form.doc, path);
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const keys = Object.keys(record);
  const ref = useRef<HTMLOListElement>(null);
  const markNew = useFocusNew({ length: keys.length, list: ref });
  const add = () => {
    let n = keys.length + 1;
    while (keys.includes(`${newKey}${n}`)) n++;
    markNew();
    form.set([...path, `${newKey}${n}`], make());
  };
  const handleKey = useEnterAdds({ add });
  // A rename that would land on another row's key is ignored, so no row is ever overwritten.
  const rename = ({ from, to }: { from: string; to: string }) => {
    if (to !== from && keys.includes(to)) return;
    form.edit((doc) => {
      const obj = getAt(doc, path);
      return setAt({ doc, path, value: renameKey({ obj: obj as Record<string, unknown>, from, to }) });
    });
  };
  return (
    <div className="mf-list">
      {keys.length > 0 && (
        <ol className="mf-rows" ref={ref} onKeyDown={handleKey}>
          {keys.map((key, i) => (
            <RowShell
              key={i}
              prefix={formatPath([...path, key])}
              name={key}
              hide={hide}
              onRemove={() => form.remove([...path, key])}
              head={
                <label className="mf-key">
                  <span>{t("f.key")}</span>
                  <input
                    className="mf-expr"
                    value={key}
                    onChange={(e) => rename({ from: key, to: e.target.value })}
                    spellCheck={false}
                  />
                </label>
              }
            >
              {children([...path, key], key)}
            </RowShell>
          ))}
        </ol>
      )}
      <button type="button" className="btn sm" onClick={add}>
        {t("add")}
      </button>
    </div>
  );
}

/** A select that is not a plain key: picking changes the shape around it (a Test's kind, a field's type). */
export function Pick({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onPick: (v: string) => void;
}) {
  const t = useTranslations("manifestForm");
  const id = useId();
  return (
    <div className="mf-field" data-kind="select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)}>
        {!options.includes(value) && <option value="">{t("choose")}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A titled part of a section. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mf-block">
      <h4 className="mf-block-title">{title}</h4>
      {children}
    </section>
  );
}
