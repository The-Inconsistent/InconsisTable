// PREP's two ways to look at a scene: writing its lines, and sending them at the table.
export const PREP_MODES = ["prepare", "run"] as const;
export type PrepMode = (typeof PREP_MODES)[number];
