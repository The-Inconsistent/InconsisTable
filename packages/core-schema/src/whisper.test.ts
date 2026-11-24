import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_PERMS, Action } from "./actions.ts";
import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";

const ID = "0190a000-0000-7000-8000-000000000001";
const ctx = (seat: Ctx["seat"]): Ctx => ({
  campaignId: "c1",
  userId: "u",
  campaignOwnerId: "owner",
  tableMode: "gm",
  seat,
});
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

test("a whisper is 1 to 500 characters to 1 to 30 characters, each once; a reply 1 to 200, trimmed", () => {
  const send = (to: string[], text: string) => Action.safeParse({ type: "whisper.send", to, text }).success;
  assert.equal(send([ID], "a".repeat(500)), true);
  assert.equal(send([ID], "a".repeat(501)), false);
  assert.equal(send([ID], "   "), false);
  assert.equal(send([], "a"), false);
  assert.equal(send([ID, ID], "a"), false);
  const reply = (text: string) => Action.safeParse({ type: "whisper.reply", whisperId: ID, actorId: ID, text });
  assert.equal(reply(` ${"r".repeat(200)} `).success, true);
  assert.equal(reply("r".repeat(201)).success, false);
  assert.deepEqual(reply(" ok ").data, { type: "whisper.reply", whisperId: ID, actorId: ID, text: "ok" });
});

test("the GM side sends and deletes; only the seat holding the reader reads and replies", () => {
  assert.equal(ACTION_PERMS["whisper.send"], "session:run");
  assert.equal(ACTION_PERMS["whisper.delete"], "session:run");
  const perm = ACTION_PERMS["whisper.reply"];
  assert.equal(perm, "whisper:receive:own");
  assert.equal(ACTION_PERMS["whisper.read"], perm);
  assert.equal(canInCampaign({ ctx: gm, perm: "session:run" }), true);
  assert.equal(canInCampaign({ ctx: lyra, perm: "session:run" }), false);
  assert.equal(canInCampaign({ ctx: lyra, perm, target: { actorId: "lyra" } }), true);
  assert.equal(canInCampaign({ ctx: lyra, perm, target: { actorId: "bran" } }), false);
  assert.equal(canInCampaign({ ctx: gm, perm, target: { actorId: "lyra" } }), false); // the GM never replies
  assert.equal(canInCampaign({ ctx: screen, perm, target: { actorId: "lyra" } }), false);
});
