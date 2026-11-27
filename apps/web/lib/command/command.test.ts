import assert from "node:assert/strict";
import { test } from "node:test";

import { parseOrder, type CommandTable, type CommandWords } from "./command.ts";

const words: CommandWords = {
  hit: ["hit", "dmg"],
  heal: ["heal"],
  shock: ["strain"],
  recover: ["recover"],
  next: ["next"],
  hold: ["hold"],
  back: ["back"],
  begin: ["begin"],
  mob: ["mob"],
  reveal: ["reveal"],
  hide: ["hide"],
  go: ["go"],
  seize: ["seize"],
  aware: ["aware"],
  ambush: ["ambush"],
  remove: ["remove"],
};
const hal = { combatantId: "c-hal", actorId: "hal", name: "Hal" };
const fighters = [
  hal,
  { combatantId: "c-o1", actorId: "o1", name: "Ogre 1" },
  { combatantId: "c-o2", actorId: "o2", name: "Ogre 2" },
  { combatantId: "c-rats", actorId: "rats", name: "Rats ×6" },
];
const table: CommandTable = {
  words,
  fighters,
  selected: hal,
  conditions: [
    { id: "dazed", label: "Dazed" },
    { id: "down", label: "Down" },
    { id: "fire", label: "On Fire" },
  ],
  pools: [{ id: "momentum", label: "Momentum" }],
  harm: { wounds: { id: "wounds", label: "Wounds" }, shock: { id: "strain", label: "Strain" }, mob: true },
  track: null,
  sides: false,
};
const order = (text: string, over: Partial<CommandTable> = {}) => parseOrder({ text, table: { ...table, ...over } });

test("harm and healing on a named combatant, by prefix, through health.harm's hit", () => {
  assert.deepEqual(order("ogre 1 dmg 3"), {
    ok: true,
    said: { kind: "change", name: "Ogre 1", label: "Wounds", by: 3 },
    action: { type: "rule.op", primitive: "health.harm", op: "hit", input: { actorId: "o1", wounds: 3 } },
  });
  assert.deepEqual(order("rats +2")?.ok && order("rats +2"), {
    ok: true,
    said: { kind: "change", name: "Rats ×6", label: "Wounds", by: 2 },
    action: { type: "rule.op", primitive: "health.harm", op: "hit", input: { actorId: "rats", wounds: 2 } },
  });
  const heal = order("heal 2");
  assert.ok(heal?.ok);
  assert.deepEqual(heal.action, {
    type: "rule.op",
    primitive: "health.harm",
    op: "hit",
    input: { actorId: "hal", wounds: -2 },
  });
  const strain = order("hal strain");
  assert.ok(strain?.ok);
  assert.deepEqual(strain.said, { kind: "change", name: "Hal", label: "Strain", by: 1 });
});

test("a track counts down: a hit is the track's damage op", () => {
  const r = order("hal hit 4", { harm: null, track: { id: "hp", label: "HP" } });
  assert.ok(r?.ok);
  assert.deepEqual(r.said, { kind: "change", name: "Hal", label: "HP", by: -4 });
  assert.deepEqual(r.action, {
    type: "rule.op",
    primitive: "health.tracks",
    op: "damage",
    input: { actorId: "hal", amount: 4 },
  });
  assert.deepEqual(order("hal strain", { harm: null, track: { id: "hp", label: "HP" } }), {
    ok: false,
    why: { kind: "notHere" },
  });
});

test("conditions on and off, the turn, a mob's size, reveal and a pool", () => {
  const fire = order("+onf rats");
  assert.ok(fire?.ok);
  assert.deepEqual(fire.action, { type: "condition.add", actorId: "rats", condition: "fire" });
  const off = order("-dazed");
  assert.ok(off?.ok);
  assert.deepEqual(off.action, { type: "condition.remove", actorId: "hal", condition: "dazed" });
  assert.deepEqual(order("next")?.ok && order("next"), {
    ok: true,
    said: { kind: "turn", verb: "next" },
    action: { type: "turn.next" },
  });
  const next = order("next", { sides: true });
  assert.ok(next?.ok);
  assert.deepEqual(next.action, { type: "rule.op", primitive: "initiative.sides", op: "next", input: {} });
  assert.deepEqual(order("hold"), { ok: false, why: { kind: "notHere" } });
  const back = order("back");
  assert.ok(back?.ok);
  assert.deepEqual(back.action, { type: "event.turnBack" });
  const mob = order("rats mob 8");
  assert.ok(mob?.ok);
  assert.deepEqual(mob.action, {
    type: "rule.op",
    primitive: "health.harm",
    op: "muster",
    input: { actorId: "rats", members: 8 },
  });
  const reveal = order("reveal ogre 2");
  assert.ok(reveal?.ok);
  assert.deepEqual(reveal.action, { type: "encounter.setVisibility", combatantId: "c-o2", visibility: "full" });
  const pool = order("mom -1");
  assert.ok(pool?.ok);
  assert.deepEqual(pool.said, { kind: "pool", label: "Momentum", by: -1 });
});

test("an order that does not parse says why and sends nothing", () => {
  assert.equal(order("   "), null);
  assert.deepEqual(order("ogre dmg 3"), { ok: false, why: { kind: "ambiguous", names: "Ogre 1, Ogre 2" } });
  assert.deepEqual(order("zed dmg 3"), { ok: false, why: { kind: "noMatch", words: "zed" } });
  assert.deepEqual(order("dance wildly"), { ok: false, why: { kind: "unknown" } });
  assert.deepEqual(order("+d hal"), { ok: false, why: { kind: "ambiguous", names: "Dazed, Down" } });
  assert.deepEqual(order("+bleeding hal"), { ok: false, why: { kind: "noCondition", words: "bleeding" } });
  assert.deepEqual(order("rats mob"), { ok: false, why: { kind: "needsCount" } });
  assert.deepEqual(order("dmg 2", { selected: null }), { ok: false, why: { kind: "noTarget" } });
});

test("go, seize, ambush and aware are the sides order's ops on a fighter; remove takes one out of the fight", () => {
  const sides = (text: string) => {
    const o = order(text, { sides: true });
    return o?.ok ? [o.said, o.action] : o;
  };
  const op = (name: string, input: object) => ({ type: "rule.op", primitive: "initiative.sides", op: name, input });
  assert.deepEqual(sides("go ogre 2"), [
    { kind: "side", verb: "go", name: "Ogre 2" },
    op("pick", { id: "o2", force: true }),
  ]);
  assert.deepEqual(sides("hal seize"), [{ kind: "side", verb: "seize", name: "Hal" }, op("seize", { id: "hal" })]);
  assert.deepEqual(sides("ambush rats"), [
    { kind: "side", verb: "ambush", name: "Rats ×6" },
    op("bar", { id: "rats", barred: true }),
  ]);
  assert.deepEqual(sides("aware"), [
    { kind: "side", verb: "aware", name: "Hal" },
    op("bar", { id: "hal", barred: false }),
  ]);
  // A turn order without sides has none of them; remove is every fight's.
  assert.deepEqual(order("go hal"), { ok: false, why: { kind: "notHere" } });
  assert.deepEqual(order("remove ogre 1"), {
    ok: true,
    said: { kind: "remove", name: "Ogre 1" },
    action: { type: "encounter.remove", combatantId: "c-o1" },
  });
  assert.deepEqual(order("remove zed"), { ok: false, why: { kind: "noMatch", words: "zed" } });
});
