"use client";
import { useTranslations } from "next-intl";

export type TrailStep = { title: string; label: string };

type TableTrailProps = {
  steps: readonly TrailStep[];
  /** CLEAR: starts the chain again; absent, the trail is only read. */
  onClear?: () => void;
};

// The chain of tables stepped through so far (house decision #88): each table and the line that sent the GM on. The
// tables panel and a generator's wizard (house decision #98) draw it.
export function TableTrail({ steps, onClear }: TableTrailProps) {
  const t = useTranslations("tables");
  if (steps.length === 0) return null;
  return (
    <div className="row table-trail">
      <ol className="row" aria-label={t("trail")}>
        {steps.map((s, i) => (
          <li key={i}>{t("trailStep", s)}</li>
        ))}
      </ol>
      {onClear && (
        <button type="button" className="btn sm" onClick={onClear}>
          {t("trailClear")}
        </button>
      )}
    </div>
  );
}
