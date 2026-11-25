import type { Permission } from "@inconsistable/core-schema";

// The GM app's tabs, in order; `gmTabs.<tab>` words them. `perm`: a co-GM sees a tab only when one of its scopes grants
// it (canInCampaign). SCENE is the first: the scene being played, with the tracker as its FIGHT layer (house decision
// #106); TRACK is no tab of its own. MAP and RULES fill in from P1 on (docs/p0-plan.md); PARTY works now.
export const GM_TABS = {
  scene: { perm: "codex:read" },
  prep: { perm: "codex:write" },
  codex: { perm: "codex:read" },
  party: { perm: "member:invite" },
  tests: { perm: "test:call" },
  standings: { perm: "codex:read" }, // every GM seat; listed only once the campaign has a game
  map: { perm: "codex:read" },
  rules: { perm: "codex:read" },
} as const satisfies Record<string, { perm: Permission }>;
export type GmTab = keyof typeof GM_TABS;

// ?tab=party opens a tab directly (NEW ROOM lands on PARTY to invite the table); no ?tab= opens SCENE. The old
// ?tab=track opens SCENE on its FIGHT layer, so links made before the tracker moved keep working.
export const TAB_PARAM = "tab";
export const FIGHT_TAB = "track";
