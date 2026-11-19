import assert from "node:assert/strict";
import { test } from "node:test";

import type { Me, PoolState } from "@inconsistable/core-schema";

import { poolFraction, poolSidesOf, poolStepLimits, poolSteps } from "./pools.ts";

const pool = (o: Partial<PoolState> = {}): PoolState => ({
  id: "p",
  label: "Fate",
  scope: "party",
  value: 2,
  min: 0,
  max: 5,
  capped: true,
  visibility: "public",
  editableBy: "owner",
  ...o,
});
const both = { dec: true, inc: true };
const none = { dec: false, inc: false };

test("the GM side gets both buttons on every pool", () => {
  for (const scope of ["party", "gm", "campaign"] as const)
    assert.deepEqual(poolSteps({ pool: pool({ scope, editableBy: "gm" }), gmSide: true, holder: false }), both);
});

test("a holder is offered buttons on a party pool by editableBy", () => {
  const steps = (editableBy: string) => poolSteps({ pool: pool({ editableBy }), gmSide: false, holder: true });
  assert.deepEqual(steps("owner"), both);
  assert.deepEqual(steps("ownerSpendOnly"), { dec: true, inc: false });
  assert.deepEqual(steps("gm"), none);
});

test("a holder gets nothing on a gm or campaign pool; a seat with no character gets nothing", () => {
  for (const scope of ["gm", "campaign"] as const)
    assert.deepEqual(poolSteps({ pool: pool({ scope }), gmSide: false, holder: true }), none);
  assert.deepEqual(poolSteps({ pool: pool(), gmSide: false, holder: false }), none);
});

const me = (o: Partial<Me> & { seat: Me["seat"] }): Me => ({
  campaignId: "c",
  userId: "u",
  campaignOwnerId: "x",
  tableMode: "gm",
  ...o,
});
const member = (role: "gm" | "player", characterIds: string[]): Me["seat"] => ({
  kind: "member",
  role,
  scopes: [],
  characterIds,
});

test("the seat's sides: GM, player with a character, TV, and a room without a GM", () => {
  assert.deepEqual(poolSidesOf(me({ seat: member("gm", []) })), { gmSide: true, holder: false });
  assert.deepEqual(poolSidesOf(me({ seat: member("player", ["a"]) })), { gmSide: false, holder: true });
  assert.deepEqual(poolSidesOf(me({ seat: member("player", []) })), { gmSide: false, holder: false });
  assert.deepEqual(poolSidesOf(me({ seat: { kind: "token", role: "screen", characterIds: [] } })), {
    gmSide: false,
    holder: false,
  });
  // No GM: nobody is the GM side, even the owner who runs the table.
  assert.equal(poolSidesOf(me({ tableMode: "gmless", userId: "x", seat: member("player", ["a"]) })).gmSide, false);
});

test("the bar fills from min to max, stays full past it, and is absent without a maximum", () => {
  assert.equal(poolFraction(pool({ value: 2, max: 8 })), 0.25);
  assert.equal(poolFraction(pool({ value: 9, max: 5, capped: false })), 1);
  assert.equal(poolFraction(pool({ value: 0 })), 0);
  assert.equal(poolFraction(pool({ max: null })), null);
});

test("the minus stops at min, the plus at max only when capped", () => {
  assert.deepEqual(poolStepLimits(pool({ value: 0 })), { decDisabled: true, incDisabled: false });
  assert.deepEqual(poolStepLimits(pool({ value: 5 })), { decDisabled: false, incDisabled: true });
  assert.deepEqual(poolStepLimits(pool({ value: 5, capped: false })), { decDisabled: false, incDisabled: false });
});
