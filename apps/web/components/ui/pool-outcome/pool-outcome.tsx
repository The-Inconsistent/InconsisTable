import { useTranslations } from "next-intl";

import type { TestResult } from "@inconsistable/core-schema";

import { flagKey } from "@/lib/pool-report/pool-report";
import { outcomeKey, signed } from "@/lib/roll-slots/roll-slots";

type PoolOutcomeProps = { report: TestResult };

// A reported Dice pool in words: the score, then only what this seat may be told (the server nulls the rest), with the
// flags as badges that name themselves, so no state rests on colour alone.
export function PoolOutcome({ report }: PoolOutcomeProps) {
  const t = useTranslations("poolOutcome");
  const flags = report.flags.flatMap((f) => flagKey(f) ?? []);
  const word = outcomeKey(report.outcome);
  return (
    <span className="pool-result">
      {report.total !== null && <span className="pool-score">{t("score", { total: report.total })}</span>}
      {word && <strong>{t(`outcome.${word}`)}</strong>}
      {report.margin !== null && <span>{report.margin === 0 ? t("onTheNumber") : signed(report.margin)}</span>}
      {report.shifts !== null && <span>{t("shifts", { count: report.shifts })}</span>}
      {flags.map((f) => (
        <span key={f} className={`flag ${f}`}>
          {t(`flag.${f}`)}
        </span>
      ))}
    </span>
  );
}
