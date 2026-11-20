import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { canMob, drawnOf, harmOnly, harmPadOf, parseCount, parseDelta } from "./harm.ts";

const harm = Ruleset.parse(SAMPLE_HARM);
const d20 = Ruleset.parse(SAMPLE_D20);

test("a signed number wins over the direction; a bare one follows it", () => {
  assert.equal(parseDelta({ text: "-3", direction: "deal" }), -3);
  assert.equal(parseDelta({ text: "−3", direction: "deal" }), -3);
  assert.equal(parseDelta({ text: "+2", direction: "heal" }), 2);
  assert.equal(parseDelta({ text: "2", direction: "deal" }), 2);
  assert.equal(parseDelta({ text: " 2 ", direction: "heal" }), -2);
  assert.equal(parseDelta({ text: "100", direction: "deal" }), 100);
  assert.equal(parseDelta({ text: "-100", direction: "deal" }), -100);
});

test("zero, decimals, words and numbers past 100 are refused", () => {
  for (const text of ["", "0", "+0", "-0", "1.5", "abc", "3x", "101", "1000", "--2", "+-2"])
    assert.equal(parseDelta({ text, direction: "deal" }), null, text);
});

test("a typed count stays inside its bounds", () => {
  assert.equal(parseCount({ text: "0", min: 0, max: 500 }), 0);
  assert.equal(parseCount({ text: " 9 ", min: 0, max: 500 }), 9);
  for (const text of ["", "1", "501", "-2", "2.5", "x"])
    assert.equal(parseCount({ text, min: 2, max: 500 }), null, text);
});

test("the pad a combatant gets: its profile's tracks, labelled by the manifest", () => {
  const hero = { entity: "hero", resources: { wounds: 0, strain: 0 } };
  assert.deepEqual(harmPadOf({ ruleset: harm, actor: hero, combatant: { members: null } }), {
    wounds: { id: "wounds", label: "Wounds" },
    shock: { id: "strain", label: "Strain", carried: true },
    members: null,
    injuries: { id: "scars", label: "Scars" },
  });
  const brute = { entity: "brute", resources: { wounds: 0 } };
  assert.deepEqual(harmPadOf({ ruleset: harm, actor: brute, combatant: { members: null } })?.shock, {
    id: "strain",
    label: "Strain",
    carried: false,
  });
  // A mob's wounds track is worded as its members; the hit still goes to wounds.
  const swarm = { entity: "swarm", resources: { wounds: 0, strain: 0, members: 6 } };
  const mob = harmPadOf({ ruleset: harm, actor: swarm, combatant: { members: { value: 6, max: 6 } } });
  assert.deepEqual(mob?.wounds, { id: "wounds", label: "Members" });
  assert.deepEqual(mob?.members, { id: "members", label: "Members" });
  assert.equal(mob?.injuries, null);
});

test("no harm pad without the block, a profile for the type, or an actor", () => {
  const actor = { entity: "character", resources: { hp: 9 } };
  assert.equal(harmPadOf({ ruleset: d20, actor, combatant: { members: null } }), null);
  assert.equal(harmPadOf({ ruleset: harm, actor, combatant: { members: null } }), null);
  assert.equal(harmPadOf({ ruleset: harm, actor: undefined, combatant: { members: null } }), null);
  assert.equal(harmPadOf({ ruleset: null, actor, combatant: { members: null } }), null);
});

test("the resources only a hit moves, and who can come as a mob", () => {
  assert.deepEqual([...harmOnly(harm)].sort(), ["members", "strain", "wounds"]);
  assert.equal(harmOnly(d20).size, 0);
  assert.equal(canMob({ ruleset: harm, type: "swarm" }), true);
  assert.equal(canMob({ ruleset: harm, type: "brute" }), false);
  assert.equal(canMob({ ruleset: d20, type: "character" }), false);
  assert.equal(canMob({ ruleset: null, type: "swarm" }), false);
});

test("a seat at bar draws the bar, the states and the count, never numbers", () => {
  const states = [{ id: "routing", label: "Routing" }];
  assert.deepEqual(drawnOf({ bar: 0.5, hp: null, states, members: { value: 3, max: 6 } }), {
    percent: 50,
    numbers: null,
    states,
    count: 3,
  });
  assert.deepEqual(drawnOf({ bar: null, hp: null, states: [], members: null }), {
    percent: null,
    numbers: null,
    states: [],
    count: null,
  });
});
