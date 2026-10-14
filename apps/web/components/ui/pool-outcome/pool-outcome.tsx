import type { TestResult } from "@inconsistable/core-schema";

import { flagWord, marginText, shiftsText } from "@/lib/pool-report/pool-report";
import { outcomeWord } from "@/lib/roll-slots/roll-slots";

type PoolOutcomeProps = { report: TestResult };

// A reported Dice pool in words: the score, then only what this seat may be told (the server nulls the rest), with the
// flags as badges that name themselves, so no state rests on colour alone.
export function PoolOutcome({ report }: PoolOutcomeProps) {
  const flags = report.flags.flatMap((f) => flagWord(f) ?? []);
  const word = outcomeWord(report.outcome);
  return (
    <span className="pool-result">
      {report.total !== null && <span className="pool-score">Score {report.total}</span>}
      {word && <strong>{word}</strong>}
      {report.margin !== null && <span>{marginText(report.margin)}</span>}
      {report.shifts !== null && <span>{shiftsText(report.shifts)}</span>}
      {flags.map((f) => (
        <span key={f} className={`flag ${f.toLowerCase()}`}>
          {f}
        </span>
      ))}
    </span>
  );
}
