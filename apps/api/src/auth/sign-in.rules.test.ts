import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSignInConfig, safeReturnTo, userRoleOf } from "./sign-in.rules.ts";

const dir = mkdtempSync(join(tmpdir(), "it-signin-"));
const KEY = join(dir, "key.json");
writeFileSync(KEY, JSON.stringify({ kty: "EC", crv: "P-256", kid: "k1", x: "x", y: "y", d: "d", alg: "ES256" }));
const BAD_KEY = join(dir, "bad.json");
writeFileSync(BAD_KEY, JSON.stringify({ kty: "EC", crv: "P-256", kid: "k1", x: "x", y: "y" }));

const ON = {
  IDP_SIGN_IN: "1",
  IDP_ISSUER: "https://auth.example.test",
  IDP_CLIENT_ID: "inconsistable",
  IDP_REDIRECT_URI: "https://app.example.test/api/auth/callback",
  IDP_CLIENT_JWK_FILE: KEY,
};
const DEV = {
  ...ON,
  IDP_DEV_HTTP: "1",
  IDP_ISSUER: "http://localhost:4100",
  IDP_REDIRECT_URI: "http://localhost:3000/api/auth/callback",
};

test("sign-in is off unless IDP_SIGN_IN is set, whatever else is there", () => {
  assert.equal(loadSignInConfig({}), null);
  assert.equal(loadSignInConfig({ ...ON, IDP_SIGN_IN: "0" }), null);
  assert.equal(loadSignInConfig({ ...ON, IDP_SIGN_IN: undefined }), null);
});

test("an https deployment loads, with the post-logout URI and web origin taken from the redirect URI", () => {
  const config = loadSignInConfig(ON);
  assert.ok(config);
  assert.equal(config.webOrigin, "https://app.example.test");
  assert.equal(config.postLogoutRedirectUri, "https://app.example.test/");
  assert.deepEqual(Object.keys(config.privateJwk).sort(), ["crv", "d", "kid", "kty", "x", "y"]);
});

test("once on, a missing value, a bad key file or a wrong callback path refuses to boot", () => {
  assert.throws(() => loadSignInConfig({ ...ON, IDP_ISSUER: undefined }), /needs IDP_ISSUER/);
  assert.throws(
    () => loadSignInConfig({ ...ON, IDP_CLIENT_JWK_FILE: join(dir, "missing.json") }),
    /missing or not JSON/,
  );
  assert.throws(() => loadSignInConfig({ ...ON, IDP_CLIENT_JWK_FILE: BAD_KEY }), /not a private ES256 JWK/);
  assert.throws(() => loadSignInConfig({ ...ON, IDP_REDIRECT_URI: "https://app.example.test/callback" }), /must be/);
});

test("plain http only for localhost, only with IDP_DEV_HTTP=1, never in production", () => {
  assert.equal(loadSignInConfig(DEV)?.webOrigin, "http://localhost:3000");
  assert.throws(() => loadSignInConfig({ ...DEV, IDP_DEV_HTTP: undefined }), /must be https/);
  assert.throws(() => loadSignInConfig({ ...DEV, NODE_ENV: "production" }), /must be https/);
  assert.throws(
    () => loadSignInConfig({ ...DEV, IDP_REDIRECT_URI: "http://192.168.1.86:3000/api/auth/callback" }),
    /must be https/,
    "a LAN address over http keeps sign-in off",
  );
  assert.throws(() => loadSignInConfig({ ...ON, IDP_ISSUER: "http://auth.example.test" }), /must be https/);
});

test("return_to is one of the web's own routes, else the lobby", () => {
  assert.equal(safeReturnTo("/"), "/");
  assert.equal(safeReturnTo("/library"), "/library");
  assert.equal(safeReturnTo("/c/0199f0c8-1d2e-7a3b-9c4d-5e6f7a8b9c0d"), "/c/0199f0c8-1d2e-7a3b-9c4d-5e6f7a8b9c0d");
  for (const bad of [
    "//evil.example",
    "/\evil.example",
    "https://evil.example",
    "/library/../x",
    "",
    "/c/x",
    7,
    null,
  ]) {
    assert.equal(safeReturnTo(bad), "/", String(bad));
  }
});

test("app_user.role is creator exactly when the token says creator; admin alone grants nothing", () => {
  assert.equal(userRoleOf([]), "user");
  assert.equal(userRoleOf(["creator"]), "creator");
  assert.equal(userRoleOf(["admin"]), "user");
  assert.equal(userRoleOf(["admin", "creator"]), "creator");
});
