/** What a SheetView draws: the whole sheet, or one of PARTY's drawer tabs (house decision #222). */
export const SHEET_VIEW_PARTS = ["all", "gear", "advance"] as const;
export type SheetViewPart = (typeof SHEET_VIEW_PARTS)[number];
