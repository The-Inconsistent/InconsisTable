import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_ADMIN_KEY_LENGTH, assertAdminKey, cookieSecure } from "./env.ts";

test("a weak, placeholder or missing admin key refuses to boot", () => {
  assert.throws(() => assertAdminKey(undefined));
  assert.throws(() => assertAdminKey(""));
  assert.throws(() => assertAdminKey("change-me"));
  assert.throws(() => assertAdminKey("x".repeat(MIN_ADMIN_KEY_LENGTH - 1)));
  assert.doesNotThrow(() => assertAdminKey("x".repeat(MIN_ADMIN_KEY_LENGTH)));
});

test("the guest cookie is Secure unless NODE_ENV is development or test", () => {
  assert.equal(cookieSecure("production"), true);
  assert.equal(cookieSecure(undefined), true);
  assert.equal(cookieSecure("development"), false);
  assert.equal(cookieSecure("test"), false);
});
