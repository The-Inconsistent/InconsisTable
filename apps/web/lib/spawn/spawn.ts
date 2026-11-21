import type { Actor, Encounter, LiveState, ScenePrep } from "@inconsistable/core-schema";
import {
  planSpawn,
  type BudgetPick,
  type FieldValue,
  type Ruleset,
  type SpawnOption,
  type SpawnRoom,
} from "@inconsistable/rules-engine";

// Spawning with what the ruleset declares (house decision #92): the options an entry may take, the room a spawn reads,
// and the picks the encounter budget counts. The server decides; this is the preview that offers what it would take.

/** A pack entry's body as the engine reads values: what is not a field value is left out. */
export function entryValues(body: Readonly<Record<string, unknown>>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v;
  }
  return out;
}

type Room = Pick<LiveState, "actors" | "access" | "campaign">;

/** What a spawn reads of the room: its values, its active characters, and those a member's seat holds. */
export function spawnRoom(state: Room): SpawnRoom {
  const held = new Set(state.access.members.flatMap((m) => m.characterIds));
  const active = state.actors.filter((a) => a.kind === "pc" && a.status === "active");
  return {
    campaign: state.campaign.fields,
    characters: active.length,
    seated: active.filter((a) => held.has(a.id)).length,
  };
}

/** The options an entry of this type may take, read against its values when the page holds them. */
export function optionsFor({
  ruleset,
  type,
  values,
  room,
  mob,
}: {
  ruleset: Ruleset | null | undefined;
  type: string;
  values?: Readonly<Record<string, FieldValue>>;
  room: SpawnRoom;
  mob: boolean;
}): SpawnOption[] {
  return (ruleset?.spawn?.options ?? []).filter((o) => {
    if (o.entities !== undefined && !o.entities.includes(type)) return false;
    if (values === undefined || ruleset === null || ruleset === undefined) return true;
    return !("code" in planSpawn({ ruleset, entity: type, values, options: [o.id], room, mob }));
  });
}

/** The option ids toggled: added, or taken out. */
export const toggled = ({ ids, id }: { ids: readonly string[]; id: string }) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** The creatures already in the fight, as budget picks: each one, a mob as its members. */
export function fightPicks({
  ruleset,
  encounter,
  actors,
}: {
  ruleset: Ruleset | null | undefined;
  encounter: Encounter | null;
  actors: readonly Actor[];
}): BudgetPick[] {
  const byId = new Map(actors.map((a) => [a.id, a]));
  const start = ruleset?.health.harm?.mob?.start;
  return (encounter?.combatants ?? []).flatMap((c): BudgetPick[] => {
    const a = byId.get(c.actorId);
    if (a === undefined || a.kind !== "creature") return [];
    const members = start === undefined ? undefined : a.fields[start];
    return typeof members === "number"
      ? [{ values: a.fields, count: members, mob: true }]
      : [{ values: a.fields, count: 1, mob: false }];
  });
}

/** A scene's roster lines as budget picks, from the entries the page read; a line naming none is left out. */
export function rosterPicks({
  prep,
  bodies,
}: {
  prep: Pick<ScenePrep, "roster">;
  bodies: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}): BudgetPick[] {
  return prep.roster.flatMap((l): BudgetPick[] => {
    const body = bodies.get(`${l.pack}/${l.key}`);
    if (body === undefined) return [];
    const values = entryValues(body);
    return l.mob === undefined
      ? [{ values, count: l.count, mob: false }]
      : Array.from({ length: l.count }, () => ({ values, count: l.mob ?? 0, mob: true }));
  });
}
