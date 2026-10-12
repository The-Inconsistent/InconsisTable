import { plainDice, TestOutcome, type AdvantageMode } from "@inconsistable/rules-engine";

// What a phone asks for when a Test is called: the faces read off the physical dice. Pure, so it is unit tested; the
// server resolves the roll again, this only keeps an impossible one from being sent.

/** How many dice are read, and how many sides each has. Advantage reads the one die twice. Null: not plain NdX dice. */
export function rollSlots({
  dice,
  advantage,
}: {
  dice: string;
  advantage: AdvantageMode;
}): { count: number; sides: number } | null {
  const shape = plainDice(dice);
  if (shape === null) return null;
  return { count: advantage === "none" ? shape.count : 2, sides: shape.sides };
}

/** The faces typed into the slots, or null while one is empty or not a face of the die. */
export function facesFrom({ typed, sides }: { typed: readonly string[]; sides: number }): number[] | null {
  const faces = typed.map((t) => (/^[0-9]+$/.test(t) ? Number(t) : NaN));
  return faces.length > 0 && faces.every((f) => Number.isInteger(f) && f >= 1 && f <= sides) ? faces : null;
}

/** A modifier as the table writes it: +2, −1, +0. */
export const signed = (n: number): string => (n < 0 ? `−${-n}` : `+${n}`);

const OUTCOME_WORD: Record<TestOutcome, string> = { success: "Success", failure: "Failure", critical: "Critical" };

/** The outcome as a word. The state carries it as a string; one that isn't the engine's is shown as nothing. */
export function outcomeWord(outcome: string | null): string | null {
  const parsed = TestOutcome.safeParse(outcome);
  return parsed.success ? OUTCOME_WORD[parsed.data] : null;
}

/** The digits a die with this many sides can need: a d20 takes two, a d6 one. */
export const digitsOf = (sides: number): number => String(sides).length;
