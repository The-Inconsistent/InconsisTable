import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_COOKIE, SESSION_COOKIE, deviceSecret } from "@inconsistable/auth/api";

// Against Postgres (DATABASE_URL, a migrated database) and, for the protocol cases, a running InconsisID dev server:
// INCONSISID_DIR is its checkout (after bun run keys:dev), IDP_TEST_ISSUER its issuer (default http://localhost:4100).
// The logout tokens come from that checkout's `bun run logout-token`, signed by the provider's own delivery code.
const dbTest = process.env.DATABASE_URL ? test : test.skip;
const INCONSISID_DIR = process.env.INCONSISID_DIR;
const idpTest = process.env.DATABASE_URL && INCONSISID_DIR ? test : test.skip;
const ISSUER = process.env.IDP_TEST_ISSUER ?? "http://localhost:4100";
const CLIENT_ID = "inconsistable-dev";

const load = async () => {
  const [service, auth, { db }, { appUser }, schema, rules, orm] = await Promise.all([
    import("./sign-in.service.ts"),
    import("./auth.service.ts"),
    import("../core/db.ts"),
    import("./auth.schema.ts"),
    import("./session.schema.ts"),
    import("./sign-in.rules.ts"),
    import("drizzle-orm"),
  ]);
  const { apiSession, identityLink, oidcTx } = schema;
  const { eq, inArray } = orm;
  const linksOf = (sub: string) => db.select().from(identityLink).where(eq(identityLink.sub, sub));
  const sessionsOf = (userId: string) => db.select().from(apiSession).where(eq(apiSession.userId, userId));
  const dropUsers = (ids: string[]) => db.delete(appUser).where(inArray(appUser.id, ids)); // links and sessions cascade
  const signIn = (roles: ("admin" | "creator")[] = []) => ({ iss: ISSUER, sub: `sub-${deviceSecret()}`, roles });
  return {
    ...service,
    ...auth,
    ...schema,
    ...rules,
    db,
    appUser,
    apiSession,
    oidcTx,
    eq,
    linksOf,
    sessionsOf,
    dropUsers,
    signIn,
  };
};

dbTest("the same account signing in twice is one user, and app_user.role follows the token each time", async () => {
  const t = await load();
  const account = t.signIn(["creator"]);
  const first = await t.db.transaction((tx) => t.linkIdentity(tx, account));
  try {
    const again = await t.db.transaction((tx) => t.linkIdentity(tx, { ...account, roles: [] }));
    assert.equal(again, first);
    assert.equal((await t.linksOf(account.sub)).length, 1);
    const [user] = await t.db.select().from(t.appUser).where(t.eq(t.appUser.id, first));
    assert.equal(user?.role, "user", "the creator role was revoked at the provider");
  } finally {
    await t.dropUsers([first]);
  }
});

dbTest("five first callbacks for one account at once make one user and one link", async () => {
  const t = await load();
  const account = t.signIn(["creator"]);
  const ids = await Promise.all([1, 2, 3, 4, 5].map(() => t.db.transaction((tx) => t.linkIdentity(tx, account))));
  try {
    assert.equal(new Set(ids).size, 1);
    assert.equal((await t.linksOf(account.sub)).length, 1);
    const users = await t.db.select().from(t.appUser).where(t.eq(t.appUser.id, ids[0]!));
    assert.equal(users.length, 1);
  } finally {
    await t.dropUsers([ids[0]!]);
  }
});

dbTest(
  "a session is live until 30 days idle or 90 days old; each read touches it; a dead one falls back to the device",
  async () => {
    const t = await load();
    const userId = await t.db.transaction((tx) => t.linkIdentity(tx, t.signIn(["creator", "admin"])));
    const device = deviceSecret();
    try {
      const token = await t.db.transaction((tx) =>
        t.issueSession(tx, { userId, opSid: "sid-a", roles: ["creator", "admin"] }),
      );
      const cookie = { cookie: `${DEVICE_COOKIE}=${device}; ${SESSION_COOKIE}=${token}` };
      const live = await t.sessionOf(cookie);
      assert.equal(live?.user.userId, userId);
      assert.deepEqual(live?.user.account, { roles: ["creator", "admin"] });
      assert.equal(live?.user.creator, true);
      assert.equal((await t.deviceUser(cookie))?.userId, userId, "the session wins over the device cookie");

      const where = t.eq(t.apiSession.tokenHash, t.hash(token));
      const almostIdle = new Date(Date.now() - t.SESSION_IDLE_MS + 60_000);
      await t.db.update(t.apiSession).set({ lastSeenAt: almostIdle }).where(where);
      assert.ok(await t.sessionOf(cookie), "29 days 23 hours idle is still live");
      const [touched] = await t.db.select().from(t.apiSession).where(where);
      assert.ok(touched && touched.lastSeenAt > almostIdle, "the read touched last_seen_at");

      await t.db
        .update(t.apiSession)
        .set({ lastSeenAt: new Date(Date.now() - t.SESSION_IDLE_MS - 1000) })
        .where(where);
      assert.equal(await t.sessionOf(cookie), null, "30 days idle");
      await t.db
        .update(t.apiSession)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() - 1000) })
        .where(where);
      assert.equal(await t.sessionOf(cookie), null, "past 90 days");
      const fallback = await t.deviceUser(cookie);
      assert.ok(fallback && fallback.userId !== userId && !fallback.account, "back to the anonymous device user");
      await t.dropUsers([fallback.userId]);

      assert.equal(await t.sessionOf({ cookie: `${SESSION_COOKIE}=${deviceSecret()}` }), null, "an unknown token");
      assert.equal(await t.sessionOf({ cookie: `${SESSION_COOKIE}=short` }), null, "a malformed token");
    } finally {
      await t.dropUsers([userId]);
    }
  },
);

