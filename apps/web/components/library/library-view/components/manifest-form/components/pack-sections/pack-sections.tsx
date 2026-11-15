"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";

import { validateRuleset, type FieldDef, type Ruleset } from "@inconsistable/rules-engine";

import { getAt, type PackSection } from "@/lib/manifest-form/manifest-form";

import { MAX_UPLOAD_BYTES } from "../../../../constants";
import { ENTRY_SPECS, PACK_SPECS, PACK_TARGET_SPECS } from "../../constants";
import { useForm } from "../../form-context";
import { Block, Fields, RawField, Rows, type Spec } from "../form-fields/form-fields";

type TargetProps = { target: Ruleset | null; onTarget: (r: Ruleset | null) => void };

// The ruleset the pack is written for, loaded so entries are checked against its entity types and fields.
// ponytail: no api route returns an owner's ruleset manifest outside a room, so the owner brings it (paste or file);
// a read route for the owner's own ruleset version lets the form load it from the library by itself.
function TargetLoader({ target, onTarget }: TargetProps) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (text: string) => {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return setError(t("targetNotJson"));
    }
    const r = validateRuleset(doc);
    if (!r.ok) return setError(t("targetInvalid", { count: r.problems.length }));
    setError(null);
    onTarget(r.ruleset);
  };
  // FILE: reads the ruleset's JSON file.
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError(t("targetTooBig"));
    try {
      load(await file.text());
    } catch {
      setError(t("targetUnreadable"));
    }
  };
  const handlePaste = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.trim() !== "") load(e.target.value);
  };

  return (
    <Block title={t("blocks.target")}>
      <p className="small dim">
        {target ? t("targetLoaded", { id: target.id, version: target.version }) : t("targetNone")}
      </p>
      {form.rulesetIds.length > 0 && (
        <div className="row" role="group" aria-label={t("targetPickLabel")}>
          {form.rulesetIds.map((id) => (
            <button key={id} type="button" className="btn sm" onClick={() => form.set(["ruleset", "id"], id)}>
              {id}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn sm" onClick={() => picker.current?.click()}>
          {t("targetChoose")}
        </button>
        {target && (
          <button type="button" className="btn sm" onClick={() => onTarget(null)}>
            {t("targetClear")}
          </button>
        )}
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={handleFile} />
      </div>
      <label className="mf-field">
        <span>{t("targetPaste")}</span>
        <textarea className="json" rows={3} wrap="off" spellCheck={false} onChange={handlePaste} />
      </label>
      {error && (
        <p className="mf-warn" role="alert">
          {error}
        </p>
      )}
    </Block>
  );
}

function About(props: TargetProps) {
  const t = useTranslations("manifestForm");
  return (
    <>
      <Fields path={[]} specs={PACK_SPECS} />
      <Block title={t("blocks.writtenFor")}>
        <Fields path={["ruleset"]} specs={PACK_TARGET_SPECS} />
      </Block>
      <TargetLoader {...props} />
      <RawField path={[]} field="sources" />
    </>
  );
}

// A body field's control, from the ruleset's own definition of the field. Values the engine's field types cannot say
// through a box (none today) stay in the raw JSON beneath.
function bodySpec({ id, def }: { id: string; def: FieldDef }): Spec {
  const base = { key: id, text: def.label, optional: true } as const;
  switch (def.type) {
    case "int":
      return { ...base, kind: "int" };
    case "enum":
      return { ...base, kind: "select", options: def.values };
    case "bool":
      return { ...base, kind: "bool" };
    case "list":
      return { ...base, kind: "csv" };
    case "text":
      return { ...base, kind: def.maxLength === undefined || def.maxLength > 200 ? "summary" : "text" };
    default:
      return { ...base, kind: "text" };
  }
}

function Entries({ target }: { target: Ruleset | null }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const types = target?.entities.map((e) => e.id) ?? [];
  const specs = ENTRY_SPECS.map((s) =>
    s.key === "type" && target ? { ...s, kind: "select" as const, options: types } : s,
  );
  return (
    <Rows path={["entries"]} make={() => ({ key: "", type: types[0] ?? "", name: "" })} hide={[".body"]}>
      {(p) => {
        const type = getAt(form.doc, [...p, "type"]);
        const entity = target?.entities.find((e) => e.id === type);
        const fields = entity ? Object.entries(entity.fields) : [];
        return (
          <>
            <Fields path={p} specs={specs} />
            {fields.length > 0 && (
              <Block title={t("blocks.body")}>
                <Fields path={[...p, "body"]} specs={fields.map(([id, def]) => bodySpec({ id, def }))} />
              </Block>
            )}
            <details className="mf-raw-details">
              <summary>{t("bodyAsJson")}</summary>
              <RawField path={p} field="body" />
            </details>
          </>
        );
      }}
    </Rows>
  );
}

/** The body of one section of the pack form (everything but the JSON tab). */
export function PackBody({ section, target, onTarget }: TargetProps & { section: PackSection }) {
  if (section === "about") return <About target={target} onTarget={onTarget} />;
  if (section === "entries") return <Entries target={target} />;
  return null;
}
