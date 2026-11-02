import { test } from "node:test";
import assert from "node:assert/strict";
import { IdpError, type Account } from "@the-inconsistent/client";
import { deviceSecret } from "@inconsistable/auth/api";
import { accountRefusal, idpAccountUrl, safeReturnTo } from "./sign-in.rules.ts";

// The SDK is stubbed at its boundary (account, renameAccount); the identity link and app_user are real rows, so the
// database cases need DATABASE_URL (a migrated database).
const dbTest = process.env.DATABASE_URL ? test : test.skip;
const ISSUER = "https://auth.example.test";

const ACCOUNT: Account = {
  sub: "stub",
  displayName: "Mira of the Lantern",
  roles: ["creator"],
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  signInMethods: {
    passkeys: [{ name: "Phone", createdAt: new Date("2026-01-02T03:04:05.000Z"), lastUsedAt: null }],
    password: { username: "mira" },
    providers: ["github"],
  },
  recoveryCodesLeft: 7,
};

test("the provider's account page link names this client and returns to the web's /account", () => {
  const url = new URL(
    idpAccountUrl({ issuer: `${ISSUER}/`, clientId: "inconsistable", webOrigin: "https://app.example.test" }),
  );
  assert.equal(url.origin + url.pathname, `${ISSUER}/account`);
  assert.equal(url.searchParams.get("client"), "inconsistable");
  assert.equal(url.searchParams.get("return_to"), "https://app.example.test/account");
  assert.equal(safeReturnTo("/account"), "/account", "a sign-in started on the account page lands back on it");
});

test("an SDK refusal becomes a status and a code, never its detail", () => {
  assert.deepEqual(accountRefusal("account_not_found"), { status: 404, key: "accountNotFound" });
  assert.deepEqual(accountRefusal("display_name_invalid"), { status: 400, key: "displayNameInvalid" });
  for (const code of ["account_api_failed", "discovery_failed"] as const) {
    assert.deepEqual(accountRefusal(code), { status: 502, key: "accountUnavailable" });
  }
});

const load = async () => {
  const [service, { db }, { appUser }, { identityLink }, orm] = await Promise.all([
    import("./account.service.ts"),
    import("../core/db.ts"),
    import("./auth.schema.ts"),
    import("./session.schema.ts"),
    import("drizzle-orm"),
  ]);
  const { eq } = orm;
  // A user linked at ISSUER, named the way a first sign-in names them.
  const linkedUser = async () => {
    const sub = `sub-${deviceSecret()}`;
    const [u] = await db
      .insert(appUser)
      .values({ id: orm.sql`uuidv7()::text`, name: "Player", role: "creator" })
      .returning({ id: appUser.id });
    await db.insert(identityLink).values({ iss: ISSUER, sub, userId: u!.id }); // !: the insert returned its row
    return { userId: u!.id, sub };
  };
  const nameOf = async (userId: string) =>
    (await db.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, userId)))[0]?.name;
  const drop = (userId: string) => db.delete(appUser).where(eq(appUser.id, userId)); // the link cascades
  return { ...service, linkedUser, nameOf, drop };
};

// A stub client recording the sub it was asked for; `fail` makes every call refuse with that code.
const stubIdp = (fail?: ConstructorParameters<typeof IdpError>[0]) => {
  const asked: string[] = [];
  const answer = (sub: string, displayName = ACCOUNT.displayName) => {
    asked.push(sub);
    if (fail) throw new IdpError(fail);
    return Promise.resolve({ ...ACCOUNT, sub, displayName });
  };
  return {
    asked,
    idp: {
      issuer: ISSUER,
      manageUrl: `${ISSUER}/account?client=inconsistable`,
      client: () => Promise.resolve({ account: (sub: string) => answer(sub), renameAccount: answer }),
    },
  };
};

dbTest("the account is read for the user's own sub at this issuer, as the page's view", async () => {
  const t = await load();
  const { userId, sub } = await t.linkedUser();
  try {
    const { idp, asked } = stubIdp();
    const view = await t.readAccount(idp, userId);
    assert.deepEqual(asked, [sub]);
    assert.deepEqual(view, {
      displayName: "Mira of the Lantern",
      roles: ["creator"],
      createdAt: "2026-01-02T03:04:05.000Z",
      signInMethods: {
        passkeys: [{ name: "Phone", createdAt: "2026-01-02T03:04:05.000Z", lastUsedAt: null }],
        password: { username: "mira" },
        providers: ["github"],
      },
      recoveryCodesLeft: 7,
      manageUrl: idp.manageUrl,
    });
    assert.equal(await t.readAccount({ ...idp, issuer: "https://other.example.test" }, userId), null, "no link there");
  } finally {
    await t.drop(userId);
  }
});

dbTest("a rename the provider accepts becomes the name tables see; a refused one changes nothing here", async () => {
  const t = await load();
  const { userId } = await t.linkedUser();
  try {
    const renamed = await t.renameAccount(stubIdp().idp, { userId, displayName: "Mira" });
    assert.equal(renamed?.displayName, "Mira");
    assert.equal(await t.nameOf(userId), "Mira");

    await assert.rejects(
      t.renameAccount(stubIdp("account_api_failed").idp, { userId, displayName: "Nope" }),
      (e: unknown) => e instanceof IdpError && e.code === "account_api_failed",
    );
    assert.equal(await t.nameOf(userId), "Mira", "the local name did not move");
  } finally {
    await t.drop(userId);
  }
});
