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

/** The Theme's hook for a reported outcome: `outcome-success`, `-failure`, `-critical`, or nothing for anything else. */
export function outcomeClass(outcome: string | null): string {
  const parsed = TestOutcome.safeParse(outcome);
  return parsed.success ? `outcome-${parsed.data}` : "";
}

/** The outcome the engine knows (the `outcome` message words it). The state carries a string; any other is nothing. */
export function outcomeKey(outcome: string | null): TestOutcome | null {
  const parsed = TestOutcome.safeParse(outcome);
  return parsed.success ? parsed.data : null;
}

/** The digits a die with this many sides can need: a d20 takes two, a d6 one. */
export const digitsOf = (sides: number): number => String(sides).length;
