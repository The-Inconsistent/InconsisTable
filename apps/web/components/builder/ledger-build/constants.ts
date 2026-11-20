// What the save bar last said about the draft: nothing yet, kept a moment after a change, sent on a press, or refused.
export const DRAFT_NOTES = ["idle", "kept", "sent", "off"] as const;
export type DraftNote = (typeof DRAFT_NOTES)[number];
