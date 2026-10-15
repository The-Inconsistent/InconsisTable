import { test } from "node:test";
import assert from "node:assert/strict";
import type { UserWebhook } from "@inconsistable/auth/api";
import { applyUserWebhook } from "./webhook.service.ts";

// Runs one change with the app's stored role for the user, and returns who was kicked.
async function dispatch(change: UserWebhook, stored: string | undefined) {
  const kicked: string[] = [];
  const table = { kickUser: async (userId: string) => void kicked.push(userId) };
  await applyUserWebhook(change, { table, storedRole: async () => stored });
  return kicked;
}

test("a deleted user, a locked one and a changed role kick the user's sockets", async () => {
  assert.deepEqual(await dispatch({ type: "user.deleted", userId: "u1" }, "creator"), ["u1"]);
  assert.deepEqual(await dispatch({ type: "user.updated", userId: "u2", role: "creator", locked: true }, "creator"), [
    "u2",
  ]);
  assert.deepEqual(await dispatch({ type: "user.updated", userId: "u3", role: "user", locked: false }, "creator"), [
    "u3",
  ]);
});

test("a user.updated that changes neither role nor lock leaves the sockets alone", async () => {
  assert.deepEqual(
    await dispatch({ type: "user.updated", userId: "u4", role: "creator", locked: false }, "creator"),
    [],
  );
});
