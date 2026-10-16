import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_COOKIE, deviceSecret, isDeviceSecret } from "./api.ts";

test("a minted secret is accepted and never repeats", () => {
  const a = deviceSecret();
  assert.ok(isDeviceSecret(a));
  assert.ok(a.length >= 32);
  assert.notEqual(a, deviceSecret());
  assert.equal(DEVICE_COOKIE, "it_device");
});

test("short, long, empty or non-base64url secrets are refused", () => {
  assert.equal(isDeviceSecret(undefined), false);
  assert.equal(isDeviceSecret(""), false);
  assert.equal(isDeviceSecret("a".repeat(31)), false);
  assert.equal(isDeviceSecret("a".repeat(201)), false);
  assert.equal(isDeviceSecret(`${"a".repeat(31)}=`), false);
  assert.equal(isDeviceSecret(`${"a".repeat(31)} `), false);
  assert.equal(isDeviceSecret("a".repeat(200)), true);
});
