import type { Combatant, Encounter, PoolState } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

// What the screens show of a sides fight (house decisions #57 and #60), read from the snapshot and the manifest alone.
// The server decides every rule: nothing here refuses a move, it only chooses what to offer and how to word it.

type SideCost = { pool: string; amount: number };

/** A combatant's turn mark, in the order that decides it. */
export const TURN_MARKS = ["out", "acting", "noTurn", "holding", "done", "ready"] as const;
export type TurnMark = (typeof TURN_MARKS)[number];

const begun = (e: Encounter) => e.begun === true;

/** Whether the round is still inside the span in which the ruleset lets a member be barred. */
const barWindow = ({ encounter, sides }: { encounter: Encounter; sides: SidesInitiative }) =>
  sides.barred !== undefined && encounter.round <= sides.barred.throughRound;

/** The turn mark of one combatant: out, acting, no turn this round, holding, done, else ready. */
export function markOf({
  encounter,
  combatant: c,
  sides,
}: {
  encounter: Encounter;
  combatant: Combatant;
  sides?: SidesInitiative;
}): TurnMark {
  if (c.unable) return "out";
  if (c.id === encounter.currentId) return "acting";
  // Without the manifest (a seat that holds none) the bar window is the encounter's own round-one default.
  const barred = c.barred && (sides ? barWindow({ encounter, sides }) : true);
  if (barred) return "noTurn";
  if (c.held) return "holding";
  if (encounter.done.includes(c.id)) return "done";
  return "ready";
}

export const SIDE_ACTIONS = {
  start: { op: "pick" },
  outOfTurn: { op: "seize" },
  justGo: { op: "pick" },
  endTurn: { op: "next" },
  hold: { op: "hold" },
  useHeld: { op: "interrupt" },
  notYet: { op: "mark" },
  markDone: { op: "mark" },
  noTurn: { op: "bar" },
  takesTurn: { op: "bar" },
  lift: { op: "lift" },
} as const;
export type SideActionKey = keyof typeof SIDE_ACTIONS;
export type SideAction = { key: SideActionKey; cost?: SideCost };

/** The turn actions to offer for one combatant, in the order they are shown. The server still decides. */
export function actionsOf({
  encounter,
  combatant: c,
  sides,
}: {
  encounter: Encounter;
  combatant: Combatant;
  sides: SidesInitiative;
}): SideAction[] {
  const mark = markOf({ encounter, combatant: c, sides });
  if (mark === "out") return [];
  const out: SideAction[] = [];
  if (begun(encounter)) {
    if (mark === "ready") {
      if (encounter.sideUp === c.side) out.push({ key: "start" });
      else {
        const cost = sides.outOfTurn?.cost[c.side];
        if (cost) out.push({ key: "outOfTurn", cost });
        out.push({ key: "justGo" });
      }
    }
    if (mark === "acting") {
      out.push({ key: "endTurn" });
      if (sides.hold) out.push({ key: "hold" });
    }
    if (mark === "holding") out.push({ key: "useHeld" });
  }
  if (mark === "done" || mark === "holding") out.push({ key: "notYet" });
  if (mark === "ready") out.push({ key: "markDone" });
  if (barWindow({ encounter, sides })) {
    out.push({ key: c.barred ? "takesTurn" : "noTurn" });
    const cost = c.barred ? sides.barred?.liftCost[c.side] : undefined;
    if (cost) out.push({ key: "lift", cost });
  }
  return out;
}

/** The `rule.op` input of an action for one actor (the op takes the actor's id, not the combatant's). */
export function inputOf({ key, actorId }: { key: SideActionKey; actorId: string }): Record<string, unknown> {
  if (key === "justGo") return { id: actorId, force: true };
  if (key === "notYet") return { id: actorId, done: false };
  if (key === "markDone") return { id: actorId, done: true };
  if (key === "noTurn") return { id: actorId, barred: true };
  if (key === "takesTurn") return { id: actorId, barred: false };
  if (key === "endTurn" || key === "hold") return {};
  return { id: actorId };
}

/** The one primary button of the fight bar, or null when the table must pick or nothing is to be pressed. */
export type SidesPrimary =
  { key: "begin" } | { key: "endTurn"; name: string } | { key: "newRound"; round: number } | null;

export function primaryOf(encounter: Encounter): SidesPrimary {
  if (!begun(encounter)) return { key: "begin" };
  const acting = encounter.combatants.find((c) => c.id === encounter.currentId);
  if (acting) return { key: "endTurn", name: acting.name };
  if (encounter.sideUp == null) return { key: "newRound", round: encounter.round + 1 };
  return null;
}

/** A side's label from the ruleset, shown as it is; the side's id when the seat holds no manifest. */
export const sideLabel = ({ id, sides }: { id: string; sides?: SidesInitiative }) =>
  sides?.sides.find((s) => s.id === id)?.label ?? id;

/** The line that says where the fight is. Someone acting comes before a side being up: that is the turn in play. */
export type SidesLine =
  | { key: "setup" }
  | { key: "acting"; name: string }
  | { key: "unseen" }
  | { key: "pick"; side: string }
  | { key: "complete"; round: number };

export function lineOf({ encounter, sides }: { encounter: Encounter; sides?: SidesInitiative }): SidesLine {
  if (!begun(encounter)) return { key: "setup" };
  const acting = encounter.combatants.find((c) => c.id === encounter.currentId);
  if (acting) return { key: "acting", name: acting.name };
  // Someone this seat is not sent holds the turn (house decision #68): no side picks until it ends.
  if (encounter.unseen) return { key: "unseen" };
  if (encounter.sideUp != null) return { key: "pick", side: sideLabel({ id: encounter.sideUp, sides }) };
  return { key: "complete", round: encounter.round };
}

/** The combatants grouped by side: the manifest's order first, any other side after it as it appears. Empty sides drop. */
export function groupBySide({
  combatants,
  sides,
}: {
  combatants: readonly Combatant[];
  sides?: SidesInitiative;
}): { id: string; label: string; combatants: Combatant[] }[] {
  const ids = [...(sides?.sides.map((s) => s.id) ?? []), ...combatants.map((c) => c.side)];
  return [...new Set(ids)]
    .map((id) => ({ id, label: sideLabel({ id, sides }), combatants: combatants.filter((c) => c.side === id) }))
    .filter((g) => g.combatants.length > 0);
}

/** The one line a phone shows for its own character in a sides fight (acting is the "your turn" banner, not this). */
export type PhoneLine = "noTurn" | "setup" | "sideUp" | "done" | "holding";

export function phoneLineOf({
  encounter,
  combatant: c,
}: {
  encounter: Encounter;
  combatant: Combatant;
}): PhoneLine | null {
  const mark = markOf({ encounter, combatant: c });
  if (mark === "noTurn") return "noTurn";
  if (mark === "out" || mark === "acting") return null;
  if (!begun(encounter)) return "setup";
  if (mark === "ready" && encounter.sideUp === c.side && !encounter.unseen) return "sideUp";
  if (mark === "done") return "done";
  if (mark === "holding") return "holding";
  return null;
}

/** A cost as text:the amount and the pool's label when the seat received that pool, else the amount alone. */
export function costText({ cost, pools }: { cost: SideCost; pools: readonly PoolState[] }): string {
  const label = pools.find((p) => p.id === cost.pool)?.label;
  return label ? `${cost.amount} ${label}` : String(cost.amount);
}
