import assert from "node:assert/strict";
import { test } from "node:test";

import type { Combatant, Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import {
  actionsOf,
  costText,
  groupBySide,
  inputOf,
  lineOf,
  markOf,
  phoneLineOf,
  primaryOf,
  type SideActionKey,
} from "./sides.ts";

const sides: SidesInitiative = {
  strategy: "sides",
  sides: [
    { id: "wardens", label: "Wardens" },
    { id: "raiders", label: "Raiders" },
  ],
  firstSide: "fixed",
  roundEnd: "manual",
  outOfTurn: { cost: { wardens: { pool: "momentum", amount: 1 } } },
  hold: {},
  barred: { throughRound: 1, liftCost: { wardens: { pool: "momentum", amount: 2 } } },
};
const bare: SidesInitiative = { strategy: "sides", sides: sides.sides, firstSide: "fixed", roundEnd: "auto" };

const cb = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  actorId: `a-${id}`,
  name: id.toUpperCase(),
  side: "wardens",
  ord: 0,
  initiative: null,
  visibility: "full",
  keep: false,
  hp: null,
  bar: null,
  states: [],
  members: null,
  conditions: [],
  ...over,
});
const fight = (over: Partial<Encounter> = {}, combatants: Combatant[] = [cb("x")]): Encounter => ({
  id: "e",
  round: 1,
  currentId: null,
  firstId: null,
  phaseId: null,
  phases: [],
  done: [],
  firstPlayer: null,
  paused: false,
  health: null,
  conditionDefs: [],
  endMet: [],
  scoring: null,
  combatants,
  begun: true,
  sideUp: "wardens",
  ...over,
});
const keys = (e: Encounter, c: Combatant, s = sides) =>
  actionsOf({ encounter: e, combatant: c, sides: s }).map((a) => a.key);

test("a turn mark follows its precedence", () => {
  const all = cb("x", { unable: true, held: true, barred: true });
  const e = fight({ currentId: "x", done: ["x"] }, [all]);
  assert.equal(markOf({ encounter: e, combatant: all, sides }), "out");
  assert.equal(markOf({ encounter: e, combatant: cb("x", { held: true, barred: true }), sides }), "acting");
  const idle = fight({ done: ["x"] });
  assert.equal(markOf({ encounter: idle, combatant: cb("x", { held: true, barred: true }), sides }), "noTurn");
  assert.equal(markOf({ encounter: idle, combatant: cb("x", { held: true }), sides }), "holding");
  assert.equal(markOf({ encounter: idle, combatant: cb("x"), sides }), "done");
  assert.equal(markOf({ encounter: fight(), combatant: cb("x"), sides }), "ready");
});

test("a bar counts only through the ruleset's round", () => {
  const c = cb("x", { barred: true });
  assert.equal(markOf({ encounter: fight({ round: 1 }), combatant: c, sides }), "noTurn");
  assert.equal(markOf({ encounter: fight({ round: 2 }), combatant: c, sides }), "ready");
});

test("a ready member of the side up starts its turn; another side seizes or just goes", () => {
  const e = fight();
  assert.deepEqual(keys(e, cb("x"), bare), ["start", "markDone"]);
  const raider = cb("r", { side: "raiders" });
  assert.deepEqual(keys(e, raider), ["justGo", "markDone", "noTurn"]);
  assert.deepEqual(keys(e, cb("w"), sides), ["start", "markDone", "noTurn"]);
  const other = fight({ sideUp: "raiders" });
  assert.deepEqual(actionsOf({ encounter: other, combatant: cb("x"), sides }), [
    { key: "outOfTurn", cost: { pool: "momentum", amount: 1 } },
    { key: "justGo" },
    { key: "markDone" },
    { key: "noTurn" },
  ]);
  assert.deepEqual(keys(fight({ sideUp: null }), cb("x"), bare), ["justGo", "markDone"]);
});

test("the acting member ends its turn and holds only when the ruleset has hold", () => {
  const e = fight({ currentId: "x" });
  assert.deepEqual(keys(e, cb("x")), ["endTurn", "hold", "noTurn"]);
  assert.deepEqual(keys(e, cb("x"), bare), ["endTurn"]);
});

test("a holding or done member can be given another turn", () => {
  assert.deepEqual(keys(fight(), cb("x", { held: true }), bare), ["useHeld", "notYet"]);
  assert.deepEqual(keys(fight({ done: ["x"] }), cb("x"), bare), ["notYet"]);
});

