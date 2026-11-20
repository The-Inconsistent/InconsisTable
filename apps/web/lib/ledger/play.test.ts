import assert from "node:assert/strict";
import { test } from "node:test";

import { ascensionRows, awardOf, rankOf, toSpend, type AscensionMember } from "./play.ts";

// Invented numbers throughout.

test("XP to spend is earned less spent, never below zero", () => {
  assert.equal(toSpend({ earned: 30, spent: 12 }), 18);
  assert.equal(toSpend({ earned: 5, spent: 9 }), 0);
});

test("Rank is one plus one per step of XP earned, capped at the top", () => {
  assert.equal(rankOf({ earned: 0, xpPerRank: 20, top: 5 }), 1);
  assert.equal(rankOf({ earned: 19, xpPerRank: 20, top: 5 }), 1);
  assert.equal(rankOf({ earned: 20, xpPerRank: 20, top: 5 }), 2);
  assert.equal(rankOf({ earned: 999, xpPerRank: 20, top: 5 }), 5);
  assert.equal(rankOf({ earned: -4, xpPerRank: 20, top: 5 }), 1);
});

const m = (id: string, earnedThisTier: number, gone = false): AscensionMember => ({
  id,
  name: id,
  rank: 2,
  earnedThisTier,
  gone,
});

test("Ascension: ready or short per member, the gone apart, experience only when everyone counted is ready", () => {
  const some = ascensionRows({ tier: 2, topTier: 4, needed: 50, members: [m("a", 50), m("b", 38), m("c", 0, true)] });
  assert.deepEqual(
    some.counted.map((r) => [r.id, r.ready, r.short]),
    [
      ["a", true, 0],
      ["b", false, 12],
    ],
  );
  assert.deepEqual(
    some.gone.map((r) => r.id),
    ["c"],
  );
  assert.equal(some.ready, 1);
  assert.equal(some.experience, false);
  assert.equal(some.milestone, true);

  const all = ascensionRows({ tier: 2, topTier: 4, needed: 50, members: [m("a", 61), m("b", 50), m("c", 0, true)] });
  assert.equal(all.experience, true);

  // nobody counted: no Ascension by experience
  assert.equal(ascensionRows({ tier: 2, topTier: 4, needed: 50, members: [m("c", 90, true)] }).experience, false);

  const top = ascensionRows({ tier: 4, topTier: 4, needed: 50, members: [m("a", 70)] });
  assert.equal(top.atTop, true);
  assert.equal(top.experience, false);
  assert.equal(top.milestone, false);
});

test("a session award is a whole number from 0 to max; anything else is not passed on", () => {
  assert.equal(awardOf({ text: "12", max: 30 }), 12);
  assert.equal(awardOf({ text: " 0 ", max: 30 }), 0);
  assert.equal(awardOf({ text: "30", max: 30 }), 30);
  assert.equal(awardOf({ text: "31", max: 30 }), null);
  assert.equal(awardOf({ text: "-1", max: 30 }), null);
  assert.equal(awardOf({ text: "2.5", max: 30 }), null);
  assert.equal(awardOf({ text: "", max: 30 }), null);
});
