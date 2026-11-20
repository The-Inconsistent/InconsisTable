import { z } from "zod";

import type { TurnKey } from "../enums.ts";
import { SidesInitiative } from "../manifest.ts";
import { own } from "../own.ts";
import {
  charge,
  defineOp,
  isRefusal,
  refuse,
  type Delta,
  type Primitive,
  type Refusal,
  type RuleState,
  type TargetPattern,
  type TurnState,
} from "./primitive.ts";

// House decision #57: sides alternate, the side that is up chooses who acts, and a side may pay to act out of turn.

export const EmptyInput = z.strictObject({});
export type EmptyInput = z.infer<typeof EmptyInput>;

export const PickInput = z.object({ id: z.string().min(1), force: z.boolean().optional() });
export type PickInput = z.infer<typeof PickInput>;

export const MemberInput = z.object({ id: z.string().min(1) });
export type MemberInput = z.infer<typeof MemberInput>;

export const MarkInput = z.object({ id: z.string().min(1), done: z.boolean() });
export type MarkInput = z.infer<typeof MarkInput>;

/** One member by `id`, or every member of a `side` that may be (house decision #81); exactly one of the two. */
export const BarInput = z
  .object({ id: z.string().min(1).optional(), side: z.string().min(1).optional(), barred: z.boolean() })
  .refine((x) => (x.id === undefined) !== (x.side === undefined), "name a member or a side");
export type BarInput = z.infer<typeof BarInput>;

type P = SidesInitiative;

const target = (...turn: TurnKey[]): TargetPattern[] => turn.map((t) => ({ turn: t }));
const set = (turn: TurnKey, value: Delta["value"]): Delta => ({ target: { turn }, kind: "set", value });

const TURN_KEYS: TurnKey[] = ["done", "lastSide", "outOfTurnSide", "currentId"];
const WRAP_KEYS: TurnKey[] = ["round", "currentId", "lastSide", "outOfTurnSide", "done", "held", "barred"];

const sideIds = (params: P) => params.sides.map((s) => s.id);

/** The part of the turn an ended turn changes. */
interface Snap {
  currentId: string | null;
  done: readonly string[];
  lastSide: string | null;
  outOfTurnSide: string | null;
}

const snapOf = (t: TurnState): Snap => ({
  currentId: t.currentId,
  done: t.done ?? [],
  lastSide: t.lastSide ?? null,
  outOfTurnSide: t.outOfTurnSide ?? null,
});

const sideOf = (t: TurnState, id: string) => (t.sideOf === undefined ? undefined : own(t.sideOf, id));

/** Where the sides pick first this round: the first listed, or one place further each round under `rotate`. */
function firstIndex({ params, round }: { params: P; round: number }): number {
  const n = params.sides.length;
  return params.firstSide === "rotate" ? (((Math.trunc(round) - 1) % n) + n) % n : 0;
}

/** Whether the member takes no turn this round. */
const isBarred = ({ params, t, id }: { params: P; t: TurnState; id: string }) =>
  params.barred !== undefined && t.round <= params.barred.throughRound && (t.barred ?? []).includes(id);

/** Ends the turn of whoever acts: they are done, their side was the last to act, and an out-of-turn bar lifts. */
function ended({ t, snap }: { t: TurnState; snap: Snap }): Snap {
  const cur = snap.currentId;
  if (cur === null) return snap;
  const side = sideOf(t, cur) ?? null;
  return {
    currentId: null,
    done: snap.done.includes(cur) ? snap.done : [...snap.done, cur],
    lastSide: side,
    outOfTurnSide: snap.outOfTurnSide === side ? snap.outOfTurnSide : null,
  };
}

/** The side that is up: the first with a pending member, from the side after the last to act (or the round's first). */
function up({ params, t, snap }: { params: P; t: TurnState; snap: Snap }): string | null {
  const ids = sideIds(params);
  const n = ids.length;
  const last = snap.lastSide === null ? -1 : ids.indexOf(snap.lastSide);
  const start = last < 0 ? firstIndex({ params, round: t.round }) : (last + 1) % n;
  const unable = t.unable ?? [];
  const pending = (id: string) =>
    !snap.done.includes(id) && !unable.includes(id) && id !== snap.currentId && !isBarred({ params, t, id });
  for (let k = 0; k < n; k++) {
    const side = ids[(start + k) % n];
    if (side !== undefined && t.order.some((id) => sideOf(t, id) === side && pending(id))) return side;
  }
  return null;
}

