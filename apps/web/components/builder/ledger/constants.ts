// Rows a catalogue list shows at once; "Show more" adds as many again. A list of hundreds stays light on a phone.
export const LIST_PAGE = 40;
// A list longer than this gets a search field.
export const SEARCH_FROM = 8;
// The Archetype list: those the Tier opens, or every one (a higher one is shown closed, with the reason).
export const ARCHETYPE_FILTERS = ["upToTier", "all"] as const;
export type ArchetypeFilter = (typeof ARCHETYPE_FILTERS)[number];
