import type { Actor, ActorItem } from "@inconsistable/core-schema";
import {
  HOST_PREFIX,
  withFittedCard,
  type ActiveEntry,
  type Effect,
  type ItemKind,
  type Ruleset,
} from "@inconsistable/rules-engine";

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
    .filter((x) => kinds.has(x.kind) && x.fittedLine === undefined && (x.fittedTo === null || !ids.has(x.fittedTo)))
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
  return items.filter(
    (x) => x.id !== item.id && x.fittedTo === null && x.fittedLine === undefined && fits.to.includes(x.kind),
  );
}

/**
 * The items whose effects are in the actor's numbers, as the breakdown names them (the server's actor.ItemEntries):
 * every entry's but a fitting's while it is loose; an effect on a host's card changes no number of the actor.
 */
export function itemEntries({ ruleset, items }: { ruleset: Ruleset; items: readonly ActorItem[] }): ActiveEntry[] {
  const ids = new Set(items.map((x) => x.id));
  return items.flatMap((x) => {
    const kind = ruleset.items?.kinds.find((k) => k.id === x.kind);
    const fitted = x.fittedLine !== undefined || (x.fittedTo !== null && ids.has(x.fittedTo));
    const effects = x.effects.filter((e) => !e.path.startsWith(HOST_PREFIX)) as unknown as Effect[];
    if (kind === undefined || x.entry === null || effects.length === 0 || (kind.fits !== undefined && !fitted))
      return [];
    return [{ type: kind.entry, key: x.entry, name: x.name, effects }];
  });
}

/** A line of the saved build an item may be fitted to (house decision #102): `weapons/<name>` or `armour/<name>`. */
export type BuildLine = { ref: string; card: "weapons" | "armour"; name: string };

/** The saved sheet's lines, as the server reads them (actor.LinesOf): each weapon by name once, then the armour worn. */
export function buildLines(sheet: Record<string, unknown> | null | undefined): BuildLine[] {
  const weapons: unknown[] = Array.isArray(sheet?.weapons) ? sheet.weapons : [];
  const out: BuildLine[] = [];
  for (const w of weapons) {
    const name = nameOf(w);
    if (name !== "" && !out.some((l) => l.name === name)) out.push({ ref: `weapons/${name}`, card: "weapons", name });
  }
  const armour = nameOf(sheet?.armour);
  if (armour !== "") out.push({ ref: `armour/${armour}`, card: "armour", name: armour });
  return out;
}

const nameOf = (v: unknown): string =>
  typeof v === "object" && v !== null && "name" in v && typeof v.name === "string" ? v.name : "";

/** The kind a build line counts as when an item is fitted to it: the first kind of its card the actor's type holds. */
export const lineKind = ({ ruleset, card, entity }: { ruleset: Ruleset; card: string; entity: string }) =>
  ruleset.items?.kinds.find((k) => k.card === card && k.entities.includes(entity));

/** The build lines an item may be fitted to: those whose kind its own kind fits (the server checks the rest). */
export function lineHostsOf({
  ruleset,
  actor,
  item,
  gm,
}: {
  ruleset: Ruleset;
  actor: Pick<Actor, "entity" | "ledger">;
  item: Pick<ActorItem, "kind" | "tags">;
  gm: boolean;
}): BuildLine[] {
  const fits = ruleset.items?.kinds.find((k) => k.id === item.kind)?.fits;
  if (fits === undefined || (!gm && fits.gmTag !== undefined && item.tags.includes(fits.gmTag))) return [];
  return buildLines(actor.ledger?.sheet).filter((l) => {
    const k = lineKind({ ruleset, card: l.card, entity: actor.entity });
    return k !== undefined && fits.to.includes(k.id);
  });
}

/**
 * A weapon's or an armour's numbers with what is fitted to it (house decision #102): each fitted item's `host.<value>`
 * effects, in the order they were fitted; `by` names the items that changed one. A number the card prints as words
 * (a rolled ED) is left as printed.
 */
export function withFitted<T extends Record<string, unknown>>({
  card,
  fitted,
}: {
  card: T;
  fitted: readonly Pick<ActorItem, "name" | "effects">[];
}): T & { by: string[] } {
  const out = withFittedCard({ card, fitted });
  return { ...(out.card as T), by: out.by };
}
