"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent } from "react";

import { awardOf } from "@/lib/ledger/play";

export type SessionAwardProps = { max: number; suggested: number[]; value: number; onChange: (n: number) => void };

// The XP each character gains when a session ends, as Auspex's session band picks it: the suggested amounts as chips,
// or a number typed from 0 to `max`, passed on when the box is left or Enter is pressed (a chip at once). The amount
// chosen is always on screen; a typed one out of range is not passed on.
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
  // The box, left or confirmed: passed on only when it is a whole number in range.
  const handleCommit = () => {
    const n = awardOf({ text, max });
    if (n !== null && n !== value) onChange(n);
  };
  // Enter commits the amount and goes no further: it never submits the form the picker sits in.
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleCommit();
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
            onChange={(e) => setText(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={handleKey}
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
