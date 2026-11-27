// Paper prints (issue #4, house decision #151): PDFs built in this browser from what the seat already holds.

/** The papers a sheet, a run sheet or a card sheet prints on; the first is the default. */
export const PAPERS = ["A4", "LETTER"] as const;
/** A handout prints one to a page: A5 by default (two share an A4 sheet at "2 pages per sheet"), or a whole page. */
export const HANDOUT_PAPERS = ["A5", "A4", "LETTER"] as const;
export type Paper = (typeof HANDOUT_PAPERS)[number];

/** Sheet sizes in mm, to centre the card grid. */
export const PAPER_MM: Record<Paper, { w: number; h: number }> = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
  LETTER: { w: 215.9, h: 279.4 },
};

/** Where a browser remembers the last paper picked, per kind of print. */
export const PAPER_KEYS = {
  pages: "inconsistable.print.paper",
  handouts: "inconsistable.print.handout-paper",
} as const;

// Poker cards, 3 × 3 to a sheet: 189 × 264 mm fits inside both A4 and Letter with a margin a home printer reaches.
export const CARD_W_MM = 63;
export const CARD_H_MM = 88;
export const CARD_COLS = 3;
export const CARD_ROWS = 3;
export const CARDS_PER_SHEET = CARD_COLS * CARD_ROWS;

/** The most numbers a card holds, so it stays readable at arm's length. */
export const CARD_STATS = 6;
export const CREATURE_STATS = 10;
/** An item card's own text, cut to what fits under its numbers at the card's type size. */
// ponytail: a fixed cut, not measured; measure the laid-out text if long item texts get cut too early.
export const ITEM_TEXT_MAX = 420;

/** The most boxes a track prints; a longer one prints as a box to write the count in. */
export const MAX_TRACK_BOXES = 40;
/** Ruled lines left for pencil under a text block. */
export const PENCIL_LINES = { empty: 3, filled: 1, conditions: 2 } as const;

/** Type sizes in points: nothing printed is under 9 pt. */
export const PT = { small: 9, body: 10, value: 13, head: 11, title: 18, tent: 20 } as const;

// Paper is black on white whatever the room's Theme: no fill a cartridge would pay for, grey only for cut lines and
// ruled lines. Raw colour names, since react-pdf can't read CSS variables.
export const INK = { text: "black", line: "black", faint: "gray" } as const;
