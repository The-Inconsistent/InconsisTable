import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LIMITER_KEYS, clientIp, limiter } from "./rate-limit.ts";

const was = process.env.TRUST_CF;
afterEach(() => {
  if (was === undefined) delete process.env.TRUST_CF;
  else process.env.TRUST_CF = was;
});

test("CF-Connecting-IP is ignored unless TRUST_CF=1", () => {
  const headers = { "cf-connecting-ip": "1.2.3.4" };
  delete process.env.TRUST_CF;
  assert.equal(clientIp(headers, "9.9.9.9"), "9.9.9.9");
  process.env.TRUST_CF = "1";
  assert.equal(clientIp(headers, "9.9.9.9"), "1.2.3.4");
  assert.equal(clientIp({}, "9.9.9.9"), "9.9.9.9");
});

test("a full limiter refuses new keys, and keeps counting the ones it has", () => {
  const allow = limiter({ max: 2, windowMs: 60_000 });
  for (let i = 0; i < MAX_LIMITER_KEYS; i++) assert.equal(allow(`k${i}`), true);
  assert.equal(allow("newcomer"), false);
  assert.equal(allow("k0"), true); // its window is open: second hit
  assert.equal(allow("k0"), false); // over max
});
