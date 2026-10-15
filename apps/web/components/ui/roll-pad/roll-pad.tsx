"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AdvantageMode } from "@inconsistable/rules-engine";

import { PAD_DIGITS } from "@/components/ui/roll-pad/constants";
import { digitsOf, facesFrom, rollSlots } from "@/lib/roll-slots/roll-slots";

type RollPadProps = {
  dice: string;
  /** Whether the Test lets the roller take advantage or disadvantage. */
  allowAdvantage: boolean;
  /** Who is rolling, for the screen reader. */
  who: string;
  /** Sends the roll; resolves with the server's refusal, or null once it was taken. */
  onReport: (roll: { advantage: AdvantageMode; faces: number[] }) => Promise<string | null>;
};

// The roll as read off the table: tap the number on each die, then report. Big keys instead of the phone's keyboard, so
// nothing covers the screen and the thumb never travels (CLAUDE.md, principle 8). The server resolves the roll again.
export function RollPad({ dice, allowAdvantage, who, onReport }: RollPadProps) {
  const t = useTranslations("rollPad");
  const [advantage, setAdvantage] = useState<AdvantageMode>("none");
  const slots = rollSlots({ dice, advantage });
  const [typed, setTyped] = useState<string[]>([""]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (slots === null) return <p className="error">{t("notPlain")}</p>;
  const { count, sides } = slots;
  const shown = Array.from({ length: count }, (_, i) => typed[i] ?? "");
  const faces = facesFrom({ typed: shown, sides });

  // ROLL TYPE: changing it changes how many dice are read, so what was typed starts over.
  const handleAdvantage = (next: AdvantageMode) => {
    setAdvantage(next);
    setTyped([""]);
    setActive(0);
  };

  // A key: adds the digit to the active die; moves on once the die can't take another digit.
  const handleDigit = (digit: string) => {
    const cur = shown[active] ?? "";
    const joined = `${cur}${digit}`;
    const next = cur.length < digitsOf(sides) && Number(joined) <= sides ? joined : digit;
    setTyped(shown.map((d, i) => (i === active ? next : d)));
    const full = next.length >= digitsOf(sides) || Number(`${next}0`) > sides;
    if (full && active + 1 < count) setActive(active + 1);
  };

  // DELETE: takes the last digit off the active die.
  const handleDelete = () => setTyped(shown.map((d, i) => (i === active ? d.slice(0, -1) : d)));

  // REPORT: sends the faces; a refusal stays on screen so the roll can be fixed or told to the GM.
  const handleReport = async () => {
    if (faces === null || busy) return;
    setBusy(true);
    setError(await onReport({ advantage, faces }));
    setBusy(false);
  };

  return (
    <div className="stack roll">
      {allowAdvantage && (
        <div className="row" role="group" aria-label={t("rollType", { who })}>
          {AdvantageMode.options.map((m) => (
            <button key={m} className="btn" aria-pressed={advantage === m} onClick={() => handleAdvantage(m)}>
              {t(`advantage.${m}`)}
            </button>
          ))}
        </div>
      )}
      <div className="roll-slots" role="group" aria-label={t("diceRolledBy", { who })}>
        {shown.map((face, i) => (
          <button
            key={i}
            className="roll-slot"
            aria-pressed={active === i}
            aria-label={t("dieLabel", { index: i + 1, count, value: face === "" ? t("empty") : face })}
            onClick={() => setActive(i)}
          >
            {face === "" ? "–" : face}
          </button>
        ))}
      </div>
      <div className="roll-pad" role="group" aria-label={t("numberPad")}>
        {PAD_DIGITS.map((d) => (
          <button key={d} className="roll-key" onClick={() => handleDigit(d)}>
            {d}
          </button>
        ))}
        <button className="roll-key" aria-label={t("deleteDigit")} onClick={handleDelete}>
          {t("del")}
        </button>
        <button className="roll-key" onClick={() => handleDigit("0")}>
          0
        </button>
        <button className="roll-key report" disabled={faces === null || busy} onClick={handleReport}>
          {t("report")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
