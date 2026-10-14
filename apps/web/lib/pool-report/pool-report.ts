import type { PoolSpec } from "@inconsistable/core-schema";
import { PoolFlag } from "@inconsistable/rules-engine";

// What a phone asks for when a Dice pool is called: dice counted per scoring band and the face of each special die.
// Pure, so it is unit tested; the server counts the report again, this only keeps an impossible one from being sent.

/** How many of the pool are special dice: the declared count, or every die of a smaller pool. */
export const specialCountOf = ({ spec, pool }: { spec: PoolSpec; pool: number }): number =>
  Math.min(spec.special?.count ?? 0, pool);

/** The dice read by band: the pool without its special dice. */
export const ordinaryDiceOf = ({ spec, pool }: { spec: PoolSpec; pool: number }): number =>
  pool - specialCountOf({ spec, pool });

/** The faces of a band as the table says them: 6, 4–5. */
export const facesLabel = (band: { from: number; to: number }): string =>
  band.from === band.to ? String(band.from) : `${band.from}–${band.to}`;

export const countedIn = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** The counts after one step on a band, held between none and the dice still uncounted. */
export function stepCount({
  counts,
  band,
  delta,
  ordinary,
}: {
  counts: Readonly<Record<string, number>>;
  band: string;
  delta: 1 | -1;
  ordinary: number;
}): Record<string, number> {
  const now = counts[band] ?? 0;
  const next = delta === 1 && countedIn(counts) >= ordinary ? now : Math.max(0, now + delta);
  return { ...counts, [band]: next };
}

/** The roll to report, or null while a special die has no face yet. */
export function poolRoll({
  counts,
  special,
  expected,
}: {
  counts: Readonly<Record<string, number>>;
  special: readonly (number | null)[];
  expected: number;
}): { kind: "pool"; counts: Record<string, number>; special: number[] } | null {
  const faces = special.slice(0, expected);
  if (faces.length !== expected || faces.some((f) => f === null)) return null;
  return {
    kind: "pool",
    counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)),
    special: faces.filter((f): f is number => f !== null),
  };
}

const FLAG_WORD: Record<PoolFlag, string> = { critical: "Critical", complication: "Complication" };

/** A flag as a word. The state carries flags as strings; one that isn't the engine's is shown as nothing. */
export function flagWord(flag: string): string | null {
  const parsed = PoolFlag.safeParse(flag);
  return parsed.success ? FLAG_WORD[parsed.data] : null;
}

/** A margin as the table says it: +2, −3, 0 on the number. */
export const marginText = (margin: number): string =>
  margin === 0 ? "on the number" : margin > 0 ? `+${margin}` : `−${-margin}`;

/** "1 shift", "3 shifts". */
export const shiftsText = (n: number): string => `${n} ${n === 1 ? "shift" : "shifts"}`;
