// The phone's bottom tabs, in order. SHEET, FIGHT and MAP fill in from P1 on (docs/p0-plan.md).
export const PLAYER_TABS = { sheet: "Sheet", fight: "Fight", map: "Map", intel: "Intel" } as const;
export type PlayerTab = keyof typeof PLAYER_TABS;