// The protocol cases need the provider: discovery, the authorization URL's state, and its signing keys.
const flowsOf = async () => {
  const t = await load();
  const config = t.loadSignInConfig({
    IDP_SIGN_IN: "1",
    IDP_DEV_HTTP: "1",
    IDP_ISSUER: ISSUER,
    IDP_CLIENT_ID: CLIENT_ID,
    IDP_REDIRECT_URI: "http://localhost:3000/api/auth/callback",
    IDP_CLIENT_JWK_FILE: join(INCONSISID_DIR ?? "", ".secrets", "inconsistable_dev_client_jwk.json"),
  });
  assert.ok(config);
  return { t, flows: t.signInFlows(config) };
};
const callback = (query: Record<string, string>) => `/api/auth/callback?${new URLSearchParams(query)}`;

idpTest(
  "the callback refuses a tampered state, a foreign or missing iss, and a replayed, stale or absent transaction",
  async () => {
    const { t, flows } = await flowsOf();
    const finish = (handle: string | undefined, query: Record<string, string>) =>
      flows.finish({ handle, callbackUrl: callback(query), previousSession: undefined });

    const a = await flows.start({ deviceUserId: null, returnTo: "/" });
    const stateA = a.url.searchParams.get("state") ?? "";
    assert.equal(a.url.origin, ISSUER);
    assert.deepEqual(await finish(a.handle, { code: "c", state: "tampered", iss: ISSUER }), {
      ok: false,
      reason: "state_mismatch",
    });
    assert.deepEqual(
      await finish(a.handle, { code: "c", state: stateA, iss: ISSUER }),
      { ok: false, reason: "no_transaction" },
      "the first callback spent the transaction, right or wrong",
    );

    const b = await flows.start({ deviceUserId: null, returnTo: "/" });
    const stateB = b.url.searchParams.get("state") ?? "";
    assert.deepEqual(await finish(b.handle, { code: "c", state: stateB, iss: "https://evil.example" }), {
      ok: false,
      reason: "issuer_mismatch",
    });
    const c = await flows.start({ deviceUserId: null, returnTo: "/" });
    assert.deepEqual(await finish(c.handle, { code: "c", state: c.url.searchParams.get("state") ?? "" }), {
      ok: false,
      reason: "issuer_mismatch",
    });

    const d = await flows.start({ deviceUserId: null, returnTo: "/" });
    await t.db
      .update(t.oidcTx)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(t.eq(t.oidcTx.handleHash, t.hash(d.handle)));
    assert.deepEqual(await finish(d.handle, { code: "c", state: d.url.searchParams.get("state") ?? "", iss: ISSUER }), {
      ok: false,
      reason: "no_transaction",
    });
    assert.deepEqual(await finish(undefined, { code: "c", state: stateA, iss: ISSUER }), {
      ok: false,
      reason: "no_transaction",
    });

    const e = await flows.start({ deviceUserId: null, returnTo: "/" });
    assert.deepEqual(
      await finish(e.handle, { code: "never-issued", state: e.url.searchParams.get("state") ?? "", iss: ISSUER }),
      { ok: false, reason: "code_exchange_failed" },
      "state and iss right: the provider refuses a code it never issued",
    );
  },
);

const logoutToken = (clientId: string, sub: string, sid: string) => {
  const run = spawnSync("node", ["scripts/logout-token.ts", clientId, sub, sid], {
    cwd: INCONSISID_DIR,
    // Without ISSUER the provider derives it from PORT, which it would inherit from the api's apps/api/.env.
    env: { ...process.env, ISSUER },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};

// Each token is a fresh node process building the provider: about two seconds.
idpTest(
  "a real logout token ends the sessions of its sid only; its replay and a token for another client are refused",
  { timeout: 30_000 },
  async () => {
    const { t, flows } = await flowsOf();
    const account = t.signIn(["creator"]);
    const userId = await t.db.transaction((tx) => t.linkIdentity(tx, account));
    const sid = `sid-${deviceSecret()}`;
    try {
      const issue = (opSid: string) =>
        t.db.transaction((tx) => t.issueSession(tx, { userId, opSid, roles: ["creator"] }));
      const [s1, s2, other] = [await issue(sid), await issue(sid), await issue(`other-${sid}`)];

      const token = logoutToken(CLIENT_ID, account.sub, sid);
      const received = await flows.receiveLogout(token);
      assert.ok(received.ok);
      assert.deepEqual(received.ended.toSorted(), [t.hash(s1), t.hash(s2)].toSorted());
      assert.deepEqual(
        (await t.sessionsOf(userId)).map((s) => s.tokenHash),
        [t.hash(other)],
      );

      assert.deepEqual(await flows.receiveLogout(token), { ok: false, reason: "replayed" });
      assert.deepEqual(await flows.receiveLogout(logoutToken("dev-test", account.sub, `other-${sid}`)), {
        ok: false,
        reason: "logout_token_invalid",
      });
      assert.deepEqual(await flows.receiveLogout("not.a.jwt"), { ok: false, reason: "logout_token_invalid" });
      assert.equal((await t.sessionsOf(userId)).length, 1, "the refused tokens ended nothing");
    } finally {
      await t.dropUsers([userId]);
    }
  },
);
