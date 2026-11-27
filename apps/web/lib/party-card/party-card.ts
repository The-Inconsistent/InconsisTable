import type { CodexEntry, LiveState } from "@inconsistable/core-schema";
import { actorScope, healthStatesOf, withLists, type CompiledRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { layoutRows } from "@/lib/panels/panels";
import { stripCellsOf } from "@/lib/phone-strip/phone-strip";
import { rangeOf, type SheetActor } from "@/lib/sheet/sheet";

// A character's card on PARTY (house decision #222): only what the ruleset already declares, read as the GM side holds it.

/** A health bar: what is left of the track against its limit. */
export type CardBar = { id: string; label: string; left: number; max: number };
/** One number of the card's compact line. */
export type CardNumber = { id: string; label: string; value: number };
export type PartyCard = {
  /** The archetype-like line: the library card's line (`build.libraryLine`), else the first text field that holds one. */
  line: string | null;
  bars: CardBar[];
  numbers: CardNumber[];
  /** The labels of the health states that hold. */
  states: string[];
};

/** The card of one character. `compiled` null (a ruleset that does not compile here) leaves out bars and states. */
export function partyCardOf({
  ruleset,
  compiled,
  actor,
  characters,
  campaign,
}: {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  actor: SheetActor;
  characters: number;
  campaign?: Readonly<Record<string, number | string | boolean>>;
}): PartyCard {
  const label = (id: string) => ruleset.resources.find((r) => r.id === id)?.label ?? id;
  const maxOf = (id: string) =>
    compiled ? (rangeOf({ compiled, resource: id, actor, characters, campaign })?.max ?? null) : null;
  // Tracks count down to their minimum; harm (wounds, shock) counts up to its limit, so what is left is the limit less it.
  const harm = ruleset.health.harm;
  const tracks = [
    ...ruleset.health.tracks.map((t) => ({ id: t.resource, up: false })),
    ...[harm?.wounds, harm?.shock].flatMap((id) => (id ? [{ id, up: true }] : [])),
  ];
  const bars = tracks.flatMap(({ id, up }): CardBar[] => {
    const value = actor.resources[id];
    const max = maxOf(id);
    if (value === undefined || max === null || max <= 0) return [];
    return [{ id, label: label(id), left: Math.max(0, up ? max - value : value), max }];
  });

  const barred = new Set(bars.map((b) => b.id));
  const rows =
    layoutRows({ ruleset, entity: actor.entity, target: "phoneStrip" }) ??
    layoutRows({ ruleset, entity: actor.entity, target: "trackerRow" }) ??
    [];
  const numbers = stripCellsOf({ ruleset, actor, rows }).flatMap(({ row }): CardNumber[] => {
    if (row.kind === "resource" && barred.has(row.id)) return [];
    const value =
      row.kind === "resource"
        ? actor.resources[row.id]
        : row.kind === "derived"
          ? actor.derived[row.id]
          : actor.fields[row.id];
    return typeof value === "number" ? [{ id: row.id, label: row.label, value }] : [];
  });

  let states: string[] = [];
  if (compiled) {
    try {
      const scope = withLists({
        ruleset: compiled.ruleset,
        scope: actorScope({
          fields: actor.fields,
          derived: actor.derived,
          resources: actor.resources,
          party: { characters },
          campaign,
        }),
      });
      states = healthStatesOf({ compiled, entity: actor.entity, scope }).map(
        (id) => ruleset.health.states.find((s) => s.id === id)?.label ?? id,
      );
    } catch {
      // A state that cannot be worked out from what this seat holds is not shown, as on the Ascension panel.
    }
  }

  return { line: lineOf({ ruleset, actor }), bars, numbers, states };
}

/** The archetype-like line: `build.libraryLine`'s chosen name, else the first text field of the entity with a value. */
export function lineOf({ ruleset, actor }: { ruleset: Ruleset; actor: SheetActor }): string | null {
  const build = ruleset.build;
  const named =
    build?.libraryLine === "archetypes"
      ? build.sheet.archetype
      : build?.libraryLine === "species"
        ? build.sheet.species
        : null;
  const fields = ruleset.entities.find((e) => e.id === actor.entity)?.fields ?? {};
  const candidates = [
    ...(named ? [named] : []),
    ...Object.entries(fields).flatMap(([id, f]) => (f.type === "text" ? [id] : [])),
  ];
  for (const id of candidates) {
    const v = actor.fields[id];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

/** Seated: a member or a live guest token holds it. Active cards are the seated characters still in play. */
export function isSeated({ access, actorId }: { access: LiveState["access"]; actorId: string }): boolean {
  return (
    access.members.some((m) => m.characterIds.includes(actorId)) || access.guests.some((g) => g.actorId === actorId)
  );
}

/**
 * A character's objectives (house decision #223): the quests revealed to it alone among a listed audience, the notebook's
 * YOUR ORDERS. A quest listed to several characters counts for each.
 */
export function objectivesOf({ entries, actorId }: { entries: readonly CodexEntry[]; actorId: string }): CodexEntry[] {
  return entries.filter(
    (e) => e.kind === "quest" && e.visibility !== "gm" && e.audienceMode === "listed" && e.audience.includes(actorId),
  );
}
