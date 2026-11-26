import type { CodexEntry, Spotlight } from "@inconsistable/core-schema";

/** The entry a spotlight shows, read from this seat's own codex; null when none, or not one this seat holds. */
export const spotlitEntry = ({
  spotlight,
  entries,
}: {
  spotlight: Spotlight | null;
  entries: readonly CodexEntry[];
}): CodexEntry | null => (spotlight ? (entries.find((e) => e.id === spotlight.entryId) ?? null) : null);

/** Where a phone keeps the `at` of the spotlight it dismissed, per room: a new SHOW has a new `at` and opens again. */
export const dismissKey = (campaignId: string): string => `it:spotlight:${campaignId}`;

// A player may hold up (SHOW THE TABLE, #2) what is worth holding up: a handout, or an entry with a picture it is shown.
export const canHoldUp = (entry: CodexEntry): boolean => entry.kind === "handout" || entry.imageId !== null;
