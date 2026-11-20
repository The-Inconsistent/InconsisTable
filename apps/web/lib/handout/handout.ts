import { HandoutLayout } from "@inconsistable/core-schema";
import type { WorldHandouts } from "@inconsistable/rules-engine";

/**
 * The layouts a handout's picker offers (house decision #72): the room's World's, in its order, with `plain` first when
 * it does not list it; without a World, every layout. A layout the handout already has stays offered after the rest,
 * though the World no longer lists it, so the picker shows the current value and nothing is rewritten.
 */
export function offeredLayouts({
  handouts,
  current,
}: {
  handouts: WorldHandouts | null;
  current: HandoutLayout | null;
}): HandoutLayout[] {
  const offered: HandoutLayout[] = handouts ? [...handouts.layouts] : [...HandoutLayout.options];
  if (!offered.includes("plain")) offered.unshift("plain");
  if (current && !offered.includes(current)) offered.push(current);
  return offered;
}

/** One line of a transcript: its stamp (a time, a speaker) when the line starts with one in brackets. */
export type TranscriptLine = { stamp: string | null; text: string };

// `[stamp] text`: 1 to 24 characters in the brackets, and the one space after them is eaten.
const STAMPED = /^\[([^\]\n]{1,24})\] ?(.*)$/;

/** A transcript's body, line by line, blank lines kept. A line that starts with `[stamp]` carries it apart. */
export function transcriptLines(body: string): TranscriptLine[] {
  return body.split("\n").map((line) => {
    const m = STAMPED.exec(line);
    return m ? { stamp: m[1] ?? "", text: m[2] ?? "" } : { stamp: null, text: line };
  });
}
