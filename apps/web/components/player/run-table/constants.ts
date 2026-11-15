// The sub-tabs of RUN THE TABLE, in order; `runTable.tabs.<tab>` words them. `party` (invites, characters, the room's
// settings) is the owner's only: it needs the permission to invite, which a room without a GM gives its owner alone.
export const RUN_TABS = ["fight", "tests", "codex", "party"] as const;
export type RunTab = (typeof RUN_TABS)[number];
