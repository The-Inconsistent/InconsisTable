"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import type { Actor } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type OverrideFieldProps = {
  actor: Pick<Actor, "id" | "fields">;
  /** The derived value's label. */
  label: string;
  /** The int field that holds the override (the derived value's `override`, house decision #96). */
  field: string;
  send: Send;
  onError: (error: string | null) => void;
};

// The GM's override of a derived value (house decision #96): a number that replaces the worked-out one, written to the
// field the ruleset names through field.set (logged; Undo takes it back). CLEAR, or SET with the box blank, brings the
// worked-out number back.
export function OverrideField({ actor, label, field, send, onError }: OverrideFieldProps) {
  const t = useTranslations("sheet.override");
  const stored = actor.fields[field];
  const [text, setText] = useState(typeof stored === "number" ? String(stored) : "");
  const id = `override-${actor.id}-${field}`;

  const write = async (value: number | null) => {
    const r = await send({ type: "field.set", actorId: actor.id, field, value });
    onError(r.ok ? null : r.error);
    if (r.ok && value === null) setText("");
  };
  const handleText = (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value);
  // A whole number sets it; a blank box clears it.
  const handleSet = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(text);
    void write(text.trim() === "" || !Number.isInteger(n) ? null : n);
  };
  const handleClear = () => write(null);

  return (
    <form className="stack override-field" onSubmit={handleSet}>
      <label htmlFor={id} className="small">
        {t("value", { label })}
      </label>
      <span className="row">
        <input id={id} className="input" inputMode="numeric" value={text} onChange={handleText} />
        <button className="btn sm" type="submit">
          {t("set")}
        </button>
        {typeof stored === "number" && (
          <button className="btn sm" type="button" onClick={handleClear}>
            {t("clear")}
          </button>
        )}
      </span>
      <span className="small dim">{t("hint")}</span>
    </form>
  );
}