/** The side that is up now, for a caller that shows it. */
export function sideUp({ params, state }: { params: P; state: RuleState }): string | null {
  return state.turn === null ? null : up({ params, t: state.turn, snap: snapOf(state.turn) });
}

const turnOf = (state: RuleState): Refusal | TurnState =>
  state.turn === null ? refuse("noEncounter", "no fight is running") : state.turn;

const isBegun = (t: TurnState) => t.begun ?? true;

/** A turn needs a fight that is running and, when the ruleset has a setup, begun. */
function running(state: RuleState): Refusal | TurnState {
  const t = turnOf(state);
  if (isRefusal(t)) return t;
  return isBegun(t) ? t : refuse("wrongState", "the fight has not begun");
}

/** Why this member cannot start a turn, whatever its side. `snap` is the turn as it stands once the acting one ends. */
function memberProblem({ params, t, snap, id }: { params: P; t: TurnState; snap: Snap; id: string }): Refusal | null {
  if (!t.order.includes(id)) return refuse("badInput", `"${id}" is not in the order`);
  if (sideOf(t, id) === undefined) return refuse("badInput", `"${id}" has no side`);
  if (id === t.currentId) return refuse("wrongState", `"${id}" is already acting`);
  if ((t.unable ?? []).includes(id)) return refuse("wrongState", `"${id}" cannot act`);
  if (snap.done.includes(id)) return refuse("wrongState", `"${id}" has already acted this round`);
  if (isBarred({ params, t, id })) return refuse("wrongState", `"${id}" takes no turn this round`);
  return null;
}

/** The deltas of the round beginning: what `newRound` writes, and what an automatic wrap writes. */
function wrapDeltas({ params, t }: { params: P; t: TurnState }): Delta[] {
  const deltas = [
    set("round", t.round + 1),
    set("currentId", null),
    set("lastSide", null),
    set("outOfTurnSide", null),
    set("done", []),
    set("held", []),
  ];
  if (params.barred !== undefined && t.round >= params.barred.throughRound) deltas.push(set("barred", []));
  return deltas;
}

const endDeltas = (snap: Snap): Delta[] => [
  set("done", [...snap.done]),
  set("lastSide", snap.lastSide),
  set("outOfTurnSide", snap.outOfTurnSide),
  set("currentId", null),
];

/** The deltas that end the turn of whoever acts, wrapping the round when `auto` finds nobody left. */
function endTurn({ params, t }: { params: P; t: TurnState }): { deltas: Delta[]; wrapped: boolean } {
  const snap = ended({ t, snap: snapOf(t) });
  if (params.roundEnd === "auto" && up({ params, t, snap }) === null)
    return { deltas: wrapDeltas({ params, t }), wrapped: true };
  return { deltas: endDeltas(snap), wrapped: false };
}

const without = (list: readonly string[] | undefined, id: string) => (list ?? []).filter((x) => x !== id);
const withId = (list: readonly string[] | undefined, id: string) =>
  (list ?? []).includes(id) ? [...(list ?? [])] : [...(list ?? []), id];

/** What ending the acting member's turn writes before another starts: `currentId` is the next delta's. */
function ending({ t, snap }: { t: TurnState; snap: Snap }): Delta[] {
  return t.currentId === null ? [] : endDeltas(snap).slice(0, 3);
}

