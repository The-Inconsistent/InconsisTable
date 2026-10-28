import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSiteWrite, webOrigins } from "./csrf.ts";

const WEB = webOrigins("http://localhost:3000, http://192.168.1.86:3000");
const write = (headers: Record<string, string>, { method = "POST", path = "/api/campaigns" } = {}) =>
  crossSiteWrite({ method, path, headers, webOrigins: WEB });

test("a write from the web's own pages passes, by Fetch Metadata or by Origin", () => {
  assert.equal(write({ "sec-fetch-site": "same-origin" }), false);
  assert.equal(write({ origin: "http://localhost:3000" }), false);
  assert.equal(write({ origin: "http://192.168.1.86:3000" }), false);
  assert.equal(write({ "sec-fetch-site": "same-origin" }, { method: "PATCH", path: "/api/me" }), false);
});

test("a cross-site, same-site or header-less write is refused", () => {
  assert.equal(write({ "sec-fetch-site": "cross-site" }), true);
  assert.equal(write({ "sec-fetch-site": "same-site", origin: "http://localhost:3000" }), true, "Fetch Metadata wins");
  assert.equal(write({ "sec-fetch-site": "none" }), true);
  assert.equal(write({ origin: "https://evil.example" }), true);
  assert.equal(write({ origin: "null" }), true);
  assert.equal(write({}), true);
  assert.equal(write({}, { method: "DELETE" }), true);
});

test("reads are never checked; the back-channel logout is the only exempt write", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(write({}, { method }), false);
  assert.equal(write({}, { path: "/api/auth/backchannel-logout" }), false);
  assert.equal(write({}, { path: "/api/auth/login" }), true);
  assert.equal(write({}, { path: "/api/auth/logout" }), true);
});

test("an unset WEB_ORIGIN leaves only Fetch Metadata", () => {
  assert.deepEqual(webOrigins(undefined), []);
  assert.equal(
    crossSiteWrite({ method: "POST", path: "/", headers: { origin: "http://localhost:3000" }, webOrigins: [] }),
    true,
  );
});
