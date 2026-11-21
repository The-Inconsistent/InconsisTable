import type { ActorItem } from "@inconsistable/core-schema";
import type { ItemKind, Ruleset } from "@inconsistable/rules-engine";

// Items a character holds (house decision #95), as the sheet draws them: loose ones by kind, each with what is fitted
// to it; a kind whose `card` a layout's `cards` widget draws is drawn there, beside the saved build's lines.

/** One item as a line draws it: the item, its kind, and the items fitted to it. */
export type ItemLine = { item: ActorItem; kind: ItemKind | undefined; fitted: ActorItem[] };

/** The loose items (none fitted to another) of the given kinds, in the actor's order, each with what is fitted to it. */
export function itemLines({
  ruleset,
  items,
  kinds,
}: {
  ruleset: Ruleset;
  items: readonly ActorItem[];
  kinds: ReadonlySet<string>;
}): ItemLine[] {
  const ids = new Set(items.map((x) => x.id));
  return items
    .filter((x) => kinds.has(x.kind) && (x.fittedTo === null || !ids.has(x.fittedTo)))
    .map((item) => ({
      item,
      kind: ruleset.items?.kinds.find((k) => k.id === item.kind),
      fitted: items.filter((y) => y.fittedTo === item.id),
    }));
}

/** The kinds a `cards` variant draws. */
export const cardKinds = ({ ruleset, variant }: { ruleset: Ruleset; variant: string }): Set<string> =>
  new Set((ruleset.items?.kinds ?? []).filter((k) => k.card === variant).map((k) => k.id));

/** Every kind the ruleset declares but the drawn `cards` variants: what the items box lists. */
export const boxKinds = ({ ruleset, drawn }: { ruleset: Ruleset; drawn: ReadonlySet<string> }): Set<string> =>
  new Set((ruleset.items?.kinds ?? []).filter((k) => k.card === undefined || !drawn.has(k.card)).map((k) => k.id));

/**
 * The items an item may be fitted to: loose items of its holder, of a kind it fits, not the item itself. Empty for a
 * kind that is not fitted, and for a seat off the GM side when the entry carries the kind's GM tag (the server refuses
 * it anyway; the screen does not offer it).
 */
export function hostsOf({
  ruleset,
  items,
  item,
  gm,
}: {
  ruleset: Ruleset;
  items: readonly ActorItem[];
  item: ActorItem;
  gm: boolean;
}): ActorItem[] {
  const fits = ruleset.items?.kinds.find((k) => k.id === item.kind)?.fits;
  if (fits === undefined || (!gm && fits.gmTag !== undefined && item.tags.includes(fits.gmTag))) return [];
  return items.filter((x) => x.id !== item.id && x.fittedTo === null && fits.to.includes(x.kind));
}
