"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type ChangeEvent } from "react";

import { awardOf } from "@/lib/ledger/play";

export type SessionAwardProps = { max: number; suggested: number[]; value: number; onChange: (n: number) => void };

// The XP each character gains when a session ends, as Auspex's session band picks it: the suggested amounts as chips,
// or a number typed from 0 to `max`. The amount chosen is always on screen; a typed one out of range is not passed on.
export function SessionAward({ max, suggested, value, onChange }: SessionAwardProps) {
  const t = useTranslations("ledgerBuilder.play.session");
  const id = useId();
  const [text, setText] = useState(String(value));
  const invalid = awardOf({ text, max }) === null;

  // A chip: that amount, in the box too.
  const handlePick = (n: number) => {
    setText(String(n));
    onChange(n);
  };
  // The box: kept as typed, passed on only when it is a whole number in range.
  const handleType = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const n = awardOf({ text: e.target.value, max });
    if (n !== null) onChange(n);
  };

  return (
    <fieldset className="stack lb-play lb-award">
      <legend className="lb-sub">{t("title")}</legend>
      <div className="row">
        <span className="row" role="group" aria-label={t("suggested")}>
          {suggested.map((n) => (
            <button key={n} type="button" className="btn" aria-pressed={n === value} onClick={() => handlePick(n)}>
              {n}
            </button>
          ))}
        </span>
        <label className="row lb-award-field" htmlFor={id}>
          <span>{t("amount")}</span>
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={handleType}
            aria-invalid={invalid}
            aria-describedby={`${id}-range`}
          />
        </label>
      </div>
      <p id={`${id}-range`} className={invalid ? "error" : "small dim"}>
        {t("range", { max })}
      </p>
      <p className="lb-award-chosen" aria-live="polite">
        {t("chosen", { xp: value })}
      </p>
    </fieldset>
  );
}
