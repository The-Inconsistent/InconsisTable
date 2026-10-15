import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// api.ts reads CLERK_TEST_SECRET at load, so set it before the import.
process.env.CLERK_TEST_SECRET = "s3cret";
process.env.PLATFORM_ADMINS = " owner-1 , ";
const { bearerOf, pemBody, readUserWebhook, testSessionToken, verifySession } = await import("./api.ts");

test("bearerOf takes only a Bearer header", () => {
  assert.equal(bearerOf("Bearer abc"), "abc");
  assert.equal(bearerOf("Basic abc"), undefined);
  assert.equal(bearerOf(undefined), undefined);
});

test("test tokens need the right secret", async () => {
  assert.deepEqual(await verifySession(testSessionToken({ secret: "s3cret", userId: "gm", role: "creator" })), {
    userId: "gm",
    name: "gm",
    creator: true,
    moderator: false,
    admin: false,
  });
  assert.equal((await verifySession(testSessionToken({ secret: "s3cret", userId: "ana" })))?.creator, false);
  // An admin is also a creator.
  const admin = await verifySession(testSessionToken({ secret: "s3cret", userId: "root", role: "admin" }));
  assert.deepEqual([admin?.creator, admin?.admin], [true, true]);
  // A moderator is not a creator and not an admin.
  const mod = await verifySession(testSessionToken({ secret: "s3cret", userId: "mo", role: "moderator" }));
  assert.deepEqual([mod?.creator, mod?.moderator, mod?.admin], [false, true, false]);
  assert.equal(await verifySession(testSessionToken({ secret: "wrong", userId: "gm", role: "creator" })), null);
});

test("a user listed in PLATFORM_ADMINS is an admin and a creator whatever their role", async () => {
  const listed = await verifySession(testSessionToken({ secret: "s3cret", userId: "owner-1" }));
  assert.deepEqual([listed?.admin, listed?.creator], [true, true]);
  const other = await verifySession(testSessionToken({ secret: "s3cret", userId: "owner-2" }));
  assert.deepEqual([other?.admin, other?.creator], [false, false]);
});

test("empty or malformed tokens are signed out", async () => {
  assert.equal(await verifySession(undefined), null);
  assert.equal(await verifySession(""), null);
  assert.equal(await verifySession("test."), null);
  assert.equal(await verifySession("not-a-jwt"), null);
});

test("pemBody survives however the PEM was pasted", () => {
  const body = "MIIBIjAN" + "BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwWyB" + "IDAQAB";
  const pem = `-----BEGIN PUBLIC KEY-----\n${body.slice(0, 8)}\n${body.slice(8, 48)}\n${body.slice(48)}\n-----END PUBLIC KEY-----\n`;
  assert.equal(pemBody(pem), body);
  assert.equal(pemBody(pem.replace(/\n/g, " ")), body); // newlines turned into spaces by an env editor
  assert.equal(pemBody(body), body);
  assert.equal(pemBody(undefined), undefined);
  assert.equal(pemBody(""), undefined);
});

// A Svix-signed Clerk webhook request: HMAC-SHA256 over `id.timestamp.body` with the secret's decoded bytes.
const SIGNING_SECRET = `whsec_${Buffer.from("a signing secret for tests").toString("base64")}`;
function webhook({ event, secret = SIGNING_SECRET }: { event: unknown; secret?: string }) {
  const body = JSON.stringify(event);
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  const headers = { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
  return new Request("http://localhost/api/webhooks/clerk", { method: "POST", headers, body });
}
const userEvent = (type: string, data: Record<string, unknown>) => ({ type, object: "event", data });

test("a signed user.updated reads as the user's role and lock; other events read as nothing", async () => {
  const signingSecret = SIGNING_SECRET;
  const updated = userEvent("user.updated", { id: "user_1", public_metadata: { role: "moderator" }, locked: true });
  assert.deepEqual(await readUserWebhook({ request: webhook({ event: updated }), signingSecret }), {
    type: "user.updated",
    userId: "user_1",
    role: "moderator",
    locked: true,
  });
  const plain = userEvent("user.updated", { id: "user_2", public_metadata: {}, locked: false });
  assert.deepEqual(await readUserWebhook({ request: webhook({ event: plain }), signingSecret }), {
    type: "user.updated",
    userId: "user_2",
    role: "user",
    locked: false,
  });
  const deleted = userEvent("user.deleted", { id: "user_3", deleted: true });
  assert.deepEqual(await readUserWebhook({ request: webhook({ event: deleted }), signingSecret }), {
    type: "user.deleted",
    userId: "user_3",
  });
  const created = userEvent("user.created", { id: "user_4", public_metadata: {}, locked: false });
  assert.equal(await readUserWebhook({ request: webhook({ event: created }), signingSecret }), null);
});

test("a webhook with a wrong signature, no headers or another secret is refused", async () => {
  const signingSecret = SIGNING_SECRET;
  const event = userEvent("user.deleted", { id: "user_1", deleted: true });
  const forged = webhook({ event, secret: `whsec_${Buffer.from("someone else").toString("base64")}` });
  await assert.rejects(readUserWebhook({ request: forged, signingSecret }));
  const unsigned = new Request("http://localhost/", { method: "POST", body: JSON.stringify(event) });
  await assert.rejects(readUserWebhook({ request: unsigned, signingSecret }));
  const tampered = webhook({ event });
  const swapped = new Request(tampered.url, {
    method: "POST",
    headers: tampered.headers,
    body: JSON.stringify(userEvent("user.deleted", { id: "user_other", deleted: true })),
  });
  await assert.rejects(readUserWebhook({ request: swapped, signingSecret }));
});
