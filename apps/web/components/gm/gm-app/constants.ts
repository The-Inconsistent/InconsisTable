import type { Permission } from "@inconsistable/core-schema";

// The GM app's tabs, in order. `perm`: a co-GM sees a tab only when one of its scopes grants it (canInCampaign).
// TRACK, PREP, CODEX, MAP and RULES fill in from P1 on (docs/p0-plan.md); PARTY works now.
export const GM_TABS = {
  track: { label: "Track", perm: "encounter:run" },
  prep: { label: "Prep", perm: "codex:write" },
  codex: { label: "Codex", perm: "codex:read" },
  party: { label: "Party", perm: "member:invite" },
  tests: { label: "Tests", perm: "test:call" },
  map: { label: "Map", perm: "codex:read" },
  rules: { label: "Rules", perm: "codex:read" },
} as const satisfies Record<string, { label: string; perm: Permission }>;
export type GmTab = keyof typeof GM_TABS;

// ?tab=party opens a tab directly (NEW ROOM lands on PARTY to invite the table).
export const TAB_PARAM = "tab";
export const asGmTab = (v: string | string[] | undefined): GmTab =>
  typeof v === "string" && Object.hasOwn(GM_TABS, v) ? (v as GmTab) : "party";
