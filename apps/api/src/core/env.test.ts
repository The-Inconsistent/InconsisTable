import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_ADMIN_KEY_LENGTH, assertAdminKey, cookieSecure } from "./env.ts";

test("a weak or placeholder admin key refuses to boot; an unset one turns the key path off", () => {
  assert.doesNotThrow(() => assertAdminKey(undefined));
  assert.doesNotThrow(() => assertAdminKey(""));
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
