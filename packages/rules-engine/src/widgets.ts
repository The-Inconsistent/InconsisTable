/**
 * The screen widgets the platform draws (ADR 0010, decision 3; house decision #83). A ruleset's `layout` row may name
 * one, bound to values by slot; the platform draws it with the room's Theme. The list is closed: a game that needs
 * another display gets a new widget here, in a platform release. Each widget is named for what it draws, never for a
 * game's box. This list is the one place an importer reads a widget's slots and variants; the validator reads it too,
 * and apps/api-go internal/engine/widgets.go holds the same list (the vectors keep them equal).
 */

/** What a slot's paths must name: an int field, a derived value or a resource; a text field; or any value. */
export type SlotTakes = "number" | "text" | "any";

export type WidgetSlot = {
  readonly id: string;
  /** A list of paths, or one path. */
  readonly list: boolean;
  readonly required: boolean;
  readonly takes: SlotTakes;
  /** A list slot read row by row with another list slot: both hold as many paths. */
  readonly sameLengthAs?: string;
  /** The variants that read this slot; absent, every variant. */
  readonly variants?: readonly string[];
  readonly about: string;
};

export type WidgetSpec = {
  readonly id: string;
  readonly about: string;
  /** The first is the default. Empty: the widget has one look. */
  readonly variants: readonly string[];
  readonly slots: readonly WidgetSlot[];
  /** The row carries `steps`: named rows of pips. */
  readonly steps?: boolean;
  /** Reads the saved build's sheet (the ruleset's `build` block) instead of bound values; its variant names the list. */
  readonly ledger?: boolean;
};

const one = (id: string, takes: SlotTakes, required: boolean, about: string): WidgetSlot => ({
  id,
  list: false,
  required,
  takes,
  about,
});
const many = (
  id: string,
  takes: SlotTakes,
  required: boolean,
  about: string,
  more: Partial<WidgetSlot> = {},
): WidgetSlot => ({
  id,
  list: true,
  required,
  takes,
  about,
  ...more,
});

export const WIDGETS = [
  {
    id: "strip",
    about: "A headed strip of short values: the title value in a bar, then each value as a label and its value.",
    variants: [],
    slots: [
      one("title", "any", false, "The value printed in the bar, such as a name."),
      many("values", "any", true, "The short values under the bar, in order."),
    ],
  },
  {
    id: "grid",
    about:
      "A grid of rated values. `columns`: one column per rating, with rows for the rating, the bonus and the total. " +
      "`pairs`: two columns of rows, each its label, its linked value's label, its rating and its total; a rating of 0 " +
      "draws its total hollow (untrained).",
    variants: ["columns", "pairs"],
    slots: [
      many("ratings", "number", true, "The rated values, in order."),
      many("bonus", "number", false, "Each rating's bonus.", { sameLengthAs: "ratings", variants: ["columns"] }),
      many("total", "number", false, "Each rating's total.", { sameLengthAs: "ratings" }),
      many("link", "any", false, "The value each rating is linked to; its label is drawn.", {
        sameLengthAs: "ratings",
        variants: ["pairs"],
      }),
    ],
  },
  {
    id: "frames",
    about:
      "Framed values side by side, each with its label above and its cite below; a derived value opens its " +
      "breakdown on tap.",
    variants: [],
    slots: [many("values", "number", true, "The values, in order.")],
  },
  {
    id: "sum",
    about: "Parts and their total, framed in a row: each part, then `+`, then `=` and the total, which is highlighted.",
    variants: [],
    slots: [
      many("parts", "number", true, "The parts, in order."),
      one("total", "number", true, "The total they make."),
    ],
  },
  {
    id: "track",
    about:
      "A counter with its limit as a track of boxes, the count over the limit beside it. A resource keeps its " +
      "steppers and the ask to spend, as the seat may.",
    variants: [],
    slots: [
      one("value", "number", true, "The counter."),
      one("max", "number", false, "Its limit; absent, the resource's own maximum."),
    ],
  },
  {
    id: "pips",
    about:
      "Pips in rows, one row per step of `steps` (a label and a size); the pips up to the value are filled and " +
      "the step the value has reached is marked.",
    variants: [],
    slots: [one("value", "number", true, "The count the pips show.")],
    steps: true,
  },
  {
    id: "cards",
    about:
      "Datacards for records the saved build holds: a name, a short stat line, tags and a cite. The variant names " +
      "the list: `weapons`, `armour`, `gear` or `powers`.",
    variants: ["weapons", "armour", "gear", "powers"],
    slots: [],
    ledger: true,
  },
  {
    id: "folds",
    about:
      "A folded list of named entries the saved build holds, each with its cite and the importer's summary. The " +
      "variant names the list: `talents`, `abilities`, or `both` (abilities, then talents with their stamp).",
    variants: ["both", "talents", "abilities"],
    slots: [],
    ledger: true,
  },
  {
    id: "notes",
    about:
      "Long texts the owner writes in place: each one folded under its label, and one EDIT that opens them all for " +
      "the seat that may change them.",
    variants: [],
    slots: [many("fields", "text", true, "The text fields, in order.")],
  },
] as const satisfies readonly WidgetSpec[];

export type WidgetId = (typeof WIDGETS)[number]["id"];
/** The variants of one widget; `never` for a widget with one look. */
export type WidgetVariant<W extends WidgetId> = Extract<(typeof WIDGETS)[number], { id: W }>["variants"][number];

/** The layout keys beyond the sheet's sections (ADR 0010, decision 3): each a list of rows. Drawn by later layers. */
export const LAYOUT_TARGETS = ["phoneTurn", "trackerRow", "screen"] as const;
export type LayoutTarget = (typeof LAYOUT_TARGETS)[number];

/** The most steps a pips row has, and pips in one step. */
export const MAX_PIP_STEPS = 12;
export const MAX_PIPS_PER_STEP = 20;

export const widgetSpec = (id: string): WidgetSpec | undefined => WIDGETS.find((w: WidgetSpec) => w.id === id);
