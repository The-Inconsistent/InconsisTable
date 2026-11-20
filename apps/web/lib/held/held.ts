import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

// What an actor holds up (house decision #91): the ruleset's list fields shown as chips, the items in each, and the
// lists the end-one, end-all and add controls send back whole through field.set.

/** One list field the ruleset shows as chips, with what this actor holds in it. */
export interface HeldList {
  field: string;
  label: string;
  items: string[];
  /** The entity type whose pack entries are the quick picks; null without any. */
  picks: string | null;
  /** The most it holds; null for the server's own ceiling. */
  max: number | null;
  /** Whether the holder's own seat may change it, besides the GM side. */
  owner: boolean;
}

const itemsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The chip lists of this actor's type, in the order its fields are declared. */
export function heldLists({ ruleset, actor }: { ruleset: Ruleset | null | undefined; actor: Actor }): HeldList[] {
  const entity = ruleset?.entities.find((e) => e.id === actor.entity);
  return Object.entries(entity?.fields ?? {}).flatMap(([field, def]) =>
    def.type === "list" && def.chips === true
      ? [
          {
            field,
            label: def.label,
            items: itemsOf(actor.fields[field]),
            picks: def.picks?.entity ?? null,
            max: def.maxItems ?? null,
            owner: def.editableBy !== "gm",
          },
        ]
      : [],
  );
}

/** One chip: its list's label and the item. */
export type HeldChip = { label: string; item: string };
/** The chips of a combatant by its actor id, for an order's rows. */
export type HeldOf = (actorId: string) => readonly HeldChip[];

/** Every chip: for a tracker row or a phone's strip. */
export const heldChips = ({
  ruleset,
  actor,
}: {
  ruleset: Ruleset | null | undefined;
  actor: Actor | undefined;
}): HeldChip[] =>
  actor === undefined
    ? []
    : heldLists({ ruleset, actor }).flatMap((l) => l.items.map((item) => ({ label: l.label, item })));

/** The list with one more item; null when it would not change (blank, already held, or full). */
export function withItem({ list, item }: { list: HeldList; item: string }): string[] | null {
  const v = item.trim();
  if (v === "" || list.items.includes(v) || (list.max !== null && list.items.length >= list.max)) return null;
  return [...list.items, v];
}

/** The list without one item. */
export const withoutItem = ({ list, item }: { list: HeldList; item: string }) => list.items.filter((x) => x !== item);
