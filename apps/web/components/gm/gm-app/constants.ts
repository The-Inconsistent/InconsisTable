import type { Permission } from "@inconsistable/core-schema";

// The GM app's tabs, in order; `gmTabs.<tab>` words them. `perm`: a co-GM sees a tab only when one of its scopes grants
// it (canInCampaign). TRACK, PREP, CODEX, MAP and RULES fill in from P1 on (docs/p0-plan.md); PARTY works now.
export const GM_TABS = {
  track: { perm: "encounter:run" },
  prep: { perm: "codex:write" },
  codex: { perm: "codex:read" },
  party: { perm: "member:invite" },
  tests: { perm: "test:call" },
  map: { perm: "codex:read" },
  rules: { perm: "codex:read" },
} as const satisfies Record<string, { perm: Permission }>;
export type GmTab = keyof typeof GM_TABS;

// ?tab=party opens a tab directly (NEW ROOM lands on PARTY to invite the table).
export const TAB_PARAM = "tab";
export const asGmTab = (v: string | string[] | undefined): GmTab =>
  typeof v === "string" && Object.hasOwn(GM_TABS, v) ? (v as GmTab) : "party";
