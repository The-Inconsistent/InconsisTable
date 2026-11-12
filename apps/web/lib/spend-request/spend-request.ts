import type { RequestAnswer, SpendRequest } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

// The pure side of spend requests (house decision #43): the limits the form keeps to, and which answers are new.

export const REQUEST_AMOUNT = { min: 1, max: 99 } as const;
export const REQUEST_NOTE_MAX = 140;

/** The ruleset's resource labels by id; empty while the ruleset is not loaded. */
export const resourceLabels = (ruleset: Ruleset | null): ReadonlyMap<string, string> =>
  new Map((ruleset?.resources ?? []).map((r) => [r.id, r.label]));

/** An amount held inside what the server takes. */
export const clampAmount = (n: number): number => Math.min(REQUEST_AMOUNT.max, Math.max(REQUEST_AMOUNT.min, n));

/** The pending requests for one resource of one character. */
export const pendingFor = ({
  requests,
  actorId,
  resourceId,
}: {
  requests: readonly SpendRequest[];
  actorId: string;
  resourceId: string;
}): SpendRequest[] => requests.filter((q) => q.actorId === actorId && q.resourceId === resourceId);

/** The answers not yet seen, oldest first (the snapshot lists the newest first). */
export const unseen = ({
  answers,
  seen,
}: {
  answers: readonly RequestAnswer[];
  seen: ReadonlySet<string>;
}): RequestAnswer[] => answers.filter((a) => !seen.has(a.id)).reverse();
