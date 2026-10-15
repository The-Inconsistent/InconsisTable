"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { CreationStep, EntityType, FieldDef } from "@inconsistable/rules-engine";

type FieldsStepProps = {
  step: Extract<CreationStep, { kind: "fields" }>;
  def: EntityType | undefined;
  value: Readonly<Record<string, unknown>>;
  onChange: (values: Record<string, unknown>) => void;
};

// What a field shows while it is being typed: the stored value as text (a list is one item per line).
const rawOf = (v: unknown): string =>
  Array.isArray(v) ? v.join("\n") : typeof v === "string" || typeof v === "number" ? String(v) : "";

// The value the typed text stands for, or undefined while it stands for nothing (blank, or not a whole number yet).
function parse({ def, raw }: { def: FieldDef; raw: string }): unknown {
  if (def.type === "int") return raw.trim() !== "" && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
  if (def.type === "list") {
    const items = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return raw.trim() === "" ? undefined : raw;
}

// FIELDS: free input for the step's fields, each by its declared type. The ruleset's own range and length are shown as
// hints; the server checks them again.
export function FieldsStep({ step, def, value, onChange }: FieldsStepProps) {
  const t = useTranslations("fieldsStep");
  const [raw, setRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(step.fields.map((f) => [f, rawOf(value[f])])),
  );

  // A change to one field: keeps the typed text, and passes on the parsed value (a field with none is left out).
  const handleChange = ({ field, fieldDef, text }: { field: string; fieldDef: FieldDef; text: string }) => {
    setRaw({ ...raw, [field]: text });
    const { [field]: _old, ...rest } = value;
    const next = parse({ def: fieldDef, raw: text });
    onChange(next === undefined ? rest : { ...rest, [field]: next });
  };

  return (
    <div className="stack">
      {step.fields.map((f) => {
        const fd = def?.fields[f];
        if (!fd)
          return (
            <p key={f} className="error">
              {t("notAField", { field: f })}
            </p>
          );
        const text = raw[f] ?? "";
        const set = (next: string) => handleChange({ field: f, fieldDef: fd, text: next });
        if (fd.type === "bool")
          return (
            <label key={f} className="row" style={{ minHeight: 44 }}>
              <input
                type="checkbox"
                checked={value[f] === true}
                onChange={(e) => onChange({ ...value, [f]: e.target.checked })}
                style={{ minHeight: 24 }}
              />
              {fd.label}
            </label>
          );
        if (fd.type === "enum")
          return (
            <label key={f}>
              {fd.label}
              <select value={text} onChange={(e) => set(e.target.value)}>
                <option value="">–</option>
                {fd.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          );
        const long = fd.type === "list" || (fd.type === "text" && (fd.maxLength ?? 0) > 200);
        const hint =
          fd.type === "int" && (fd.min !== undefined || fd.max !== undefined)
            ? t("range", { min: fd.min ?? t("any"), max: fd.max ?? t("any") })
            : fd.type === "list"
              ? t("onePerLine")
              : null;
        return (
          <label key={f}>
            <span>
              {fd.label} {hint && <span className="small dim">({hint})</span>}
            </span>
            {long ? (
              <textarea
                rows={4}
                value={text}
                maxLength={fd.type === "text" ? fd.maxLength : undefined}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <input
                inputMode={fd.type === "int" ? "numeric" : "text"}
                value={text}
                maxLength={fd.type === "text" ? fd.maxLength : undefined}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
