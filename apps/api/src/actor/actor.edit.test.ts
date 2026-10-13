import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "@inconsistable/core-schema";
import type { EditableBy } from "@inconsistable/rules-engine";
import { checkEditable } from "./actor.edit.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({ campaignId: "c", userId: "u", campaignOwnerId: "owner", seat });
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const cogm = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
const admin = ctx({ kind: "admin" });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const guest = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

const BY: EditableBy[] = ["gm", "owner", "ownerSpendOnly"];
const spend = { kind: "add", value: -1 } as const;
const gain = { kind: "add", value: 2 } as const;
const set = { kind: "set", value: "x" } as const;
const check = (c: Ctx, editableBy: EditableBy, actorId: string, delta: Parameters<typeof checkEditable>[0]["delta"]) =>
  checkEditable({ ctx: c, editableBy, actorId, delta, what: "Focus" });

test("the GM side writes any value on any character", () => {
  for (const c of [gm, cogm, admin])
    for (const by of BY) for (const d of [spend, gain, set]) assert.equal(check(c, by, "lyra", d), null);
});

test("a player writes only a character they hold, and 'gm' values never", () => {
  for (const by of BY) assert.match(check(lyra, by, "bran", spend) ?? "", /Not your character/);
  assert.match(check(lyra, "gm", "lyra", set) ?? "", /Only the GM/);
  assert.equal(check(lyra, "owner", "lyra", set), null);
  assert.equal(check(lyra, "owner", "lyra", gain), null);
});

test("ownerSpendOnly lets the holder spend, never gain or overwrite", () => {
  assert.equal(check(lyra, "ownerSpendOnly", "lyra", spend), null);
  assert.match(check(lyra, "ownerSpendOnly", "lyra", gain) ?? "", /only spend/);
  assert.match(check(lyra, "ownerSpendOnly", "lyra", { kind: "set", value: -5 }) ?? "", /only spend/);
});

test("a guest's token seat is a player seat, and a screen writes nothing", () => {
  assert.equal(check(guest, "owner", "bran", set), null);
  assert.match(check(guest, "owner", "lyra", set) ?? "", /Not your character/);
  for (const by of BY) assert.match(check(screen, by, "lyra", spend) ?? "", /Not your character/);
});
