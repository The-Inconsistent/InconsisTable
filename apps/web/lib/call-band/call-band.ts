import type { TestCall } from "@inconsistable/core-schema";

/** How many open calls the band under the tabs draws; the rest are a link to TESTS. */
export const CALL_BAND_MAX = 2;

/** Which open calls the band shows, and how many more are open than shown. Closed calls never show. */
export function callBand({ tests, max = CALL_BAND_MAX }: { tests: readonly TestCall[]; max?: number }) {
  const open = tests.filter((c) => c.status === "open");
  return { shown: open.slice(0, max), more: Math.max(0, open.length - max) };
}