test("a barred member takes its turn again, or lifts for the side's cost", () => {
  const barred = cb("x", { barred: true });
  assert.deepEqual(actionsOf({ encounter: fight(), combatant: barred, sides }), [
    { key: "takesTurn" },
    { key: "lift", cost: { pool: "momentum", amount: 2 } },
  ]);
  assert.deepEqual(keys(fight(), cb("r", { side: "raiders", barred: true })), ["takesTurn"]);
  assert.deepEqual(keys(fight({ round: 2 }), cb("x")), ["start", "markDone"]);
});

test("a member that is out has no turn actions", () => {
  assert.deepEqual(keys(fight(), cb("x", { unable: true })), []);
});

test("before begin only the bar, the lift and the done toggle are offered", () => {
  const e = fight({ begun: false, sideUp: null });
  assert.deepEqual(keys(e, cb("x")), ["markDone", "noTurn"]);
  assert.deepEqual(keys(e, cb("x", { barred: true })), ["takesTurn", "lift"]);
  assert.deepEqual(keys(fight({ begun: false }), cb("x", { held: true }), bare), ["notYet"]);
  assert.deepEqual(keys(fight({ begun: false, done: ["x"] }), cb("x"), bare), ["notYet"]);
});

test("each action sends its op with the actor's id", () => {
  const send = (key: SideActionKey) => inputOf({ key, actorId: "a" });
  assert.deepEqual(send("start"), { id: "a" });
  assert.deepEqual(send("justGo"), { id: "a", force: true });
  assert.deepEqual(send("notYet"), { id: "a", done: false });
  assert.deepEqual(send("markDone"), { id: "a", done: true });
  assert.deepEqual(send("noTurn"), { id: "a", barred: true });
  assert.deepEqual(send("takesTurn"), { id: "a", barred: false });
  assert.deepEqual(send("endTurn"), {});
});

test("the primary button follows the state", () => {
  assert.deepEqual(primaryOf(fight({ begun: false })), { key: "begin" });
  assert.deepEqual(primaryOf(fight({ currentId: "x" })), { key: "endTurn", name: "X" });
  assert.equal(primaryOf(fight()), null);
  assert.deepEqual(primaryOf(fight({ sideUp: null, round: 2 })), { key: "newRound", round: 3 });
  assert.deepEqual(primaryOf(fight({ sideUp: undefined })), { key: "newRound", round: 2 });
});

test("the line says where the fight is", () => {
  assert.deepEqual(lineOf({ encounter: fight({ begun: false }), sides }), { key: "setup" });
  assert.deepEqual(lineOf({ encounter: fight(), sides }), { key: "pick", side: "Wardens" });
  assert.deepEqual(lineOf({ encounter: fight() }), { key: "pick", side: "wardens" });
  assert.deepEqual(lineOf({ encounter: fight({ sideUp: null }), sides }), { key: "complete", round: 1 });
  assert.deepEqual(lineOf({ encounter: fight({ currentId: "x" }), sides }), { key: "acting", name: "X" });
  // A hidden combatant holds the turn: the seat is told so, and no side is asked to pick.
  assert.deepEqual(lineOf({ encounter: fight({ unseen: true }), sides }), { key: "unseen" });
});

test("a phone gets one line for its own character", () => {
  const line = (e: Encounter, c: Combatant) => phoneLineOf({ encounter: e, combatant: c });
  assert.equal(line(fight(), cb("x", { barred: true })), "noTurn");
  assert.equal(line(fight({ begun: false }), cb("x")), "setup");
  assert.equal(line(fight(), cb("x")), "sideUp");
  assert.equal(line(fight({ unseen: true }), cb("x")), null); // nobody picks while a hidden one acts
  assert.equal(line(fight({ sideUp: "raiders" }), cb("x")), null);
  assert.equal(line(fight({ done: ["x"] }), cb("x")), "done");
  assert.equal(line(fight(), cb("x", { held: true })), "holding");
  assert.equal(line(fight({ currentId: "x" }), cb("x")), null);
  assert.equal(line(fight(), cb("x", { unable: true })), null);
});

test("the order groups by the manifest's sides, and a pool is worded by its label when received", () => {
  const list = [cb("r", { side: "raiders" }), cb("w"), cb("z", { side: "extra" })];
  assert.deepEqual(
    groupBySide({ combatants: list, sides }).map((g) => [g.label, g.combatants.length]),
    [
      ["Wardens", 1],
      ["Raiders", 1],
      ["extra", 1],
    ],
  );
  assert.deepEqual(
    groupBySide({ combatants: list }).map((g) => g.id),
    ["raiders", "wardens", "extra"],
  );
  const cost = { pool: "momentum", amount: 2 };
  const pool = { id: "momentum", label: "Momentum" } as never;
  assert.equal(costText({ cost, pools: [pool] }), "2 Momentum");
  assert.equal(costText({ cost, pools: [] }), "2");
});
