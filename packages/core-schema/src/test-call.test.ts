import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_PERMS, Action } from "./actions.ts";
import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({
  campaignId: "c1",
  userId: "u",
  campaignOwnerId: "owner",
  tableMode: "gm",
  seat,
});
const coSession = ctx({ kind: "member", role: "cogm", scopes: ["session"], characterIds: [] });
const coCombat = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const bran = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

test("a Test is called by test:call, reported by the character's player, and the GM side may report for anyone", () => {
  assert.equal(ACTION_PERMS["test.call"], "test:call");
  assert.equal(ACTION_PERMS["test.close"], "test:call");
  assert.equal(ACTION_PERMS["test.report"], "test:report:own");
  const perm = "test:report:own";
  assert.equal(canInCampaign({ ctx: lyra, perm, target: { actorId: "lyra" } }), true);
  assert.equal(canInCampaign({ ctx: lyra, perm, target: { actorId: "bran" } }), false);
  assert.equal(canInCampaign({ ctx: bran, perm, target: { actorId: "bran" } }), true);
  assert.equal(canInCampaign({ ctx: screen, perm, target: { actorId: "bran" } }), false);
  assert.equal(canInCampaign({ ctx: coCombat, perm: "test:call" }), false);
  assert.equal(canInCampaign({ ctx: coSession, perm: "test:call" }), true);
});

test("the call and report actions parse their payloads", () => {
  const id = "0191a2b4-7c3e-7a10-8b5d-0f1e2d3c4b5a";
  assert.equal(
    Action.safeParse({ type: "test.call", testId: "check", actorIds: [id], inputs: { dc: 15 } }).success,
    true,
  );
  assert.equal(Action.safeParse({ type: "test.call", testId: "check", actorIds: [] }).success, false);
  assert.equal(
    Action.safeParse({ type: "test.report", callId: id, actorId: id, roll: { kind: "faces", faces: [14] } }).success,
    true,
  );
  assert.equal(Action.safeParse({ type: "test.close", callId: "nope" }).success, false);
});

test("a report carries dice or an outcome, never both and never neither", () => {
  const id = "0191a2b4-7c3e-7a10-8b5d-0f1e2d3c4b5a";
  const base = { type: "test.report", callId: id, actorId: id };
  const roll = { kind: "faces", faces: [14] };
  assert.equal(Action.safeParse({ ...base, outcome: "clean" }).success, true);
  assert.equal(Action.safeParse({ ...base, roll }).success, true);
  assert.equal(Action.safeParse({ ...base, outcome: "clean", roll }).success, false);
  assert.equal(Action.safeParse({ ...base, outcome: "clean", advantage: "none" }).success, false);
  assert.equal(Action.safeParse(base).success, false);
  assert.equal(Action.safeParse({ ...base, outcome: "" }).success, false);
});
