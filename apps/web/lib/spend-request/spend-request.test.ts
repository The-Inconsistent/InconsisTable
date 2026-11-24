import assert from "node:assert/strict";
import { test } from "node:test";

import { clampAmount, pendingFor, unseen } from "./spend-request.ts";

const request = (id: string, actorId: string, resourceId: string) => ({
  id,
  userId: "u",
  actorId,
  resourceId,
  amount: 1,
  spendId: null,
  inputs: null,
  note: "",
  createdAt: "",
});
const answer = (id: string) => ({
  id,
  userId: "u",
  actorId: "a",
  resourceId: "r",
  amount: 1,
  spendId: null,
  status: "denied" as const,
  reason: "",
});

test("an amount stays between 1 and 99", () => {
  assert.deepEqual([clampAmount(0), clampAmount(5), clampAmount(120)], [1, 5, 99]);
});

test("pending requests are picked out per character and resource", () => {
  const all = [request("1", "a", "r"), request("2", "a", "s"), request("3", "b", "r")];
  assert.deepEqual(
    pendingFor({ requests: all, actorId: "a", resourceId: "r" }).map((q) => q.id),
    ["1"],
  );
});

test("only answers not seen yet are new, oldest first", () => {
  const answers = [answer("3"), answer("2"), answer("1")];
  assert.deepEqual(
    unseen({ answers, seen: new Set(["1"]) }).map((a) => a.id),
    ["2", "3"],
  );
});
