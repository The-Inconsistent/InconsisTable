// The phone's bottom tabs, in order; `playerTabs.<tab>` words them. SHEET, FIGHT and MAP fill in from P1 on (docs/p0-plan.md).
export const PLAYER_TABS = ["sheet", "rules", "fight", "map", "notebook", "standings"] as const;
export type PlayerTab = (typeof PLAYER_TABS)[number];
