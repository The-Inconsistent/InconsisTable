import type { Actor, Encounter, StrikeMeansPick, TableMode } from "@inconsistable/core-schema";
import {
  actorScope,
  campaignValues,
  meansValues,
  planStrike,
  strikeTargets,
  type CompiledRuleset,
  type Ruleset,
  type Strike,
  type StrikePlan,
} from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";

// The strike guide (house decision #99): what a strike gives, worked out with the engine function the server runs,
// from the values this seat holds. The server's answer is the one that counts.

type Side = Pick<Actor, "id" | "name" | "entity" | "fields" | "derived" | "resources">;

/** One means the attacker can strike with: where it comes from, its line or key, its name and what it holds. */
export type StrikeMeansOption = StrikeMeansPick & { name: string; values: Readonly<Record<string, unknown>> };

/** The strike kinds an actor's type may make, in the ruleset's order. */
export const strikesFor = ({ ruleset, actor }: { ruleset: Ruleset; actor: Pick<Actor, "entity"> }): Strike[] =>
  actor.entity === "" ? [] : (ruleset.strikes ?? []).filter((s) => s.entities?.includes(actor.entity) ?? true);

/** The pack entry types a strike's means are read from, which the guide loads when it opens. */
export const entryTypesOf = ({ ruleset, strike }: { ruleset: Pick<Ruleset, "items">; strike: Strike }): string[] => [
  ...new Set(
    (strike.means ?? []).flatMap((m) => {
      if (m.from === "list") return [m.entry];
      if (m.from === "items") return (ruleset.items?.kinds ?? []).filter((k) => k.id === m.kind).map((k) => k.entry);
      return [];
    }),
  ),
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The means the attacker has now, source by source: each line of its saved sheet's list (its index the ref), each key
 * its list field holds that names a loaded entry of the source's type (the key the ref), and each item of the source's
 * kind it holds whose entry is loaded (the item's id the ref). A key or an item no loaded entry has is left out, as the
 * server would refuse it.
 */
export function meansOf({
  ruleset,
  strike,
  actor,
  entries,
}: {
  ruleset: Pick<Ruleset, "items">;
  strike: Strike;
  actor: Pick<Actor, "fields" | "ledger" | "items">;
  entries: readonly Pick<RulesEntry, "key" | "type" | "name" | "body">[];
}): StrikeMeansOption[] {
  return (strike.means ?? []).flatMap((m, source): StrikeMeansOption[] => {
    if (m.from === "ledger") {
      const lines = actor.ledger?.sheet?.[m.lines];
      return (Array.isArray(lines) ? lines : []).flatMap((line, i) =>
        isRecord(line) ? [{ source, ref: String(i), name: String(line.name ?? i + 1), values: line }] : [],
      );
    }
    if (m.from === "items") {
      const type = ruleset.items?.kinds.find((k) => k.id === m.kind)?.entry;
      return (actor.items ?? []).flatMap((item) => {
        const e = item.kind === m.kind ? entries.find((x) => x.type === type && x.key === item.entry) : undefined;
        return e === undefined ? [] : [{ source, ref: item.id, name: item.name, values: e.body }];
      });
    }
    const keys = actor.fields[m.field];
    return (Array.isArray(keys) ? keys : []).flatMap((key) => {
      const e = entries.find((x) => x.type === m.entry && x.key === key);
      return e === undefined ? [] : [{ source, ref: e.key, name: e.name, values: e.body }];
    });
  });
}

/** A means' text values (a weapon's traits), in the strike's order, the empty ones left out: shown beside the means. */
export const meansTexts = ({ strike, means }: { strike: Strike; means: StrikeMeansOption | undefined }): string[] => {
  if (means === undefined) return [];
  const read = meansValues({ values: strike.values ?? {}, means: means.values });
  return Object.entries(strike.values ?? {}).flatMap(([id, v]) => {
    const text = read[id];
    return v.type === "text" && typeof text === "string" && text !== "" ? [text] : [];
  });
};

/** Who a strike may land on: the fight's combatants, the attacker left out, of a type the strike takes. */
export function targetsOf<A extends Pick<Actor, "id" | "entity">>({
  ruleset,
  strike,
  attackerId,
  fighting,
}: {
  ruleset: Ruleset;
  strike: Strike;
  attackerId: string;
  fighting: readonly A[];
}): A[] {
  const types = strikeTargets(ruleset, strike);
  return fighting.filter((a) => a.id !== attackerId && types.includes(a.entity));
}

/** What the strike gives now for these sides, as the server will work it out; null without both sides. */
export function previewStrike({
  compiled,
  strike,
  attacker,
  target,
  means,
  inputs,
  total,
  characters,
  campaign,
}: {
  compiled: CompiledRuleset;
  strike: Strike;
  attacker: Side;
  target: Side | undefined;
  means: StrikeMeansOption | undefined;
  inputs: Readonly<Record<string, number | boolean>>;
  total: number | null;
  characters: number;
  campaign: Readonly<Record<string, unknown>>;
}): ReturnType<typeof planStrike> | null {
  if (target === undefined || (strike.means !== undefined && means === undefined)) return null;
  const sideOf = (a: Side) => ({
    entity: a.entity,
    scope: actorScope({
      fields: a.fields,
      derived: a.derived,
      resources: a.resources,
      party: { characters },
      campaign: campaignValues({ compiled, stored: campaign }),
    }),
  });
  return planStrike({
    ruleset: compiled.ruleset,
    strikeId: strike.id,
    attacker: sideOf(attacker),
    target: sideOf(target),
    means: means?.values ?? null,
    inputs,
    total,
  });
}

/** Why a phone may not send a strike itself (house decision #112), or null when it may: the server's own refusals. */
export type StrikeHold =
  "strikeNotByOwner" | "strikeNotYourTurn" | "sessionPaused" | "strikeTargetHidden" | "usedThisRound";

/**
 * Whether a player's phone may send this strike for its own character now, as the server will decide it: a table
 * without a GM runs its own fight; with a GM, the strike lets its owner send it, the attacker is acting, a session runs,
 * the target is shown to the seat in full, and the strike's uses this round are not used up. Null when it may.
 */
export function strikeHold({
  strike,
  encounter,
  tableMode,
  attackerId,
  targetId,
}: {
  strike: Pick<Strike, "id" | "byOwner" | "limit">;
  encounter: Pick<Encounter, "currentId" | "paused" | "combatants">;
  tableMode: TableMode;
  attackerId: string;
  targetId: string | undefined;
}): StrikeHold | null {
  if (tableMode !== "gm") return null;
  if (strike.byOwner !== true) return "strikeNotByOwner";
  const acting = encounter.combatants.find((c) => c.id === encounter.currentId);
  if (acting?.actorId !== attackerId) return "strikeNotYourTurn";
  if (encounter.paused) return "sessionPaused";
  if (encounter.combatants.find((c) => c.actorId === targetId)?.visibility !== "full") return "strikeTargetHidden";
  const used = acting.used?.filter((id) => id === `strike:${strike.id}`).length ?? 0;
  if (strike.limit !== undefined && used >= strike.limit.max) return "usedThisRound";
  return null;
}

/** Whether a plan is one (and not a refusal). */
export const isPlan = (p: ReturnType<typeof planStrike> | null): p is StrikePlan => p !== null && !("code" in p);
