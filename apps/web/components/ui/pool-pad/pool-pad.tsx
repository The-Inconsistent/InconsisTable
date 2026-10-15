"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PoolSpec } from "@inconsistable/core-schema";

import {
  countedIn,
  facesLabel,
  ordinaryDiceOf,
  poolRoll,
  specialCountOf,
  stepCount,
} from "@/lib/pool-report/pool-report";

type PoolPadProps = {
  spec: PoolSpec;
  /** The dice to roll, modifier included; null when the seat may not be told it. */
  pool: number | null;
  /** Who is rolling, for the screen reader. */
  who: string;
  /** Sends the roll; resolves with the server's refusal, or null once it was taken. */
  onReport: (roll: NonNullable<ReturnType<typeof poolRoll>>) => Promise<string | null>;
};

// A Dice pool as read off the table: sort the dice into the scoring bands with a stepper each, then pick the face of
// every special die. A few taps whatever the pool size, and the numbers stay big enough to read at arm's length.
// The server counts the report again; the tray only shows how many dice are still unsorted.
export function PoolPad({ spec, pool, who, onReport }: PoolPadProps) {
  const t = useTranslations("poolPad");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [special, setSpecial] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pool === null) return <p className="error">{t("hidden")}</p>;
  const specials = specialCountOf({ spec, pool });
  const ordinary = ordinaryDiceOf({ spec, pool });
  const counted = countedIn(counts);
  const roll = poolRoll({ counts, special, expected: specials });

  // BAND STEP: one more or one fewer die in a band.
  const handleStep = (band: string, delta: 1 | -1) =>
    setCounts((cur) => stepCount({ counts: cur, band, delta, ordinary }));

  // SPECIAL FACE: sets the face of one special die.
  const handleFace = (index: number, face: number) =>
    setSpecial((cur) => Array.from({ length: specials }, (_, i) => (i === index ? face : (cur[i] ?? null))));

  // REPORT: sends the counts; a refusal stays on screen so the count can be fixed or told to the GM.
  const handleReport = async () => {
    if (roll === null || busy) return;
    setBusy(true);
    setError(await onReport(roll));
    setBusy(false);
  };

  return (
    <div className="stack pool">
      <div className="pool-tray" aria-hidden="true">
        {Array.from({ length: specials }, (_, i) => (
          <span key={`s${i}`} className="pool-die special" data-set={special[i] != null}>
            {special[i] ?? "?"}
          </span>
        ))}
        {Array.from({ length: ordinary }, (_, i) => (
          <span key={i} className="pool-die" data-set={i < counted} />
        ))}
      </div>
      <p className="pool-size" role="status">
        <strong>{pool}</strong> d{spec.die}
        {specials > 0 && ` · ${specials} ${spec.special?.label ?? t("special")}`}
        <span className="dim small">{` ${t("sorted", { counted, ordinary })}`}</span>
      </p>
      <div className="stack" role="group" aria-label={t("countedBy", { who })}>
        {spec.bands.map((band) => (
          <div key={band.id} className="pool-band">
            <span className="pool-faces">
              <strong>{facesLabel(band)}</strong>
              <span className="dim small">
                {band.worth === 1 ? t("scoresOne") : t("scoresEach", { worth: band.worth })}
              </span>
            </span>
            <button
              className="btn step"
              aria-label={t("fewer", { faces: facesLabel(band), who })}
              disabled={(counts[band.id] ?? 0) === 0}
              onClick={() => handleStep(band.id, -1)}
            >
              −
            </button>
            <output className="pool-count" aria-label={t("showing", { faces: facesLabel(band) })}>
              {counts[band.id] ?? 0}
            </output>
            <button
              className="btn step"
              aria-label={t("more", { faces: facesLabel(band), who })}
              disabled={counted >= ordinary}
              onClick={() => handleStep(band.id, 1)}
            >
              +
            </button>
          </div>
        ))}
      </div>
      {Array.from({ length: specials }, (_, i) => (
        <div
          key={i}
          className="stack"
          role="group"
          aria-label={t("specialFor", { label: spec.special?.label ?? t("specialDie"), index: i + 1, who })}
        >
          <span className="small">{t("whichFace", { label: spec.special?.label ?? t("specialDie") })}</span>
          {/* ponytail: one button per face, fine for the dice games use (d6–d20); a numeric field for a bigger die */}
          <div className="pool-faces-grid">
            {Array.from({ length: spec.die }, (_, f) => (
              <button
                key={f}
                className="btn"
                aria-pressed={special[i] === f + 1}
                aria-label={t("face", { face: f + 1 })}
                onClick={() => handleFace(i, f + 1)}
              >
                {f + 1}
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary pool-report" disabled={roll === null || busy} onClick={handleReport}>
        {t("report")}
      </button>
    </div>
  );
}