export const initiativeSides: Primitive<SidesInitiative> = {
  id: "initiative.sides",
  params: SidesInitiative,
  ops: {
    begin: defineOp<P, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target("begun", "done", "held", "currentId", "lastSide", "outOfTurnSide"),
      validate: ({ ctx: { params, state } }) => {
        const t = turnOf(state);
        if (isRefusal(t)) return t;
        if (params.setup === undefined) return refuse("wrongState", "this ruleset has no setup");
        return isBegun(t) ? refuse("wrongState", "the fight has already begun") : null;
      },
      apply: () => [
        set("begun", true),
        set("done", []),
        set("held", []),
        set("currentId", null),
        set("lastSide", null),
        set("outOfTurnSide", null),
      ],
    }),
    pick: defineOp<P, PickInput>({
      input: PickInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target(...TURN_KEYS),
      validate: ({ ctx: { params, state }, input }) => {
        const t = running(state);
        if (isRefusal(t)) return t;
        const snap = ended({ t, snap: snapOf(t) });
        const problem = memberProblem({ params, t, snap, id: input.id });
        if (problem !== null) return problem;
        if (input.force !== true && sideOf(t, input.id) !== up({ params, t, snap }))
          return refuse("wrongState", "it is not that side's turn");
        return null;
      },
      apply: ({ ctx: { state }, input }) => {
        const t = state.turn;
        if (t === null) return [];
        return [...ending({ t, snap: ended({ t, snap: snapOf(t) }) }), set("currentId", input.id)];
      },
    }),
    seize: defineOp<P, MemberInput>({
      input: MemberInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [...target(...TURN_KEYS), { pool: "*" }],
      validate: ({ ctx: { params, state }, input }) => seizeCheck({ params, state, id: input.id }),
      apply: ({ ctx: { params, state }, input }) => {
        const t = state.turn;
        const side = t === null ? undefined : sideOf(t, input.id);
        const cost = side === undefined ? undefined : own(params.outOfTurn?.cost ?? {}, side);
        if (t === null || side === undefined || cost === undefined) return [];
        const paid = charge({ state, pool: cost.pool, amount: cost.amount });
        if (isRefusal(paid)) return [];
        const closing = ending({ t, snap: ended({ t, snap: snapOf(t) }) }).filter(
          (d) => !("turn" in d.target && d.target.turn === "outOfTurnSide"),
        );
        return [paid.delta, ...closing, set("outOfTurnSide", side), set("currentId", input.id)];
      },
    }),
    next: defineOp<P, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target(...WRAP_KEYS),
      validate: ({ ctx: { state } }) => {
        const t = running(state);
        if (isRefusal(t)) return t;
        return t.currentId === null ? refuse("wrongState", "nobody is acting") : null;
      },
      apply: ({ ctx: { params, state } }) => (state.turn === null ? [] : endTurn({ params, t: state.turn }).deltas),
    }),
    hold: defineOp<P, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target(...WRAP_KEYS),
      validate: ({ ctx: { params, state } }) => {
        const t = running(state);
        if (isRefusal(t)) return t;
        if (params.hold === undefined) return refuse("wrongState", "this ruleset has no holding");
        return t.currentId === null ? refuse("wrongState", "nobody is acting") : null;
      },
      apply: ({ ctx: { params, state } }) => {
        const t = state.turn;
        if (t === null || t.currentId === null) return [];
        const { deltas, wrapped } = endTurn({ params, t });
        return wrapped ? deltas : [...deltas, set("held", withId(t.held, t.currentId))];
      },
    }),
    interrupt: defineOp<P, MemberInput>({
      input: MemberInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target("held"),
      validate: ({ ctx: { state }, input }) => {
        const t = running(state);
        if (isRefusal(t)) return t;
        return (t.held ?? []).includes(input.id) ? null : refuse("wrongState", `"${input.id}" is not holding`);
      },
      apply: ({ ctx: { state }, input }) => [set("held", without(state.turn?.held, input.id))],
    }),
    mark: defineOp<P, MarkInput>({
      input: MarkInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target("done", "held"),
      validate: ({ ctx: { state }, input }) => {
        const t = turnOf(state);
        if (isRefusal(t)) return t;
        if (!t.order.includes(input.id)) return refuse("badInput", `"${input.id}" is not in the order`);
        return input.id === t.currentId ? refuse("wrongState", `"${input.id}" is acting`) : null;
      },
      apply: ({ ctx: { state }, input }) => {
        const t = state.turn;
        if (t === null) return [];
        if (input.done) return [set("done", withId(t.done, input.id))];
        const deltas = [set("done", without(t.done, input.id))];
        return (t.held ?? []).includes(input.id) ? [...deltas, set("held", without(t.held, input.id))] : deltas;
      },
    }),
    bar: defineOp<P, BarInput>({
      input: BarInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target("barred"),
      validate: ({ ctx: { params, state }, input }) => {
        const t = turnOf(state);
        if (isRefusal(t)) return t;
        if (params.barred === undefined) return refuse("wrongState", "this ruleset has no barring");
        if (t.round > params.barred.throughRound) return refuse("wrongState", "barring is over");
        if (input.side !== undefined)
          return sideIds(params).includes(input.side) ? null : refuse("badInput", `"${input.side}" is not a side`);
        const id = input.id ?? "";
        if (!t.order.includes(id)) return refuse("badInput", `"${id}" is not in the order`);
        if (!input.barred) return null;
        if ((t.done ?? []).includes(id)) return refuse("wrongState", `"${id}" has already acted`);
        return id === t.currentId ? refuse("wrongState", `"${id}" is acting`) : null;
      },
      apply: ({ ctx: { state }, input }) => {
        const t = state.turn;
        if (t === null) return [];
        // A whole side: every member that may be barred (in the order, not done, not acting), or all of them freed.
        const ids =
          input.side === undefined
            ? [input.id ?? ""]
            : t.order.filter(
                (id) =>
                  sideOf(t, id) === input.side &&
                  (!input.barred || (!(t.done ?? []).includes(id) && id !== t.currentId)),
              );
        const barred = ids.reduce(
          (list: readonly string[], id) => (input.barred ? withId(list, id) : without(list, id)),
          t.barred ?? [],
        );
        return [set("barred", [...barred])];
      },
    }),
    lift: defineOp<P, MemberInput>({
      input: MemberInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => [...target("barred"), { pool: "*" }],
      validate: ({ ctx: { params, state }, input }) => {
        const t = turnOf(state);
        if (isRefusal(t)) return t;
        if (params.barred === undefined) return refuse("wrongState", "this ruleset has no barring");
        if (!(t.barred ?? []).includes(input.id)) return refuse("wrongState", `"${input.id}" is not barred`);
        const cost = liftCost({ params, t, id: input.id });
        if (cost === undefined) return refuse("wrongState", `"${input.id}" cannot be freed`);
        const paid = charge({ state, pool: cost.pool, amount: cost.amount });
        return isRefusal(paid) ? paid : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const t = state.turn;
        const cost = t === null ? undefined : liftCost({ params, t, id: input.id });
        if (t === null || cost === undefined) return [];
        const paid = charge({ state, pool: cost.pool, amount: cost.amount });
        return isRefusal(paid) ? [] : [paid.delta, set("barred", without(t.barred, input.id))];
      },
    }),
    newRound: defineOp<P, EmptyInput>({
      input: EmptyInput,
      perm: "encounter:run",
      touches: "state",
      targets: () => target(...WRAP_KEYS),
      validate: ({ ctx: { state } }) => {
        const t = running(state);
        return isRefusal(t) ? t : null;
      },
      apply: ({ ctx: { params, state } }) => (state.turn === null ? [] : wrapDeltas({ params, t: state.turn })),
    }),
  },
};

