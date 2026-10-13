import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_PERMS, Action } from "./actions.ts";
import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";
import { toSeatTests, type TestCall } from "./test-call.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({ campaignId: "c1", userId: "u", campaignOwnerId: "owner", seat });
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const coSession = ctx({ kind: "member", role: "cogm", scopes: ["session"], characterIds: [] });
const coCombat = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const bran = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const idle = ctx({ kind: "token", role: "player", characterIds: ["zed"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

// A call on two characters with a hidden target number of 17, which the ruleset says it is computed from `dc`.
const call = (over: Partial<TestCall> = {}): TestCall => ({
  id: "t1",
  testId: "check",
  dice: "1d20",
  advantage: true,
  status: "open",
  createdAt: "",
  inputs: { ability: "dex", dc: 17 },
  secretInputs: ["dc"],
  showTarget: false,
  showModifier: true,
  showOutcome: false,
  revealed: false,
  called: 2,
  reported: 2,
  targets: [
    { actorId: "lyra", modifier: 3, target: 17, report: { natural: 12, total: 15, outcome: "failure" } },
    { actorId: "bran", modifier: 1, target: 17, report: { natural: 20, total: 21, outcome: "critical" } },
  ],
  ...over,
});
const view = (c: Ctx, over?: Partial<TestCall>) => toSeatTests({ tests: [call(over)], ctx: c });
const text = (v: unknown) => JSON.stringify(v);

test("GM seats see the whole call, target number included", () => {
  for (const c of [gm, coSession]) {
    const [seen] = view(c);
    assert.equal(seen?.targets[0]?.target, 17);
    assert.deepEqual(seen?.secretInputs, ["dc"]);
    assert.equal(seen?.inputs.dc, 17);
  }
});

test("a hidden target number reaches no seat below the GM, in any field", () => {
  for (const c of [lyra, bran, screen, coCombat]) {
    for (const over of [{}, { revealed: true }, { showOutcome: true }]) {
      assert.ok(!/17/.test(text(view(c, over))), `${c.seat.kind} ${text(over)}`);
    }
  }
});

test("a player sees only calls naming a character they hold, and only their own target", () => {
  assert.deepEqual(view(idle), []);
  assert.deepEqual(view(coCombat), []);
  const [seen] = view(lyra);
  assert.deepEqual(
    seen?.targets.map((t) => t.actorId),
    ["lyra"],
  );
  assert.deepEqual(seen?.inputs, { ability: "dex" });
  assert.deepEqual([seen?.called, seen?.reported], [1, 1]);
});

test("a player is told the outcome only when the call shows it, and never the number", () => {
  assert.equal(view(lyra)[0]?.targets[0]?.report?.outcome, null);
  const shown = view(lyra, { showOutcome: true })[0]?.targets[0];
  assert.equal(shown?.report?.outcome, "failure");
  assert.equal(shown?.target, null);
  assert.equal(shown?.report?.natural, 12); // their own roll: they typed it
});

test("a target that is shown reaches the called player, and its input with it", () => {
  const [seen] = view(lyra, { showTarget: true, showOutcome: true, secretInputs: [] });
  assert.equal(seen?.targets[0]?.target, 17);
  assert.equal(seen?.inputs.dc, 17);
});

test("a modifier the ruleset keeps from the owner is not sent, and neither is the total it would give away", () => {
  const t = view(lyra, { showModifier: false, showOutcome: true })[0]?.targets[0];
  assert.equal(t?.modifier, null);
  assert.equal(t?.report?.total, null);
});

test("revealing shows the other characters' outcome and die, never their modifier or total", () => {
  const [seen] = view(lyra, { revealed: true, status: "closed" });
  const bran = seen?.targets.find((t) => t.actorId === "bran");
  assert.deepEqual(bran, {
    actorId: "bran",
    modifier: null,
    target: null,
    report: { natural: 20, total: null, outcome: "critical" },
  });
  assert.equal(seen?.targets.find((t) => t.actorId === "lyra")?.report?.outcome, "failure"); // revealed to its owner too
});

test("the table screen learns only that a Test is open and how far along it is", () => {
  const [seen] = view(screen);
  assert.deepEqual([seen?.status, seen?.called, seen?.reported], ["open", 2, 2]);
  assert.deepEqual(seen?.targets, []);
  assert.deepEqual(seen?.inputs, {});
  assert.deepEqual(view(screen, { status: "closed" }), []);
});

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
