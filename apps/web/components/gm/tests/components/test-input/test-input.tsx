"use client";
import { useTranslations } from "next-intl";

import type { TestInput } from "@/lib/test-inputs/test-inputs";

type TestInputFieldProps = {
  /** The control's id; unique on the page. */
  id: string;
  input: TestInput;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
};

// One input a Test asks for, as the call form draws it: a switch, a choice list, or a box for a number or a text.
export function TestInputField({ id, input, value, onChange }: TestInputFieldProps) {
  const t = useTranslations("callForm");
  const text = typeof value === "string" ? value : "";
  if (input.type === "bool")
    return (
      <label className="row" style={{ minHeight: 44 }}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          style={{ minHeight: 24 }}
        />
        {input.id}
      </label>
    );
  return (
    <label>
      {input.id}
      {input.options ? (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("pick")}</option>
          {input.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          inputMode={input.type === "int" ? "numeric" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: input.type === "int" ? 96 : 160 }}
        />
      )}
    </label>
  );
}