function liftCost({ params, t, id }: { params: P; t: TurnState; id: string }) {
  const side = sideOf(t, id);
  return side === undefined ? undefined : own(params.barred?.liftCost ?? {}, side);
}

/** Everything that makes `seize` refuse, in the order it is checked. A refused payment is the last. */
function seizeCheck({ params, state, id }: { params: P; state: RuleState; id: string }): Refusal | null {
  const t = running(state);
  if (isRefusal(t)) return t;
  const snap = ended({ t, snap: snapOf(t) });
  const problem = memberProblem({ params, t, snap, id });
  if (problem !== null) return problem;
  const side = sideOf(t, id) ?? "";
  const cost = params.outOfTurn === undefined ? undefined : own(params.outOfTurn.cost, side);
  if (cost === undefined) return refuse("wrongState", "that side cannot act out of turn");
  if (up({ params, t, snap }) === side) return refuse("wrongState", "that side is already up");
  if (snap.outOfTurnSide === side) return refuse("wrongState", "that side has already acted out of turn");
  if (snap.lastSide === null && sideIds(params)[firstIndex({ params, round: t.round })] === side)
    return refuse("wrongState", "that side picks first this round");
  const paid = charge({ state, pool: cost.pool, amount: cost.amount });
  return isRefusal(paid) ? paid : null;
}
