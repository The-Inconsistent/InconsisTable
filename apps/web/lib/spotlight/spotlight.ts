import type { CodexEntry, Spotlight } from "@inconsistable/core-schema";

/**
 * The entry a spotlight shows, read from this seat's own codex; null when none, not one this seat holds, or shown to
 * listed characters none of which it holds (a seat that may reveal in a room without a GM receives the whole spotlight).
 */
export const spotlitEntry = ({
  spotlight,
  entries,
  held,
}: {
  spotlight: Spotlight | null;
  entries: readonly CodexEntry[];
  held: readonly string[];
}): CodexEntry | null => {
  if (!spotlight) return null;
  if (spotlight.audience.length > 0 && !spotlight.audience.some((id) => held.includes(id))) return null;
  return entries.find((e) => e.id === spotlight.entryId) ?? null;
};

/** Where a phone keeps the `at` of the spotlight it dismissed, per room: a new SHOW has a new `at` and opens again. */
export const dismissKey = (campaignId: string): string => `it:spotlight:${campaignId}`;

// A player may hold up (SHOW THE TABLE, #2) what is worth holding up: a handout, or an entry with a picture it is shown.
export const canHoldUp = (entry: CodexEntry): boolean => entry.kind === "handout" || entry.imageId !== null;

/**
 * Whether the X-card is up: touched (`signal` counts touches) since it last came down (`closedAt`, the signal then).
 * The X-card is a safety tool and always wins: while it is up, a spotlight or a held card yields, whichever came first.
 */
export const xcardUp = ({ signal, closedAt }: { signal: number; closedAt: number }): boolean => signal > closedAt;
