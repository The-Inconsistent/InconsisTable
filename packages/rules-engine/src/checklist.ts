import type { ChecklistCount, ChecklistStep } from "./manifest.ts";

/**
 * What a room holds that a checklist step may count (house decision #90), as the GM's seat already receives it: the
 * caller maps its live state, codex and the room's packs to this, so the engine needs neither.
 */
export type ChecklistRoom = {
  entries: readonly {
    kind: string;
    fields: Readonly<Record<string, unknown>>;
    prep?: Readonly<Record<string, readonly unknown[]>> | null;
  }[];
  actors: readonly { entity: string; built: boolean }[];
  campaignFields: Readonly<Record<string, unknown>>;
  pools: readonly { id: string; value: number }[];
  sessions: number;
  packs: readonly { slug: string }[];
  safety: { lines: readonly string[]; veils: readonly string[] };
};

/** One step as the room stands: how many of what it counts, and whether that is enough. */
export type ChecklistTick = { step: ChecklistStep; count: number; done: boolean };

/** A value that is set: text that is not blank, a list that is not empty, any number or yes/no. */
const isSet = (v: unknown) =>
  typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;

/** How many of what a step counts the room holds. */
function countOf({ done, room }: { done: ChecklistCount; room: ChecklistRoom }): number {
  switch (done.count) {
    case "entries":
      return room.entries.filter((e) => {
        if (e.kind !== done.kind) return false;
        if (done.prep !== undefined && (e.prep?.[done.prep]?.length ?? 0) === 0) return false;
        if (done.field === undefined) return true;
        const v = Object.hasOwn(e.fields, done.field) ? e.fields[done.field] : undefined;
        return done.equals === undefined ? isSet(v) : v === done.equals;
      }).length;
    case "actors":
      return room.actors.filter((a) => a.entity === done.entity && (done.built !== true || a.built)).length;
    case "campaignField":
      return isSet(Object.hasOwn(room.campaignFields, done.field) ? room.campaignFields[done.field] : undefined)
        ? 1
        : 0;
    case "pool":
      return room.pools.find((p) => p.id === done.pool)?.value ?? 0;
    case "sessions":
      return room.sessions;
    case "packs":
      return room.packs.filter((p) => done.slug === undefined || p.slug === done.slug).length;
    case "safety":
      return room.safety.lines.length + room.safety.veils.length;
  }
}

/** Whether what was counted is enough: a pool only has to exist unless a minimum is given; anything else needs one. */
function enough({ done, count, room }: { done: ChecklistCount; count: number; room: ChecklistRoom }): boolean {
  if (done.count === "pool")
    return room.pools.some((p) => p.id === done.pool) && count >= (done.min ?? Number.NEGATIVE_INFINITY);
  if (done.count === "campaignField" || done.count === "safety") return count >= 1;
  return count >= (done.min ?? 1);
}

/**
 * The checklist as the room stands (house decision #90): every step ticked from what the room holds, never stored;
 * `next` is the first step not done that is not optional, null once they all are.
 */
export function checklistTicks({ steps, room }: { steps: readonly ChecklistStep[]; room: ChecklistRoom }) {
  const ticks: ChecklistTick[] = steps.map((step) => {
    const count = countOf({ done: step.done, room });
    return { step, count, done: enough({ done: step.done, count, room }) };
  });
  const next = ticks.find((t) => !t.done && t.step.optional !== true)?.step.id ?? null;
  return { ticks, next, doneCount: ticks.filter((t) => t.done).length };
}
