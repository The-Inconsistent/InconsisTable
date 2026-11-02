import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountView, ApiMessage, AuthMe, CampaignRef, readJson } from "./api-reply.ts";

test("a campaign id passes; a path or a non-string does not", () => {
  assert.ok(CampaignRef.safeParse({ campaignId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }).success);
  assert.ok(!CampaignRef.safeParse({ campaignId: "../admin" }).success);
  assert.ok(!CampaignRef.safeParse({ campaignId: 42 }).success);
});

test("only a string message is shown", () => {
  assert.ok(ApiMessage.safeParse({ message: "Room full" }).success);
  assert.ok(!ApiMessage.safeParse({ message: ["a", "b"] }).success);
});

test("readJson gives null for a body that isn't JSON", async () => {
  assert.deepEqual(await readJson(new Response('{"a":1}')), { a: 1 });
  assert.equal(await readJson(new Response("<html>")), null);
});

test("/api/auth/me: anonymous, signed in, or a role the web does not know (refused, so the lobby shows no account)", () => {
  assert.ok(AuthMe.safeParse({ signInEnabled: false, name: null, account: null }).success);
  assert.ok(AuthMe.safeParse({ signInEnabled: true, name: "Ana", account: { roles: ["creator", "admin"] } }).success);
  assert.ok(!AuthMe.safeParse({ signInEnabled: true, name: "Ana", account: { roles: ["root"] } }).success);
});

test("/api/account: the account page's view; a script link to InconsisID or an unknown provider is refused", () => {
  const view = {
    displayName: "Mira",
    roles: [],
    createdAt: "2026-01-02T03:04:05.000Z",
    signInMethods: { passkeys: [], password: null, providers: ["github"] },
    recoveryCodesLeft: 0,
    manageUrl:
      "http://localhost:4100/account?client=inconsistable-dev&return_to=http%3A%2F%2Flocalhost%3A3000%2Faccount",
  };
  assert.ok(AccountView.safeParse(view).success);
  assert.ok(!AccountView.safeParse({ ...view, manageUrl: "javascript:alert(1)" }).success);
  assert.ok(
    !AccountView.safeParse({ ...view, signInMethods: { ...view.signInMethods, providers: ["myspace"] } }).success,
  );
});
