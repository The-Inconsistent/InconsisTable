import type { ReactNode } from "react";

import type { Actor, BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import type { SheetRow } from "@/lib/sheet-widgets/sheet-widgets";

/** What every widget of the sheet reads beside its own model: the sheet's character and its handlers. */
export type WidgetEnv = {
  actor: Actor;
  ruleset: Ruleset;
  /** The GM's seat may change any value; a player's by the value's `editableBy`. */
  gm: boolean;
  books: readonly BookSource[];
  requestPage: RequestPage;
  send: Send;
  /** A value row as the sheet draws it: a resource with its steppers and its ask to spend. */
  rowView: (row: SheetRow) => ReactNode;
  /** A resource's bounds for this character, when they can be worked out. */
  range: (resource: string) => { min: number; max: number | null } | null;
  /** Opens the breakdown of a derived value. */
  onOpen: (derivedId: string) => void;
  onError: (error: string | null) => void;
  /** A sheet read only (a foe's card on a phone, house decision #117): nothing in it writes. */
  readOnly?: boolean;
  /** A screen nobody touches (the table screen, house decision #127): read only, and no breakdown or meaning opens. */
  still?: boolean;
};
