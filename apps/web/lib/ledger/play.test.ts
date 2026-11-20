import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResolvedBuild } from "@inconsistable/rules-engine";

import { lookupsOf, resolveDraft, stepsFor, type LedgerBuild } from "./ledger.ts";
import {
  ascensionRows,
  awardOf,
  playOpeningStep,
  rankOf,
  startingAward,
  toSpend,
  type AscensionMember,
} from "./play.ts";
import { SAMPLE_PARAMS as params, sampleCatalogue } from "./sample.ts";

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

test("a session's award starts on the middle suggested amount, the lower middle of an even count, else 0", () => {
  assert.equal(startingAward([5, 10, 20]), 10);
  assert.equal(startingAward([5, 10, 20, 40]), 10);
  assert.equal(startingAward([7]), 7);
  assert.equal(startingAward([]), 0);
});

test("a typed award, committed on leaving the box or Enter, is a whole number from 0 to max; else not passed on", () => {
  assert.equal(awardOf({ text: "12", max: 30 }), 12);
  assert.equal(awardOf({ text: " 0 ", max: 30 }), 0);
  assert.equal(awardOf({ text: "30", max: 30 }), 30);
  assert.equal(awardOf({ text: "31", max: 30 }), null);
  assert.equal(awardOf({ text: "-1", max: 30 }), null);
  assert.equal(awardOf({ text: "2.5", max: 30 }), null);
  assert.equal(awardOf({ text: "", max: 30 }), null);
});

test("a made character opens on the step a link asks for when the seat has it, else what it owes, else Advance", () => {
  const catalogue = sampleCatalogue();
  const lookups = lookupsOf(catalogue.creation);
  const build: LedgerBuild = { tier: 1, archetypeId: "lamplighter" };
  const play = { tier: 1, xpEarned: 40 };
  const resolved = resolveDraft({ params, catalogue, build, play }).resolved;
  assert.ok(resolved);
  const clear: ResolvedBuild = { ...resolved, pending: [], problems: [] };
  const player = stepsFor({ build, lookups, play, gm: false });
  const gmSteps = stepsFor({ build, lookups, play, gm: true });
  const open = (o: { asked?: string | null; resolved: ResolvedBuild; gm: boolean }) =>
    playOpeningStep({ asked: o.asked, build, resolved: o.resolved, steps: o.gm ? gmSteps : player, gm: o.gm });

  // asked for, and the seat has it
  assert.equal(open({ asked: "advance", resolved, gm: false }), "advance");
  assert.equal(open({ asked: "detail", resolved: clear, gm: true }), "detail");
  // asked for a step a player in play does not have, or nonsense: the rule decides
  assert.equal(open({ asked: "customise", resolved: clear, gm: false }), "advance");
  assert.equal(open({ asked: "nope", resolved: clear, gm: true }), "advance");
  // nothing owed: Advance, never the creation's purchases
  assert.equal(open({ resolved: clear, gm: true }), "advance");
  // something owed on a step the seat has: that step
  const owesDetail = {
    ...clear,
    problems: [{ step: "detail" as const, what: "x", severity: "gm" as const, path: "p" }],
  };
  assert.equal(open({ resolved: owesDetail, gm: true }), "detail");
  // a GM's tick is not the player's to settle, and Detail is not a player's step in play
  assert.equal(open({ resolved: owesDetail, gm: false }), "advance");
  // Customise owed: the GM opens there
  const owesCustomise = {
    ...clear,
    problems: [{ step: "customise" as const, what: "x", severity: "error" as const, path: "p" }],
  };
  assert.equal(open({ resolved: owesCustomise, gm: true }), "customise");
});
